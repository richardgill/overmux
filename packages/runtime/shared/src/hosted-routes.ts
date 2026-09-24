export const overmuxSettingsPath = "/_overmux/settings";
export const overmuxLogoutPath = "/_overmux/logout";

const reservedPathPrefixes = ["/_overmux", "/api", "/login"];
const returnToBase = "https://overmux.invalid";

const isReservedPath = (pathname: string) =>
  reservedPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

export const resolveOvermuxReturnTo = (candidate?: string | null) => {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }
  try {
    const url = new URL(candidate, returnToBase);
    const decodedPathname = decodeURIComponent(url.pathname);
    if (url.origin !== returnToBase || isReservedPath(decodedPathname)) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};

export const createOvermuxSettingsPath = (returnTo?: string | null) => {
  const safeReturnTo = resolveOvermuxReturnTo(returnTo);
  if (safeReturnTo === "/") {
    return overmuxSettingsPath;
  }
  const search = new URLSearchParams({ returnTo: safeReturnTo });
  return `${overmuxSettingsPath}?${search.toString()}`;
};
