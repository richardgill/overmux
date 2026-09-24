import { expect, test, vi } from "vitest";

const render = vi.fn();
const createRoot = vi.fn(() => ({ render }));

vi.mock("react-dom/client", () => ({ createRoot }));
vi.mock("./auth-shell", () => ({ AuthShell: () => null }));

test("removes a login ticket from history before rendering it", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, "", "/login?source=cli#ticket=secret");
  const replaceState = vi.spyOn(window.history, "replaceState");

  await import("./entry");

  expect(replaceState).toHaveBeenCalledWith(null, "", "/login?source=cli");
  expect(createRoot).toHaveBeenCalledWith(document.querySelector("#root"));
  expect(render.mock.calls[0]?.[0].props.ticket).toBe("secret");
});
