import {
  parseDeepLink,
  UrlPolicyError,
  validateDeepLinkPath,
} from "@overmux/shared";

export { parseDeepLink, UrlPolicyError } from "@overmux/shared";

export type NavigationDecision =
  | { type: "allow" }
  | { type: "deep-link"; url: string }
  | { type: "external"; url: string }
  | { type: "deny" };

export const normalizeHttpUrl = (input: string) => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UrlPolicyError("Enter a valid absolute HTTP or HTTPS URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlPolicyError("Only HTTP and HTTPS Overmux URLs are allowed.");
  }
  if (!url.hostname) {
    throw new UrlPolicyError("The Overmux URL must include a hostname.");
  }
  if (url.username || url.password) {
    throw new UrlPolicyError("Overmux URLs cannot contain credentials.");
  }

  return url.toString();
};

export const getOrigin = (input: string) =>
  new URL(normalizeHttpUrl(input)).origin;

export const isPlainHttp = (input: string) =>
  new URL(normalizeHttpUrl(input)).protocol === "http:";

export const decideNavigation = (
  input: string,
  configuredOrigin: string,
): NavigationDecision => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { type: "deny" };
  }

  if (url.protocol === "overmux:") {
    try {
      parseDeepLink(input);
      return { type: "deep-link", url: input };
    } catch {
      return { type: "deny" };
    }
  }
  if (url.protocol === "file:") {
    return url.hostname === "" || url.hostname === "localhost"
      ? { type: "external", url: url.toString() }
      : { type: "deny" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { type: "deny" };
  }
  return url.origin === configuredOrigin
    ? { type: "allow" }
    : { type: "external", url: url.toString() };
};

export const resolveNotificationPath = (
  path: string,
  configuredUrl: string,
) => {
  const safePath = validateDeepLinkPath(path);
  const origin = getOrigin(configuredUrl);
  const destination = new URL(safePath, `${origin}/`);
  if (destination.origin !== origin) {
    throw new UrlPolicyError(
      "Notification path changed the configured origin.",
    );
  }
  return destination.toString();
};

export const resolveNotificationLink = (link: string, configuredUrl: string) =>
  link.startsWith("/")
    ? resolveNotificationPath(link, configuredUrl)
    : normalizeHttpUrl(link);

// Resolves a parsed route at the chosen connection's origin, ignoring its base path.
// Inputs: "/tmux/%25647?tab=terminal#pane-2", "http://localhost:4242/base"
// Output: "http://localhost:4242/tmux/%25647?tab=terminal#pane-2"
// Throws for unsafe routes or invalid connection URLs.
export const resolveDeepLinkRoute = (route: string, configuredUrl: string) => {
  const origin = getOrigin(configuredUrl);
  const destination = `${origin}${validateDeepLinkPath(route)}`;
  if (new URL(destination).origin !== origin) {
    throw new UrlPolicyError("Deep link path changed the configured origin.");
  }
  // Do not reserialize application text: empty ?/# and percent encoding matter.
  return destination;
};
