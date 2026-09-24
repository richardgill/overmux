import { Link as RouterLink } from "@tanstack/react-router";
import type { Framework } from "fumadocs-core/framework";

type InternalLinkTarget = {
  hash?: string;
  search?: Record<string, string | string[]>;
  to: string;
};

const searchFrom = (search: string) => {
  const values: Record<string, string | string[]> = {};

  for (const [key, value] of new URLSearchParams(search)) {
    const previous = values[key];
    values[key] = previous === undefined ? value : [previous, value].flat();
  }

  return Object.keys(values).length === 0 ? undefined : values;
};

export const internalLinkTarget = (href: string): InternalLinkTarget | null => {
  if (
    !(href.startsWith("/") && !href.startsWith("//")) &&
    !href.startsWith("?") &&
    !href.startsWith("#")
  ) {
    return null;
  }

  const url = new URL(href, "https://overmux.invalid");
  return {
    hash: url.hash.slice(1) || undefined,
    search: searchFrom(url.search),
    to: href.startsWith("/") ? url.pathname : ".",
  };
};

export const DocumentationLink: NonNullable<Framework["Link"]> = ({
  href,
  prefetch = true,
  ...props
}) => {
  const target = href ? internalLinkTarget(href) : null;

  if (!target) {
    return <a href={href} {...props} />;
  }

  return (
    <RouterLink
      {...props}
      hash={target.hash}
      preload={prefetch ? "intent" : false}
      search={target.search}
      to={target.to}
    />
  );
};
