import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { documentationRoots } from "../../../docs.config.ts";
import { rewritePackageMarkdownForWebsite } from "./rewrite-package-markdown";
import { stageDocumentationSources } from "./stage-package-docs";

const temporaryRoots: string[] = [];
const page = (title: string, body = "Body\n") =>
  `---\ntitle: ${title}\ndescription: A description.\n---\n\n${body}`;

const createTemporaryRoot = async () => {
  await mkdir(resolve("../..", ".test-tmp"), { recursive: true });
  const root = await mkdtemp(resolve("../..", ".test-tmp", "docs-"));
  temporaryRoots.push(root);
  return root;
};

const stage = (root: string, source: string, mode?: "replace" | "sync") =>
  stageDocumentationSources({
    assetsDestination: resolve(root, "public/docs"),
    destination: resolve(root, "generated"),
    mode,
    roots: documentationRoots,
    sources: [
      {
        directory: source,
        website: { path: "packages/example", title: "Example" },
      },
    ],
  });

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("rewritePackageMarkdownForWebsite", () => {
  it("uses website routes for local Markdown links", () => {
    const markdown = [
      "[Guide](./guide.md)",
      "[Section](../guide.md#section)",
      "[External](https://example.com/guide.md)",
    ].join("\n");

    expect(rewritePackageMarkdownForWebsite(markdown)).toBe(
      [
        "[Guide](./guide)",
        "[Section](../guide#section)",
        "[External](https://example.com/guide.md)",
      ].join("\n"),
    );
  });
});

describe("stageDocumentationSources", () => {
  it("copies Markdown byte-for-byte", async () => {
    const root = await createTemporaryRoot();
    const source = resolve(root, "source");
    const destination = resolve(root, "generated");
    const content = page("Guide", "Windows line follows\r\n");
    await mkdir(source, { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(source, "guide.md"), content);
    await writeFile(resolve(destination, "stale.md"), "stale");

    await stage(root, source);

    expect(
      await readFile(resolve(destination, "packages/example/guide.md"), "utf8"),
    ).toBe(content);
    await expect(readFile(resolve(destination, "stale.md"))).rejects.toThrow();
  });

  it("preserves unchanged files when synchronizing for development", async () => {
    const root = await createTemporaryRoot();
    const source = resolve(root, "source");
    const destination = resolve(root, "generated/packages/example");
    const content = page("Guide");
    await mkdir(source, { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(source, "guide.md"), content);
    await writeFile(resolve(destination, "guide.md"), content);
    const modifiedBefore = (await stat(resolve(destination, "guide.md")))
      .mtimeMs;

    await stage(root, source, "sync");

    expect((await stat(resolve(destination, "guide.md"))).mtimeMs).toBe(
      modifiedBefore,
    );
  });

  it("copies assets only under public docs", async () => {
    const root = await createTemporaryRoot();
    const source = resolve(root, "source");
    const asset = Buffer.from([0, 1, 2, 255]);
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, "guide.md"), page("Guide"));
    await writeFile(resolve(source, "diagram.bin"), asset);

    await stage(root, source);

    expect(
      await readFile(resolve(root, "public/docs/packages/example/diagram.bin")),
    ).toEqual(asset);
    await expect(
      readFile(resolve(root, "generated/packages/example/diagram.bin")),
    ).rejects.toThrow();
  });

  it("maps numbered sources to ordered routes and nested metadata", async () => {
    const root = await createTemporaryRoot();
    const source = resolve(root, "source");
    await mkdir(resolve(source, "001-cli"), { recursive: true });
    await writeFile(
      resolve(source, "001-index.md"),
      page("Example", "[Call](./001-cli/001-call.md#usage)\n"),
    );
    await writeFile(resolve(source, "001-cli/001-call.md"), page("Call"));

    await stageDocumentationSources({
      assetsDestination: resolve(root, "public/docs"),
      destination: resolve(root, "generated"),
      roots: documentationRoots,
      sources: [
        {
          directory: source,
          website: {
            path: "",
            title: "Example",
            page: { source: "001-index.md", route: "" },
            groups: [
              {
                description: "Commands",
                pages: [
                  {
                    source: "001-cli/001-call.md",
                    route: "cli/call",
                  },
                ],
                route: "cli",
                title: "CLI",
              },
            ],
          },
        },
      ],
    });

    expect(await readFile(resolve(root, "generated/index.md"), "utf8")).toBe(
      page("Example", "[Call](/docs/cli/call#usage)\n"),
    );
    expect(await readFile(resolve(root, "generated/meta.json"), "utf8")).toBe(
      '{\n  "title": "Example",\n  "pages": [\n    "cli"\n  ]\n}\n',
    );
    expect(
      await readFile(resolve(root, "generated/cli/meta.json"), "utf8"),
    ).toBe(
      '{\n  "title": "CLI",\n  "pages": [\n    "call"\n  ],\n  "description": "Commands"\n}\n',
    );
    expect(
      await readFile(resolve(root, "generated/packages/meta.json"), "utf8"),
    ).toBe(
      '{\n  "title": "Packages",\n  "pages": [\n    "tmux/index",\n    "xterm/index",\n    "xterm-fork/index",\n    "ai-agents",\n    "jsonl-store/index",\n    "git/index",\n    "zellij/index"\n  ]\n}\n',
    );
    expect(
      await readFile(
        resolve(root, "generated/packages/ai-agents/meta.json"),
        "utf8",
      ),
    ).toBe(
      '{\n  "title": "AI agents",\n  "pages": [\n    "[pi](/docs/packages/pi)"\n  ]\n}\n',
    );
  });
});
