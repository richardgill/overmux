import type { ReactNode } from "react";

type TitlePart = { code: boolean; value: string };

// Documentation frontmatter titles support paired inline backticks, e.g. `overmux --help`.
// General Markdown is unsupported.
export const parseInlineTitle = (title: string) => {
  const parts: TitlePart[] = [];
  const matches = title.matchAll(/`([^`]*)`/g);
  let end = 0;

  for (const match of matches) {
    const [formatted, code] = match;
    const start = match.index ?? end;
    if (start > end) {
      parts.push({ code: false, value: title.slice(end, start) });
    }
    parts.push({ code: true, value: code });
    end = start + formatted.length;
  }

  if (end < title.length) {
    parts.push({ code: false, value: title.slice(end) });
  }
  return parts;
};

export const inlineTitleText = (title: string) =>
  parseInlineTitle(title)
    .map(({ value }) => value)
    .join("");

const inlineCodeClassName =
  "rounded-[5px] border border-fd-border bg-fd-muted p-[3px] font-normal text-fd-foreground";

export const InlineCodeTitle = ({
  title,
  titleSize,
}: {
  title: string;
  titleSize?: string;
}): ReactNode =>
  parseInlineTitle(title).map(({ code, value }, index) =>
    code ? (
      <code
        className={
          titleSize
            ? `${inlineCodeClassName} ${titleSize}`
            : `${inlineCodeClassName} text-[13px]`
        }
        key={index}
      >
        {value}
      </code>
    ) : (
      value
    ),
  );
