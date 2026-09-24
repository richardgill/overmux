import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  coreAiContextSnippets,
  defaultAiContextSnippets,
  defineOperation,
  defineOvermuxConfig,
  defineOvermuxServer,
  defineResourceContract,
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
  techStackRecommendationsSnippet,
  type AiContextSnippetDefinition,
  type ContractInputArguments,
  type OperationContext,
  type OvermuxServerOperations,
  type OvermuxServerResources,
  type OvermuxServerStreams,
} from "./index";

const countContract = defineResourceContract({
  input: noInputSchema,
  output: z.object({ count: z.number() }),
});

const labelContract = defineResourceContract({
  input: noInputSchema,
  output: z.object({ label: z.string() }),
});

const workspaceContract = defineResourceContract({
  input: noInputSchema,
  output: z.object({ summary: z.string() }),
});

const lookupContract = defineResourceContract({
  input: z.object({ id: z.string().transform((id) => id.length) }),
  output: z.object({ found: z.boolean() }),
});

const watchedContract = defineResourceContract({
  input: z.object({ scope: z.string() }),
  output: z.object({ revision: z.number() }),
});

const eventsContract = defineStreamContract({
  clientMessage: z.object({ acknowledged: z.boolean() }),
  input: noInputSchema,
  serverMessage: z.object({ value: z.string() }),
});

const createConfig = () =>
  defineOvermuxServer({
    operations: {
      refresh: {
        input: noInputSchema,
        output: z.object({ refreshed: z.boolean() }),
        handle: (_input, context) => {
          context.invalidate("count");
          context.invalidate("lookup", { id: "one" });
          context.invalidate("lookup", undefined);
          // @ts-expect-error invalidation IDs must name registered resources
          context.invalidate("missing");
          // @ts-expect-error invalidation accepts raw input, not transformed input
          context.invalidate("lookup", { id: 1 });
          // @ts-expect-error inputs cannot be borrowed from another resource
          context.invalidate("lookup", { scope: "one" });
          const id = context.signal.aborted ? "lookup" : "watched";
          // @ts-expect-error a union ID needs an input matching the selected ID
          context.invalidate(id, { id: "one" });
          // @ts-expect-error no-input resources reject target objects
          context.invalidate("count", {});
          // @ts-expect-error invalidation no longer accepts resource contracts
          context.invalidate(countContract);
          return { refreshed: true };
        },
      },
    },
    resources: {
      count: {
        contract: countContract,
        kind: "query",
        read: () => ({ count: 2 }),
      },
      label: {
        contract: labelContract,
        kind: "subscription",
        read: () => ({ label: "items" }),
        subscribe: (_input, invalidate) => {
          invalidate();
          return () => undefined;
        },
      },
      lookup: {
        contract: lookupContract,
        kind: "query",
        read: (input, context) => {
          expectTypeOf(input).toEqualTypeOf<{ id: number }>();
          context.invalidate("count");
          // @ts-expect-error resource handlers also use the server's IDs
          context.invalidate("missing");
          return { found: input.id > 0 };
        },
      },
      watched: {
        contract: watchedContract,
        kind: "subscription",
        read: (input) => ({ revision: input.scope.length }),
        subscribe: (input, _invalidate, context) => {
          expectTypeOf(input).toEqualTypeOf<{ scope: string }>();
          context.invalidate("lookup", { id: input.scope });
          return () => undefined;
        },
      },
      workspace: {
        combine: ({ count, label }) => {
          expectTypeOf(count).toEqualTypeOf<{ count: number }>();
          expectTypeOf(label).toEqualTypeOf<{ label: string }>();
          return { summary: `${count.count} ${label.label}` };
        },
        contract: workspaceContract,
        dependencies: { count: "count", label: "label" },
        kind: "derived",
      },
    },
    streams: {
      events: defineStreamHandler(eventsContract, (_input, { emit }) => {
        emit({ value: "ready" });
        return { onMessage: ({ acknowledged }) => void acknowledged };
      }),
      invalidate: {
        contract: eventsContract,
        open: (_input, context) => {
          context.invalidate("count");
          // @ts-expect-error plain streams also use registered resource IDs
          context.invalidate("missing");
          return {};
        },
      },
    },
  });

