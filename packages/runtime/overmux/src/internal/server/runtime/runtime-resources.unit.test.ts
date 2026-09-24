import { defineResourceContract } from "../../../public/index";
import { describe, expect, it, test as testCases, vi } from "vitest";
import { z } from "zod";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import { createRuntimeInstance } from "./runtime-instance";
import { createRuntimeResources } from "./runtime-resources";

const input = z.object({ value: z.number() });
const countContract = defineResourceContract({
  input,
  output: z.object({ count: z.number() }),
});
const doubledContract = defineResourceContract({
  input,
  output: z.object({ doubled: z.number() }),
});

describe("runtime resources", () => {
  it("reads dependency values and invalidates matching transitive instances", async () => {
    const lifecycle = createRuntimeLifecycle();
    const invalidators = new Map<number, () => void>();
    const disposeWatcher = vi.fn();
    const resources = createRuntimeResources({
      definitions: {
        source: {
          contract: countContract,
          kind: "subscription",
          read: ({ value }) => ({ count: value }),
          subscribe: ({ value }, invalidate) => {
            invalidators.set(value, invalidate);
            return disposeWatcher;
          },
        },
        unrelated: {
          contract: countContract,
          kind: "query",
          read: ({ value }) => ({ count: value }),
        },
        doubled: {
          combine: ({ source }) => ({ doubled: source.count * 2 }),
          contract: doubledContract,
          dependencies: { source: "source" },
          kind: "derived",
        },
      },
      instance: createRuntimeInstance("test").context,
      lifecycle,
    });
    expect(resources.names).toEqual(["source", "unrelated", "doubled"]);
    const doubled = resources.get("doubled")!;
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unrelatedListener = vi.fn();
    resources.get("unrelated")!.subscribe({ value: 3 }, unrelatedListener);

    await expect(doubled.read({ value: 3 })).resolves.toEqual({ doubled: 6 });
    const disposeFirst = doubled.subscribe({ value: 2 }, firstListener);
    const disposeSecond = doubled.subscribe({ value: 3 }, secondListener);
    invalidators.get(2)?.();

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    expect(() =>
      resources.invalidate("source", { value: "invalid" }),
    ).toThrow();
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    resources.invalidate("source", { value: 3, ignored: true });
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();

    resources.invalidate("source");
    expect(firstListener).toHaveBeenCalledTimes(2);
    expect(secondListener).toHaveBeenCalledTimes(2);
    expect(unrelatedListener).not.toHaveBeenCalled();

    await Promise.all([disposeFirst(), disposeSecond()]);
    await lifecycle.dispose();
    expect(disposeWatcher).toHaveBeenCalledTimes(2);
  });

  testCases.each(["missing", "", "toString", "constructor", "__proto__"])(
    "rejects unknown resource ID %j",
    async (resourceId) => {
      const lifecycle = createRuntimeLifecycle();
      const resources = createRuntimeResources({
        definitions: {},
        instance: createRuntimeInstance("test").context,
        lifecycle,
      });

      expect(() => resources.invalidate(resourceId)).toThrow(
        `Unknown resource ID: ${resourceId}`,
      );
      await lifecycle.dispose();
    },
  );
});
