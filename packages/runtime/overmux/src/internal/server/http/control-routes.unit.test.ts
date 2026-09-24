import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { createAuthenticatedTestHttpApp } from "./authenticated-http-app-test-helper";

describe("restart HTTP acknowledgement", () => {
  it("becomes unhealthy before requesting restart after the response finishes", async () => {
    let app: ReturnType<typeof createAuthenticatedTestHttpApp>;
    const onRestartRequested = vi.fn(async () =>
      app.fetch(new Request("http://overmux.test/api/health")),
    );
    const outgoing = new EventEmitter();
    app = createAuthenticatedTestHttpApp({
      onRestartRequested,
      runtime: {} as never,
    });

    const response = await app.fetch(
      new Request("http://overmux.test/api/restart", { method: "POST" }),
      { outgoing } as never,
    );

    expect(response.status).toBe(202);
    expect(onRestartRequested).not.toHaveBeenCalled();

    outgoing.emit("finish");

    expect(onRestartRequested).toHaveBeenCalledOnce();
    await expect(
      onRestartRequested.mock.results[0]?.value,
    ).resolves.toMatchObject({
      status: 503,
    });
  });

  it("acknowledges restart without requesting shutdown when no callback is configured", async () => {
    const app = createAuthenticatedTestHttpApp({ runtime: {} as never });

    const restart = await app.request("http://overmux.test/api/restart", {
      method: "POST",
    });
    const health = await app.request("http://overmux.test/api/health");

    expect(restart.status).toBe(202);
    expect(await restart.json()).toEqual({ status: "restarting" });
    expect(health.status).toBe(200);
  });
});