describe("object-keyed configuration", () => {
  it("separates application and trusted server configuration", () => {
    const server = createConfig();
    const config = defineOvermuxConfig({
      auth: {
        mode: "cli-login",
        origins: ["http://localhost:4242", "https://machine.example.com"],
        trustedProxyPeer: "127.0.0.1",
      },
      host: "0.0.0.0",
      port: 4242,
      productionWebAssetsDir: "./dist",
      server,
      vite: "./vite.config.ts",
      watch: true,
    });

    expect(config).toMatchObject({
      auth: {
        origins: ["http://localhost:4242", "https://machine.example.com"],
        trustedProxyPeer: "127.0.0.1",
      },
      host: "0.0.0.0",
      port: 4242,
      productionWebAssetsDir: "./dist",
      server,
      vite: "./vite.config.ts",
      watch: true,
    });
    expectTypeOf(config.server).toEqualTypeOf(server);
  });

  it("types the configurable AI context snippets", () => {
    const server = createConfig();
    const selections: AiContextSnippetDefinition[] = [
      defaultAiContextSnippets,
      coreAiContextSnippets,
      [techStackRecommendationsSnippet],
      [],
    ];
    const configs = selections.map((aiContextSnippets) =>
      defineOvermuxConfig({
        aiContextSnippets,
        auth: { mode: "cli-login" },
        server,
      }),
    );
    const invalidSelection = () =>
      defineOvermuxConfig({
        // @ts-expect-error snippet names are a closed public API
        aiContextSnippets: ["unknown"],
        auth: { mode: "cli-login" },
        server,
      });

    expect(configs.map(({ aiContextSnippets }) => aiContextSnippets)).toEqual([
      ["package-source", "tech-stack-recommendations"],
      ["package-source"],
      ["tech-stack-recommendations"],
      [],
    ]);
    expect(invalidSelection).toBeTypeOf("function");
  });

  it("accepts a minimal server with the exact empty operation maps", () => {
    const config = defineOvermuxServer({ resources: {} });
    type ServerConfig = typeof config;

    expectTypeOf<
      keyof OvermuxServerResources<ServerConfig>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      keyof OvermuxServerOperations<ServerConfig>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      keyof OvermuxServerStreams<ServerConfig>
    >().toEqualTypeOf<never>();
    expect(config).toEqual({ resources: {} });
  });

  it("defines resources, streams, operations, and no-input contracts", () => {
    expect(createConfig()).toMatchObject({
      operations: { refresh: {} },
      resources: {
        count: { kind: "query" },
        label: { kind: "subscription" },
        lookup: { kind: "query" },
        watched: { kind: "subscription" },
        workspace: { kind: "derived" },
      },
      streams: { events: {} },
    });
    expect(
      createConfig().operations!.refresh.input.parse(undefined),
    ).toBeUndefined();
  });

  it("defaults plain operation outputs without mutating their definitions", () => {
    const refresh = { input: noInputSchema, handle: () => undefined };
    const server = defineOvermuxServer({
      resources: {},
      operations: { refresh },
    });

    expect(server.operations!.refresh.output).toBeInstanceOf(z.ZodVoid);
    expectTypeOf(server.operations!.refresh.output).toEqualTypeOf<z.ZodVoid>();
    expect(server.operations!.refresh.handle).toBe(refresh.handle);
    expect(refresh).not.toHaveProperty("output");
  });

  it("checks reusable operations against registered resource inputs", () => {
    const refresh = defineOperation({
      input: noInputSchema,
      handle: (
        _input,
        context: OperationContext<{
          lookup: z.input<typeof lookupContract.input>;
        }>,
      ) => context.invalidate("lookup", { id: "one" }),
    });
    const valid = defineOvermuxServer({
      resources: {
        lookup: {
          contract: lookupContract,
          kind: "query",
          read: () => ({ found: true }),
        },
      },
      operations: { refresh },
    });
    const missingResource = () =>
      defineOvermuxServer({
        resources: {},
        // @ts-expect-error reusable operation requires the lookup resource
        operations: { refresh },
      });
    const wrongInput = () =>
      defineOvermuxServer({
        resources: {
          lookup: {
            contract: watchedContract,
            kind: "query",
            read: () => ({ revision: 1 }),
          },
        },
        // @ts-expect-error lookup must accept the operation's required input
        operations: { refresh },
      });

    expect(valid.operations!.refresh.output).toBeInstanceOf(z.ZodVoid);
    expectTypeOf(valid.operations!.refresh.output).toEqualTypeOf<z.ZodVoid>();
    expect(missingResource).toBeTypeOf("function");
    expect(wrongInput).toBeTypeOf("function");
  });

  it("checks plain operation outputs and empty resource contexts", () => {
    const invalid = () =>
      defineOvermuxServer({
        resources: {},
        operations: {
          explicitOutput: {
            input: noInputSchema,
            output: z.string(),
            // @ts-expect-error output schema determines the handler return type
            handle: () => 123,
          },
          implicitVoid: {
            input: noInputSchema,
            // @ts-expect-error an omitted output schema defaults to void
            handle: () => 123,
          },
          refresh: {
            input: noInputSchema,
            handle: (_input, context) => {
              // @ts-expect-error empty servers have no valid resource IDs
              context.invalidate("missing");
            },
          },
        },
      });

    expect(invalid).toBeTypeOf("function");
  });

  it("preserves exact operation maps for typed clients", () => {
    type ServerConfig = ReturnType<typeof createConfig>;
    type Resources = OvermuxServerResources<ServerConfig>;
    type Operations = OvermuxServerOperations<ServerConfig>;
    type Streams = OvermuxServerStreams<ServerConfig>;

    expectTypeOf<keyof Resources>().toEqualTypeOf<
      "count" | "label" | "lookup" | "watched" | "workspace"
    >();
    expectTypeOf<keyof Operations>().toEqualTypeOf<"refresh">();
    expectTypeOf<keyof Streams>().toEqualTypeOf<"events" | "invalidate">();
    expectTypeOf<Resources["lookup"]["contract"]>().toEqualTypeOf<
      typeof lookupContract
    >();
    expectTypeOf<Operations["refresh"]["input"]>().toEqualTypeOf<
      typeof noInputSchema
    >();
    expectTypeOf<z.output<Operations["refresh"]["output"]>>().toEqualTypeOf<{
      refreshed: boolean;
    }>();
    expectTypeOf<Streams["events"]["contract"]>().toEqualTypeOf<
      typeof eventsContract
    >();

    const readWithoutInput = (
      ..._args: ContractInputArguments<typeof countContract.input>
    ) => undefined;
    const readLookup = (
      ..._args: ContractInputArguments<typeof lookupContract.input>
    ) => undefined;
    expect(() => readWithoutInput()).not.toThrow();
    expect(() => readLookup({ id: "one" })).not.toThrow();
  });

  it("types derived dependencies as sibling resources", () => {
    const createInvalidConfig = () =>
      defineOvermuxServer({
        resources: {
          count: {
            contract: countContract,
            kind: "query",
            read: () => ({ count: 1 }),
          },
          workspace: {
            combine: () => ({ summary: "invalid" }),
            contract: workspaceContract,
            dependencies: { missing: "missing" },
            // @ts-expect-error dependency IDs must name sibling resources
            kind: "derived",
          },
        },
      });

    expect(createInvalidConfig).toBeTypeOf("function");
  });
});
