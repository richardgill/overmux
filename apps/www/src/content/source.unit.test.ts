import { createFromSource } from "fumadocs-core/search/server";
import { llms } from "fumadocs-core/source";
import { describe, expect, it, test as testCases } from "vitest";
import { getLLMText, source } from "./source";

const packagePages = [
  ["git", "Git (experimental)"],
  ["jsonl-store", "JSONL store"],
  ["keybindings", "Keybindings"],
  ["lib", "Runtime library"],
  ["pi", "Pi (experimental)"],
  ["pty", "PTY integration"],
  ["terminal-stream", "Terminal stream"],
  ["tmux", "Tmux"],
  ["ui", "UI components"],
  ["xterm", "xterm (terminal)"],
] as const;

describe("combined documentation source", () => {
  it("uses plain-text frontmatter titles in non-formatting outputs", () => {
    const page = source.getPage(["reference", "cli", "docs"]);

    expect(page?.url).toBe("/docs/reference/cli/docs");
    expect(page?.data.formattedTitle).toBe("`overmux docs`");
    expect(page?.data.title).toBe("overmux docs");
    expect(getLLMText(page!)).toContain(
      "# overmux docs (/docs/reference/cli/docs)",
    );
  });

  it("keeps both documentation subcommands on one reference page", () => {
    const page = source.getPage(["reference", "cli", "docs"]);

    expect(page?.data.content).toContain("## `overmux docs path`");
    expect(page?.data.content).toContain("## `overmux docs ai-context`");
    expect(page?.data.toc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "#overmux-docs-ai-context" }),
      ]),
    );
    expect(
      source.getPage(["reference", "cli", "docs", "ai-context"]),
    ).toBeUndefined();
  });

  it("loads top-level Overmux documentation and emits it through LLM outputs", () => {
    const page = source.getPage(["reference", "configuration"]);

    expect(page?.url).toBe("/docs/reference/configuration");
    expect(page?.data.title).toBe("Configuration");
    expect(page && getLLMText(page)).toContain(
      "# Configuration (/docs/reference/configuration)",
    );
    expect(llms(source).index()).toContain("/docs/reference/configuration");
  });

  testCases.each(packagePages)(
    "keeps the %s package documentation routable",
    (slug, title) => {
      const page = source.getPage(["packages", slug]);

      expect(page?.url).toBe(`/docs/packages/${slug}`);
      expect(page?.data.title).toBe(title);
    },
  );

  it("includes only selected packages in navigation outputs", () => {
    const index = llms(source).index();

    ["tmux", "git", "xterm", "jsonl-store", "pi"].forEach((slug) =>
      expect(index).toContain(`/docs/packages/${slug}`),
    );
    ["lib", "keybindings", "pty", "terminal-stream", "ui"].forEach((slug) =>
      expect(index).not.toContain(`/docs/packages/${slug}`),
    );
  });

  it("includes Overmux documentation in search", async () => {
    const search = createFromSource(source);

    const response = await search.GET(
      new Request("https://overmux.dev/api/search?query=configuration"),
    );
    const results = (await response.json()) as { url: string }[];

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "/docs/reference/configuration",
        }),
      ]),
    );
  });

  it("includes ecosystem documentation in search", async () => {
    const search = createFromSource(source);

    const response = await search.GET(
      new Request("https://overmux.dev/api/search?query=Pi%20integration"),
    );
    const results = (await response.json()) as { url: string }[];

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "/docs/packages/pi" }),
      ]),
    );
  });
});
