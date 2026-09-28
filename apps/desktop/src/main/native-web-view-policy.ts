import type { NativeWebViewBounds } from "../shared/native-web-view.js";

export const parseAllowedHttpOrigins = (entries: string[]): Set<string> =>
  new Set(
    entries.map((entry) => {
      const url = new URL(entry);
      // Require an origin, not a URL pattern or a URL whose path is silently discarded.
      if (
        url.protocol !== "http:" ||
        entry.includes("*") ||
        (entry !== url.origin && entry !== `${url.origin}/`)
      ) {
        throw new Error(`Invalid HTTP origin: ${entry}`);
      }
      return url.origin;
    }),
  );

export const isNativeWebUrlAllowed = (input: string, origins: Set<string>) => {
  try {
    const url = new URL(input);
    if (url.username || url.password) {
      return false;
    }
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
          origins.has(url.origin)))
    );
  } catch {
    return false;
  }
};

// DOM rectangles are CSS pixels; Electron bounds are device-independent pixels.
// Clip to the owning server surface so an untrusted renderer cannot cover host chrome.
export const nativeWebViewBounds = (
  bounds: NativeWebViewBounds,
  host: NativeWebViewBounds,
  zoom: number,
): NativeWebViewBounds => {
  const x = Math.max(0, Math.min(host.width, Math.round(bounds.x * zoom)));
  const y = Math.max(0, Math.min(host.height, Math.round(bounds.y * zoom)));
  const right = Math.max(
    x,
    Math.min(host.width, Math.round((bounds.x + bounds.width) * zoom)),
  );
  const bottom = Math.max(
    y,
    Math.min(host.height, Math.round((bounds.y + bounds.height) * zoom)),
  );
  return { x: host.x + x, y: host.y + y, width: right - x, height: bottom - y };
};
