import { describe, expect, it } from "vitest";

import { serializeBrowserLogArguments } from "./browser-log-forwarding";

describe("browser log forwarding", () => {
  it("safely bounds cyclic and non-serializable console arguments", () => {
    const cyclic: Record<string, unknown> = { value: 1n };
    cyclic.self = cyclic;
    const serialized = serializeBrowserLogArguments([
      cyclic,
      Symbol("symbol"),
      "x".repeat(20_000),
    ]);

    expect(serialized.length).toBeLessThanOrEqual(16_013);
    expect(serialized).toContain("[Circular]");
    expect(serialized).toContain("1n");
    expect(serialized).toContain("[truncated]");
  });
});
