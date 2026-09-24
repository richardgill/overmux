import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, test as testCases } from "vitest";
import { build } from "vite";

import { bundledDependencyNotices } from "./bundled-dependency-notices";

let directory: string;

beforeEach(() => {
  const temporaryRoot = resolve(import.meta.dirname, "../../../../.test-tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  directory = mkdtempSync(join(temporaryRoot, "bundled-notices-"));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

const writeFixtureFiles = (files: Record<string, string>) => {
  for (const [file, text] of Object.entries(files)) {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
};

const manifest = (name: string, version = "1.0.0") =>
  JSON.stringify({
    name,
    version,
    type: "module",
    main: "index.js",
  });

const buildFixture = ({ browser = false }: { browser?: boolean } = {}) =>
  build({
    configFile: false,
    root: directory,
    logLevel: "silent",
    plugins: [bundledDependencyNotices({ inlineInChunks: browser })],
    ssr: { noExternal: true },
    build: {
      ssr: browser ? false : join(directory, "entry.js"),
      outDir: join(directory, "dist"),
      rollupOptions: { external: ["external-only"] },
    },
  });

const builtNotices = () =>
  readFileSync(join(directory, "dist/THIRD_PARTY_NOTICES.md"), "utf8");

it("discovers emitted transitive inputs and retains full licenses/notices, not unused or external packages", async () => {
  writeFixtureFiles({
    "entry.js":
      'import { value } from "direct"; import "external-only"; console.log(value);',
    "node_modules/direct/package.json": manifest("direct"),
    "node_modules/direct/index.js":
      'export { value } from "@scope/transitive"; console.log("direct initialized");',
    "node_modules/direct/LICENSE":
      "Direct original license\n  original whitespace\n",
    "node_modules/direct/NOTICE.txt": "Direct upstream attribution\n",
    "node_modules/direct/node_modules/@scope/transitive/package.json": manifest(
      "@scope/transitive",
      "2.0.0",
    ),
    "node_modules/direct/node_modules/@scope/transitive/index.js":
      'export const value = process.env.PUBLIC_VALUE; console.log("transitive initialized");',
    "node_modules/direct/node_modules/@scope/transitive/LICENCE.md":
      "Transitive original license\n",
    "node_modules/@scope/transitive/package.json": manifest(
      "@scope/transitive",
      "3.0.0",
    ),
    "node_modules/unused/package.json": manifest("unused"),
    "node_modules/external-only/package.json": manifest("external-only"),
  });

  await buildFixture();

  const notices = builtNotices();
  expect(notices).toContain("## direct@1.0.0");
  expect(notices).toContain("Direct original license\n  original whitespace\n");
  expect(notices).toContain("Direct upstream attribution\n");
  expect(notices).toContain("## @scope/transitive@2.0.0");
  expect(notices).toContain("Transitive original license\n");
  expect(notices).not.toMatch(/transitive@3|unused@|external-only@/);
});

it("includes original licenses for virtual browser polyfills and runtime helpers", async () => {
  writeFixtureFiles({
    "index.html": '<script type="module" src="/entry.js"></script>',
    "entry.js": 'import value from "commonjs-input"; console.log(value);',
    "node_modules/commonjs-input/package.json": JSON.stringify({
      name: "commonjs-input",
      version: "1.0.0",
      main: "index.cjs",
    }),
    "node_modules/commonjs-input/index.cjs":
      "module.exports = { value: process.env.PUBLIC_VALUE };",
    "node_modules/commonjs-input/LICENSE": "Fixture license\n",
  });

  await buildFixture({ browser: true });

  const require = createRequire(import.meta.url);
  const viteManifest = require.resolve("vite/package.json");
  const rolldownManifest = createRequire(viteManifest).resolve(
    "rolldown/package.json",
  );
  const notices = builtNotices();
  const assets = join(directory, "dist/assets");
  const script = readFileSync(
    join(
      assets,
      readdirSync(assets).find((name) => name.endsWith(".js"))!,
    ),
    "utf8",
  );
  expect(script).toContain(`/*!\n${notices}*/`);
  expect(notices).toContain(
    readFileSync(join(dirname(viteManifest), "LICENSE.md"), "utf8"),
  );
  expect(notices).toContain(
    readFileSync(join(dirname(rolldownManifest), "LICENSE"), "utf8"),
  );
});

it("recovers Stricli's exact upstream legal text offline with pinned provenance", async () => {
  writeFixtureFiles({
    "entry.js": 'import "@stricli/core";',
    "node_modules/@stricli/core/package.json": manifest(
      "@stricli/core",
      "1.3.0",
    ),
    "node_modules/@stricli/core/index.js": 'console.log("Stricli fixture");',
  });

  await buildFixture();

  const source = join(
    import.meta.dirname,
    "license-sources/stricli-core-1-3-0",
  );
  const notices = builtNotices();
  expect(notices).toContain("## @stricli/core@1.3.0");
  expect(notices).toContain(
    "https://github.com/bloomberg/stricli/blob/4b5802b5370f6b661de945fc7e932ac4e26ae5e0/LICENSE",
  );
  expect(notices).toContain(readFileSync(join(source, "LICENSE"), "utf8"));
  expect(notices).toContain(
    readFileSync(join(source, "TRADEMARK.txt"), "utf8"),
  );
});

testCases.each([
  {
    name: "missing license",
    packageName: "direct",
    version: "1.0.0",
    files: {},
    error: /Missing required LICENSE\/COPYING.*direct@1.0.0/,
  },
  {
    name: "empty license",
    packageName: "direct",
    version: "1.0.0",
    files: { LICENSE: " \n" },
    error: /Empty bundled dependency notice:.*LICENSE/,
  },
  {
    name: "unreviewed Stricli version",
    packageName: "@stricli/core",
    version: "1.3.1",
    files: {},
    error: /Missing required LICENSE\/COPYING.*@stricli\/core@1.3.1/,
  },
])(
  "fails the build for $name instead of emitting incomplete notices",
  async ({ packageName, version, files, error }) => {
    const packagePath = `node_modules/${packageName}`;
    writeFixtureFiles({
      "entry.js": `import "${packageName}";`,
      [`${packagePath}/package.json`]: manifest(packageName, version),
      [`${packagePath}/index.js`]: 'console.log("bundled fixture");',
      ...Object.fromEntries(
        Object.entries(files).map(([name, text]) => [
          `${packagePath}/${name}`,
          text,
        ]),
      ),
    });

    await expect(buildFixture()).rejects.toThrow(error);
    expect(() => builtNotices()).toThrow(/ENOENT/);
  },
);
