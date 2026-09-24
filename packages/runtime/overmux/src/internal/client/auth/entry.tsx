import { createRoot } from "react-dom/client";

import { AuthShell } from "./auth-shell";

// Keep extraction and URL scrubbing together so the login ticket is removed before React renders.
export const takeLoginTicket = () => {
  const ticket = new URLSearchParams(window.location.hash.slice(1)).get(
    "ticket",
  );
  if (ticket) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return ticket ?? undefined;
};

const root = document.querySelector("#root");

if (!root) {
  throw new Error("The Overmux authentication shell requires a #root element");
}

createRoot(root).render(<AuthShell ticket={takeLoginTicket()} />);
