import type { DesktopApi } from "../shared/contracts.js";

declare global {
  interface Window {
    overmuxDesktop: DesktopApi;
  }
}

export {};
