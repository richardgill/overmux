import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test as testCases } from "vitest";
import { InlineCodeTitle, inlineTitleText } from "./inline-title";

const titleCases = [
  {
    name: "formats mixed text and multiple code spans",
    title: "Run `overmux docs` with `--help`",
    plainText: "Run overmux docs with --help",
    html: 'Run <code class="rounded-[5px] border border-fd-border bg-fd-muted p-[3px] font-normal text-fd-foreground text-[13px]">overmux docs</code> with <code class="rounded-[5px] border border-fd-border bg-fd-muted p-[3px] font-normal text-fd-foreground text-[13px]">--help</code>',
  },
  {
    name: "keeps an unmatched opening delimiter literal",
    title: "Run `overmux docs",
    plainText: "Run `overmux docs",
    html: "Run `overmux docs",
  },
  {
    name: "keeps an unmatched closing delimiter literal",
    title: "Run overmux docs`",
    plainText: "Run overmux docs`",
    html: "Run overmux docs`",
  },
] as const;

describe("inline documentation titles", () => {
  testCases.each(titleCases)("$name", ({ title, plainText, html }) => {
    expect(inlineTitleText(title)).toBe(plainText);
    expect(
      renderToStaticMarkup(createElement(InlineCodeTitle, { title })),
    ).toBe(html);
  });
});
