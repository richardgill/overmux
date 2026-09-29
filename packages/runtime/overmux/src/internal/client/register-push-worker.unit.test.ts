import { afterEach, expect, it, test as testCases, vi } from "vitest";
import { registerPushWorker } from "./register-push-worker";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("waits for activation and removes its listener", async () => {
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const remove = vi.spyOn(worker, "removeEventListener");
  const registration = { installing: worker };
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal("navigator", { serviceWorker: { register } });

  const result = registerPushWorker();
  await Promise.resolve();
  worker.state = "activated";
  worker.dispatchEvent(new Event("statechange"));

  await expect(result).resolves.toBe(registration);
  expect(register).toHaveBeenCalledWith("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  expect(remove).toHaveBeenCalledOnce();
});

testCases.each([
  { name: "registration rejects", mode: "reject", message: "bad MIME type" },
  { name: "registration stalls", mode: "stall", message: "Timed out" },
  { name: "activation stalls", mode: "installing", message: "Timed out" },
  {
    name: "installation fails",
    mode: "redundant",
    message: "failed to activate",
  },
])("rejects when $name", async ({ mode, message }) => {
  vi.useFakeTimers();
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const remove = vi.spyOn(worker, "removeEventListener");
  const register = vi.fn(() => {
    if (mode === "reject") {
      return Promise.reject(new Error("bad MIME type"));
    }
    if (mode === "stall") {
      return new Promise(() => undefined);
    }
    return Promise.resolve({ installing: worker });
  });
  vi.stubGlobal("navigator", { serviceWorker: { register } });

  const result = expect(registerPushWorker()).rejects.toThrow(message);
  await Promise.resolve();
  if (mode === "redundant") {
    worker.state = "redundant";
    worker.dispatchEvent(new Event("statechange"));
  }
  await vi.advanceTimersByTimeAsync(10_000);
  await result;

  expect(vi.getTimerCount()).toBe(0);
  if (mode === "installing" || mode === "redundant") {
    expect(remove).toHaveBeenCalledOnce();
  }
});
