import { parseDeepLink } from "@overmux/shared";
import type { ClientTransport } from "../transport";
import type {} from "./desktop-host";

const defaultNavigate = (route: string) => window.location.assign(route);

/**
 * Intercepts overmux:// anchor activation inside the running app, including the
 * temporary anchors created by xterm's default link handler. Without this,
 * browser/PWA clicks dispatch the custom protocol to the OS, which fails in
 * Android PWAs where it is not possible to install an Overmux protocol handler.
 *
 * Validates the original URL and compares its instance ID with authenticated
 * runtime discovery. For same-instance links, preventDefault stops OS dispatch
 * and navigate receives only the local path, query, and fragment. By default,
 * this loads that route on the current origin; a supplied router callback avoids
 * a document reload. Instance IDs are never treated as network hostnames.
 *
 * Valid cross-instance links remain Desktop's responsibility. Browsers/PWAs
 * block unknown or different instances; all hosts block invalid links. Ordinary
 * links and clicks already cancelled by application code are left untouched.
 * Returns cleanup for the document listeners when the runtime unmounts.
 */
export const installDeepLinkNavigation = ({
  getInstance,
  navigate = defaultNavigate,
}: {
  getInstance: ClientTransport["getInstance"];
  navigate?: (route: string) => unknown;
}) => {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) {
      return;
    }
    const anchor = event
      .composedPath()
      .find(
        (target): target is HTMLAnchorElement =>
          target instanceof HTMLAnchorElement,
      );
    if (anchor?.protocol !== "overmux:") {
      return;
    }
    let link;
    try {
      // Inspect the original attribute before URL normalization can hide unsafe text.
      link = parseDeepLink(anchor.getAttribute("href") ?? "");
    } catch {
      event.preventDefault();
      console.warn("Cannot open an invalid Overmux deep link.");
      return;
    }
    if (link.instanceId !== getInstance()?.instanceId) {
      // Desktop owns registry lookup and cross-instance confirmation. Browsers must
      // never interpret an instance ID as a hostname or assume it names this server.
      if (window.overmuxHost?.version !== 1) {
        event.preventDefault();
        console.warn(
          "Cannot open an Overmux link to an unknown or different instance in this browser.",
        );
      }
      return;
    }
    event.preventDefault();
    navigate(link.route);
  };
  // Bubble after application handlers so preventDefault remains an explicit opt-out.
  // Read identity on activation, not installation: discovery and reconnects can change it.
  document.addEventListener("click", onClick);
  document.addEventListener("auxclick", onClick);
  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("auxclick", onClick);
  };
};
