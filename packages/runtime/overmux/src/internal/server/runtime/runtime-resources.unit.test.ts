import {
  defineResourceContract,
  type RuntimeDisposer,
  type SubscriptionResourceDefinition,
} from "../../../public/index";
import { describe, expect, it, test as testCases, vi } from "vitest";
import { z } from "zod";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import { createRuntimeInstance } from "./runtime-instance";
import {
  createRuntimeResources,
  type RuntimeResourceDefinitions,
} from "./runtime-resources";

const input = z.object({ value: z.number() });
const countContract = defineResourceContract({
  input,
  output: z.object({ count: z.number() }),
});
const doubledContract = defineResourceContract({
  input,
  output: z.object({ doubled: z.number() }),
});

type Subscribe = SubscriptionResourceDefinition<
  typeof countContract.input,
  typeof countContract.output
>["subscribe"];

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const prepareResources = (definitions: RuntimeResourceDefinitions) => {
  const lifecycle = createRuntimeLifecycle();
  const resources = createRuntimeResources({
    definitions,
    instance: createRuntimeInstance("test").context,
    lifecycle,
  });
  return { lifecycle, resources };
};

const sourceDefinition = (subscribe: Subscribe) => ({
  contract: countContract,
  kind: "subscription" as const,
  read: ({ value }: z.output<typeof input>) => ({ count: value }),
  subscribe,
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
    await resources
      .get("unrelated")!
      .subscribe({ value: 3 }, unrelatedListener);
    unrelatedListener.mockClear();

    await expect(doubled.read({ value: 3 })).resolves.toEqual({ doubled: 6 });
    const disposeFirst = await doubled.subscribe({ value: 2 }, firstListener);
    const disposeSecond = await doubled.subscribe({ value: 3 }, secondListener);
    firstListener.mockClear();
    secondListener.mockClear();
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

  testCases.each(["synchronous", "asynchronous"] as const)(
    "supports %s setup and refreshes only the new subscriber",
    async (setupKind) => {
      const cleanup = vi.fn(async () => undefined);
      const subscribe = vi.fn<Subscribe>(() =>
        setupKind === "asynchronous" ? Promise.resolve(cleanup) : cleanup,
      );
      const { resources, lifecycle } = prepareResources({
        source: sourceDefinition(subscribe),
      });
      const source = resources.get("source")!;
      const first = vi.fn();
      const second = vi.fn();

      const disposeFirst = await source.subscribe({ value: 1 }, first);
      const disposeSecond = await source.subscribe({ value: 1 }, second);

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      await disposeFirst();
      expect(subscribe.mock.calls[0]![2].signal.aborted).toBe(true);
      first.mockClear();
      second.mockClear();
      subscribe.mock.calls[0]![1]();
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      await disposeFirst();
      await disposeSecond();
      await lifecycle.dispose();
      expect(cleanup).toHaveBeenCalledTimes(2);
    },
  );

  testCases.each(["unsubscribe", "shutdown"] as const)(
    "cancels pending setup on %s without waiting, then releases late cleanup",
    async (ending) => {
      const setup = deferred<RuntimeDisposer>();
      const subscribe = vi.fn<Subscribe>(() => setup.promise);
      const cleanup = vi.fn(async () => undefined);
      const { resources, lifecycle } = prepareResources({
        source: sourceDefinition(subscribe),
      });
      const controller = new AbortController();
      const listener = vi.fn();
      const pending = resources
        .get("source")!
        .subscribe({ value: 1 }, listener, controller.signal);
      const context = subscribe.mock.calls[0]![2];

      if (ending === "shutdown") {
        await lifecycle.dispose();
      } else {
        controller.abort();
      }

      expect(context.signal.aborted).toBe(true);
      setup.resolve(cleanup);
      await expect(pending).rejects.toBe(context.signal.reason);
      subscribe.mock.calls[0]![1]();
      expect(listener).not.toHaveBeenCalled();
      await lifecycle.dispose();
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it("parses subscription input once and uses that key for invalidation", async () => {
    const parseInput = vi.fn((value: string) => Number(value));
    const subscribe = vi.fn(() => vi.fn());
    const { resources, lifecycle } = prepareResources({
      source: {
        contract: {
          input: z.string().transform(parseInput),
          output: z.number(),
        },
        kind: "subscription",
        read: (value) => value,
        subscribe,
      },
    });
    const listener = vi.fn();
    const dispose = await resources.get("source")!.subscribe("01", listener);
    listener.mockClear();

    resources.invalidate("source", "1");

    expect(subscribe).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      expect.any(Object),
    );
    expect(parseInput.mock.calls.map(([value]) => value)).toEqual(["01", "1"]);
    expect(listener).toHaveBeenCalledOnce();
    await dispose();
    await lifecycle.dispose();
  });

  it("handles synchronous invalidation that cancels before setup returns cleanup", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition((_input, invalidate) => {
        invalidate();
        return cleanup;
      }),
    });

    await expect(
      resources
        .get("source")!
        .subscribe({ value: 1 }, () => controller.abort(), controller.signal),
    ).rejects.toBe(controller.signal.reason);

    expect(cleanup).toHaveBeenCalledOnce();
    await lifecycle.dispose();
  });

  it("keeps late cleanup rejection observable after cancellation", async () => {
    const setup = deferred<RuntimeDisposer>();
    const failure = new Error("late cleanup failed");
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition(() => setup.promise),
    });
    const controller = new AbortController();
    const pending = resources
      .get("source")!
      .subscribe({ value: 1 }, vi.fn(), controller.signal);
    controller.abort();

    setup.resolve(() => {
      throw failure;
    });

    await expect(pending).rejects.toBe(failure);
    await lifecycle.dispose();
  });

  it("awaits and deduplicates derived dependencies before refreshing", async () => {
    const setup = deferred<RuntimeDisposer>();
    const cleanup = vi.fn();
    const subscribe = vi.fn<Subscribe>(() => setup.promise);
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition(subscribe),
      branch: {
        contract: countContract,
        kind: "derived",
        dependencies: { source: "source" },
        combine: ({ source }) => source,
      },
      derived: {
        contract: doubledContract,
        kind: "derived",
        dependencies: { first: "source", second: "branch" },
        combine: ({ first, second }) => ({
          doubled: first.count + second.count,
        }),
      },
    });
    const listener = vi.fn();
    const pending = resources.get("derived")!.subscribe({ value: 1 }, listener);
    expect(listener).not.toHaveBeenCalled();

    setup.resolve(cleanup);
    const dispose = await pending;

    expect(subscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    await dispose();
    await lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("parses each reachable contract once from raw input and reads shared dependencies once", async () => {
    const parseSource = vi.fn(Number);
    const parseBranch = vi.fn((key: string) => ({ key }));
    const parseRoot = vi.fn((key: string) => `root:${key}`);
    const read = vi.fn((value: number) => value);
    const subscribe = vi.fn(() => vi.fn());
    const { resources, lifecycle } = prepareResources({
      source: {
        kind: "subscription",
        contract: {
          input: z.string().transform(parseSource),
          output: z.number().transform((count) => ({ count })),
        },
        read,
        subscribe,
      },
      branch: {
        kind: "derived",
        contract: {
          input: z.string().transform(parseBranch),
          output: z.number(),
        },
        dependencies: { source: "source" },
        combine: ({ source }) => source.count,
      },
      derived: {
        kind: "derived",
        contract: {
          input: z.string().transform(parseRoot),
          output: z.number(),
        },
        dependencies: { source: "source", branch: "branch" },
        combine: ({ source, branch }) => source.count + branch,
      },
    });
    const derived = resources.get("derived")!;
    await expect(derived.read("01")).resolves.toBe(2);
    expect(read).toHaveBeenCalledOnce();
    for (const parse of [parseSource, parseBranch, parseRoot]) {
      expect(parse.mock.calls.map(([value]) => value)).toEqual(["01"]);
      parse.mockClear();
    }

    const listener = vi.fn();
    await derived.subscribe("01", listener);
    expect(subscribe).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      expect.any(Object),
    );
    listener.mockClear();
    resources.invalidate("source", "1");
    expect(listener).toHaveBeenCalledOnce();
    expect(parseSource.mock.calls.map(([value]) => value)).toEqual(["01", "1"]);
    for (const parse of [parseBranch, parseRoot]) {
      expect(parse.mock.calls.map(([value]) => value)).toEqual(["01"]);
    }
    await lifecycle.dispose();
  });

  testCases.each(["unsubscribe", "shutdown"] as const)(
    "releases acquired derived dependencies on %s, then releases late setup once",
    async (ending) => {
      const setup = deferred<RuntimeDisposer>();
      const reachedSecond = deferred<void>();
      const cleanupFirst = vi.fn();
      const cleanupLate = vi.fn();
      const third = vi.fn<Subscribe>(() => vi.fn<RuntimeDisposer>());
      const { resources, lifecycle } = prepareResources({
        first: sourceDefinition(() => cleanupFirst),
        second: sourceDefinition(() => {
          reachedSecond.resolve();
          return setup.promise;
        }),
        third: sourceDefinition(third),
        derived: {
          kind: "derived",
          contract: countContract,
          dependencies: { first: "first", second: "second", third: "third" },
          combine: ({ first }) => first,
        },
      });
      const controller = new AbortController();
      const listener = vi.fn();
      const pending = resources
        .get("derived")!
        .subscribe({ value: 1 }, listener, controller.signal);
      await reachedSecond.promise;

      if (ending === "shutdown") {
        await lifecycle.dispose();
      } else {
        controller.abort();
      }
      await vi.waitFor(() => expect(cleanupFirst).toHaveBeenCalledOnce());
      setup.resolve(cleanupLate);
      await expect(pending).rejects.toThrow();
      resources.invalidate("first");
      expect(listener).not.toHaveBeenCalled();
      expect(third).not.toHaveBeenCalled();
      expect(cleanupLate).toHaveBeenCalledOnce();
      await lifecycle.dispose();
      expect(cleanupFirst).toHaveBeenCalledOnce();
    },
  );

  it("does not parse or activate pre-aborted derived requests, or combine after read cancellation", async () => {
    const parse = vi.fn((value) => value);
    const setup = vi.fn<Subscribe>(() => vi.fn<RuntimeDisposer>());
    const output = deferred<{ count: number }>();
    const read = vi.fn(() => output.promise);
    const combine = vi.fn(({ source }) => source);
    const { resources, lifecycle } = prepareResources({
      source: { ...sourceDefinition(setup), read },
      derived: {
        kind: "derived",
        contract: { ...countContract, input: input.transform(parse) },
        dependencies: { source: "source" },
        combine,
      },
    });
    const derived = resources.get("derived")!;
    const reason = new Error("request cancelled");
    const signal = AbortSignal.abort(reason);
    await expect(derived.read({ value: 1 }, signal)).rejects.toBe(reason);
    await expect(derived.subscribe({ value: 1 }, vi.fn(), signal)).rejects.toBe(
      reason,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pending = derived.read({ value: 1 }, controller.signal);
    controller.abort(reason);
    output.resolve({ count: 1 });
    await expect(pending).rejects.toBe(reason);
    expect(combine).not.toHaveBeenCalled();
    await lifecycle.dispose();
  });

  testCases.each(["invalidation", "refresh"] as const)(
    "cancels a derived subscription during synchronous %s",
    async (event) => {
      const controller = new AbortController();
      const reason = new Error("cancelled during " + event);
      const cleanup = vi.fn();
      const { resources, lifecycle } = prepareResources({
        source: sourceDefinition((_input, invalidate) => {
          if (event === "invalidation") {
            invalidate();
          }
          return cleanup;
        }),
        derived: {
          kind: "derived",
          contract: countContract,
          dependencies: { source: "source" },
          combine: ({ source }) => source,
        },
      });
      await expect(
        resources
          .get("derived")!
          .subscribe(
            { value: 1 },
            () => controller.abort(reason),
            controller.signal,
          ),
      ).rejects.toBe(reason);
      expect(cleanup).toHaveBeenCalledOnce();
      await lifecycle.dispose();
    },
  );

  it("rolls back earlier dependencies and reports setup and cleanup failures", async () => {
    const setupFailure = new Error("setup failed");
    const cleanupFailure = new Error("cleanup failed");
    const cleanup = vi.fn(() => {
      throw cleanupFailure;
    });
    const firstSetup = deferred<RuntimeDisposer>();
    const first = vi.fn<Subscribe>(() => firstSetup.promise);
    const second = vi.fn<Subscribe>(async () => {
      throw setupFailure;
    });
    const { resources, lifecycle } = prepareResources({
      first: sourceDefinition(first),
      second: sourceDefinition(second),
      derived: {
        contract: doubledContract,
        kind: "derived",
        dependencies: { first: "first", second: "second" },
        combine: () => ({ doubled: 0 }),
      },
    });
    const listener = vi.fn();

    const pending = resources.get("derived")!.subscribe({ value: 1 }, listener);
    expect(second).not.toHaveBeenCalled();
    firstSetup.resolve(cleanup);

    await expect(pending).rejects.toMatchObject({
      errors: [setupFailure, { errors: [cleanupFailure] }],
    });

    resources.invalidate("first");
    expect(listener).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    await lifecycle.dispose();
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
