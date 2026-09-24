import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const viteManifest = require.resolve("vite/package.json");
const licenseFile = /^(?:licen[cs]e|copying)(?:[._-]|$)/i;
const noticeFile =
  /^(?:(?:third[-_]party)[-_])?(?:licen[cs]e|copying|notice|copyright|trademark)(?:[._-]|$)/i;

const packageDirectory = (id: string) => {
  // Vite's polyfills and Rolldown's runtime helpers are bundled code too, even
  // though their virtual module IDs have no physical node_modules path.
  if (id.startsWith("\0vite/")) {
    return dirname(viteManifest);
  }
  if (id === "\0rolldown/runtime.js") {
    return dirname(
      createRequire(viteManifest).resolve("rolldown/package.json"),
    );
  }
  if (id.startsWith("\0")) {
    return undefined;
  }
  return id
    .split("?", 1)[0]!
    .match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
};

const readNotice = (path: string) => {
  const text = readFileSync(path, "utf8");
  if (!text.trim()) {
    throw new Error(`Empty bundled dependency notice: ${path}`);
  }
  return text;
};

const recoveredStricliLicense = () => {
  // The npm artifact omits its upstream legal files. Recovery is offline and
  // pinned to that artifact's gitHead; never substitute a generic Apache text.
  const directory = fileURLToPath(
    new URL("./license-sources/stricli-core-1-3-0/", import.meta.url),
  );
  const provenance = JSON.parse(
    readFileSync(join(directory, "provenance.json"), "utf8"),
  ) as {
    revision: string;
    files: { name: string; sha256: string }[];
  };
  const sections = provenance.files.map(({ name, sha256 }) => {
    const text = readNotice(join(directory, name));
    if (createHash("sha256").update(text).digest("hex") !== sha256) {
      throw new Error(
        `Recovered @stricli/core@1.3.0 ${name} does not match its pinned SHA-256`,
      );
    }
    return `### ${name}\n\nSource: https://github.com/bloomberg/stricli/blob/${provenance.revision}/${name}\n\n${text}`;
  });
  return sections.join("\n\n");
};

const packageNotices = (directory: string) => {
  const { name, version } = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  ) as {
    name: string;
    version: string;
  };
  const files = readdirSync(directory)
    .filter((file) => noticeFile.test(file))
    .sort();
  const recovered =
    !files.some((file) => licenseFile.test(file)) &&
    name === "@stricli/core" &&
    version === "1.3.0"
      ? recoveredStricliLicense()
      : undefined;
  if (!recovered && !files.some((file) => licenseFile.test(file))) {
    throw new Error(
      `Missing required LICENSE/COPYING for bundled dependency ${name}@${version} in ${directory}`,
    );
  }
  const sections = files.map(
    (file) => `### ${file}\n\n${readNotice(join(directory, file))}`,
  );
  return `## ${name}@${version}\n\n${[recovered, ...sections].filter(Boolean).join("\n\n")}`;
};

const readBundledNotices = (modules: string[]) => {
  const directories = [
    ...new Set(
      modules.map(packageDirectory).filter((path) => path !== undefined),
    ),
  ];
  const sections = directories.map(packageNotices).sort();
  return `# Bundled dependency notices\n\nGenerated from this build's bundled modules. External dependencies retain their own notices.\n\n${sections.join("\n\n")}\n`;
};

export const bundledDependencyNotices = ({
  inlineInChunks = false,
}: { inlineInChunks?: boolean } = {}): Plugin => ({
  name: "overmux-bundled-dependency-notices",
  apply: "build",
  // Auth serves only fingerprinted JS/CSS. Keep its access rules unchanged and
  // deliver notices with the JS itself, after minification. Escape comment ends
  // from upstream text; the separate asset retains the exact original bytes.
  outputOptions: (options) =>
    inlineInChunks
      ? {
          ...options,
          postFooter: (chunk) =>
            `/*!\n${readBundledNotices(Object.keys(chunk.modules)).replaceAll("*/", "* /")}*/`,
        }
      : options,
  generateBundle(_options, bundle) {
    // Emitted chunk modules, rather than manifest dependencies or a static list,
    // include transitive bundles while excluding external/tree-shaken packages.
    const modules = Object.values(bundle).flatMap((output) =>
      output.type === "chunk" ? Object.keys(output.modules) : [],
    );
    // Read and validate every source before emitting; a missing license fails
    // the build instead of producing a plausible but incomplete inventory.
    this.emitFile({
      type: "asset",
      fileName: "THIRD_PARTY_NOTICES.md",
      source: readBundledNotices(modules),
    });
  },
});
