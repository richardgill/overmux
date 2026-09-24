import { instanceIdSchema } from "./instance";

export class UrlPolicyError extends Error {}

export type DeepLink = {
  instanceId: string;
  route: string;
};

// Validates a slash-prefixed route and returns its original text unchanged.
// "/files/a%20b?tab=one#details" → same string; "//evil.example" → throws.
// Also rejects malformed encoding, decoded backslashes, and control characters.
export const validateDeepLinkPath = (input: string) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new UrlPolicyError("Deep link path must be a safe relative path.");
  }
  const hasControlCharacter = [...decoded].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    !input.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    hasControlCharacter
  ) {
    throw new UrlPolicyError("Deep link path must be a safe relative path.");
  }
  return input;
};

// Parses a deep link into an instance ID and application route (defaults to "/").
// Input: "overmux://rich-work-4242/tmux/%25647?tab=terminal#pane-2"
// Output: { instanceId: "rich-work-4242", route: "/tmux/%25647?tab=terminal#pane-2" }
// Throws for invalid IDs or unsafe routes.
// Authority is an opaque registry key, never a hostname or a destination.
// Validate raw text before URL parsing can erase unsafe characters or dot segments.
export const parseDeepLink = (input: string): DeepLink => {
  const match = /^overmux:\/\/([^/?#]+)(.*)$/i.exec(input);
  const identity = instanceIdSchema.safeParse(match?.[1]);
  if (!match || !identity.success || /\s/.test(input)) {
    throw new UrlPolicyError(
      "Deep link must contain a canonical Overmux instance ID.",
    );
  }
  const suffix = match[2];
  const route = validateDeepLinkPath(
    suffix.startsWith("/") ? suffix : `/${suffix}`,
  );
  const pathname = route.split(/[?#]/, 1)[0];
  if (
    pathname
      .split("/")
      .some((segment) => /^\.{1,2}$/.test(decodeURIComponent(segment)))
  ) {
    throw new UrlPolicyError("Deep link path cannot contain dot segments.");
  }
  return { instanceId: identity.data, route };
};
