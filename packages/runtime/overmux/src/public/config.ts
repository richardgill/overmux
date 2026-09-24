import { z } from "zod";

import type { AiContextSnippetDefinition } from "./ai-context";
import type { Notifications } from "./notifications";
import type { ResourceContract, StreamContract } from "./contracts";

export type RuntimeDisposer = () => Promise<void> | void;

export type InstanceContext = {
  getInstanceId: () => string;
  getDeepLinkPrefix: () => string;
};

type ResourceInputMap = Readonly<Record<string, unknown>>;

// Keep IDs paired with their raw inputs when checking calls and reusable handlers.
type InvalidationArguments<TInputs extends ResourceInputMap> = {
  [TId in keyof TInputs & string]: [resourceId: TId, input?: TInputs[TId]];
}[keyof TInputs & string];

export type HandlerContext<TInputs extends ResourceInputMap = {}> = {
  instance: InstanceContext;
  invalidate: (...args: InvalidationArguments<TInputs>) => void;
  signal: AbortSignal;
};

export type OperationContext<TInputs extends ResourceInputMap = {}> =
  HandlerContext<TInputs> & {
    notifications: Notifications;
  };

export type OperationDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodVoid,
  TContext = OperationContext,
> = {
  handle: (
    input: z.output<TInput>,
    context: TContext,
  ) => Promise<z.input<NoInfer<TOutput>>> | z.input<NoInfer<TOutput>>;
  input: TInput;
  output: TOutput;
};

// Infer schemas from this definition, not a surrounding operation map's broad constraint.
export const defineOperation = <
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodVoid,
  TContext = OperationContext,
>({
  handle,
  input,
  output,
}: {
  handle: OperationDefinition<TInput, TOutput, TContext>["handle"];
  input: TInput;
  output?: TOutput;
}): OperationDefinition<NoInfer<TInput>, NoInfer<TOutput>, TContext> => ({
  handle,
  input,
  output: (output ?? z.void()) as TOutput,
});

export type QueryResourceDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
  TContext = HandlerContext,
> = {
  contract: ResourceContract<TInput, TOutput>;
  kind: "query";
  read: (
    input: z.output<TInput>,
    context: TContext,
  ) => Promise<z.input<NoInfer<TOutput>>> | z.input<NoInfer<TOutput>>;
};

export type SubscriptionResourceDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
  TContext = HandlerContext,
> = {
  contract: ResourceContract<TInput, TOutput>;
  kind: "subscription";
  read: QueryResourceDefinition<TInput, TOutput, TContext>["read"];
  subscribe: (
    input: z.output<TInput>,
    invalidate: () => void,
    context: TContext,
  ) => RuntimeDisposer;
};

export type DerivedResourceDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
  TDependencies extends Readonly<Record<string, string>> = Readonly<
    Record<string, string>
  >,
  TDependencyOutputs = Readonly<Record<string, unknown>>,
> = {
  combine: (dependencies: TDependencyOutputs) => z.input<NoInfer<TOutput>>;
  contract: ResourceContract<TInput, TOutput>;
  dependencies: TDependencies;
  kind: "derived";
};

type AnyZodType = z.ZodType<any, any, any>;

export type ResourceDefinition =
  | QueryResourceDefinition<
      AnyZodType,
      AnyZodType,
      HandlerContext<ResourceInputMap>
    >
  | SubscriptionResourceDefinition<
      AnyZodType,
      AnyZodType,
      HandlerContext<ResourceInputMap>
    >
  | DerivedResourceDefinition<AnyZodType, AnyZodType, any, any>;

export type StreamSession<TClientMessage = unknown> = {
  dispose?: RuntimeDisposer;
  onMessage?: (message: TClientMessage) => Promise<void> | void;
};

export type StreamHandlerDefinition<
  TInput extends z.ZodType = z.ZodType,
  TClientMessage extends z.ZodType = z.ZodType,
  TServerMessage extends z.ZodType = z.ZodType,
  TContext = HandlerContext,
> = {
  contract: StreamContract<TInput, TClientMessage, TServerMessage>;
  open: (
    input: z.output<TInput>,
    context: TContext & {
      emit: (message: z.input<NoInfer<TServerMessage>>) => void;
      fail: (cause: unknown) => void;
    },
  ) =>
    | Promise<StreamSession<z.output<TClientMessage>>>
    | StreamSession<z.output<TClientMessage>>;
};

export const defineStreamHandler = <
  TInput extends z.ZodType,
  TClientMessage extends z.ZodType,
  TServerMessage extends z.ZodType,
  TContext = HandlerContext,
>(
  contract: StreamContract<TInput, TClientMessage, TServerMessage>,
  open: StreamHandlerDefinition<
    TInput,
    TClientMessage,
    TServerMessage,
    TContext
  >["open"],
): StreamHandlerDefinition<
  TInput,
  TClientMessage,
  TServerMessage,
  TContext
> => ({
  contract,
  open,
});

type ResourceContracts = Record<
  string,
  ResourceContract<AnyZodType, AnyZodType>
>;

type ResourceInputs<TContracts extends ResourceContracts> = {
  [TId in keyof TContracts]: z.input<TContracts[TId]["input"]>;
};

type DependencyOutputs<
  TContracts extends ResourceContracts,
  TDependencies extends Record<string, unknown>,
> = {
  [TName in keyof TDependencies]: TDependencies[TName] extends keyof TContracts
    ? z.output<TContracts[TDependencies[TName]]["output"]>
    : never;
};

type DependencySource<TDependencies> = {
  [TId in keyof TDependencies]: TDependencies[TId] extends Record<
    string,
    string
  >
    ? { dependencies: TDependencies[TId] }
    : { dependencies?: never };
};

type QueryFor<
  TContract extends ResourceContract<AnyZodType, AnyZodType>,
  TContracts extends ResourceContracts,
> = {
  contract: TContract;
} & Omit<
  QueryResourceDefinition<
    TContract["input"],
    TContract["output"],
    HandlerContext<ResourceInputs<NoInfer<TContracts>>>
  >,
  "contract"
>;

type SubscriptionFor<
  TContract extends ResourceContract<AnyZodType, AnyZodType>,
  TContracts extends ResourceContracts,
> = { contract: TContract } & Omit<
  SubscriptionResourceDefinition<
    TContract["input"],
    TContract["output"],
    HandlerContext<ResourceInputs<NoInfer<TContracts>>>
  >,
  "contract"
>;

type DerivedFor<
  TContract extends ResourceContract<AnyZodType, AnyZodType>,
  TDependencies extends Record<string, string>,
  TDependencyOutputs,
> = {
  combine: (
    dependencies: TDependencyOutputs,
  ) => z.input<NoInfer<TContract["output"]>>;
  contract: TContract;
  dependencies: TDependencies;
  kind: "derived";
};

type ConfiguredResource<
  TContracts extends ResourceContracts,
  TDependencies,
  TId extends keyof TContracts,
> =
  | QueryFor<TContracts[TId], TContracts>
  | SubscriptionFor<TContracts[TId], TContracts>
  | (TId extends keyof TDependencies
      ? TDependencies[TId] extends Record<
          string,
          Exclude<keyof TContracts, TId> & string
        >
        ? DerivedFor<
            TContracts[TId],
            TDependencies[TId],
            DependencyOutputs<TContracts, NoInfer<TDependencies[TId]>>
          >
        : never
      : never);

type ConfiguredResources<
  TContracts extends ResourceContracts,
  TDependencies,
> = {
  [TId in keyof TContracts]: ConfiguredResource<TContracts, TDependencies, TId>;
} & DependencySource<TDependencies>;

export type AuthDuration = `${number}${"m" | "h" | "d"}`;

export type AuthConfigDefinition = {
  mode: "cli-login";
  origins?: string[];
  sessionLifetime?: "forever" | AuthDuration;
  trustedProxyPeer?: string;
};

export type ServerConfigDefinition = {
  host?: string;
  port?: number;
  productionWebAssetsDir?: string;
  watch?: boolean;
};

type StreamDefinitions<TContext = HandlerContext<ResourceInputMap>> = Readonly<
  Record<
    string,
    StreamHandlerDefinition<AnyZodType, AnyZodType, AnyZodType, TContext>
  >
>;

type OperationDefinitions = Readonly<
  Record<
    string,
    OperationDefinition<
      AnyZodType,
      AnyZodType,
      OperationContext<ResourceInputMap>
    >
  >
>;

type OperationInputs = Record<string, AnyZodType>;

type OperationOutputSchema<
  TOutputs,
  TId extends PropertyKey,
> = TId extends keyof TOutputs
  ? TOutputs[TId] extends z.ZodType
    ? TOutputs[TId]
    : z.ZodVoid
  : z.ZodVoid;

type ConfiguredOperations<
  TInputs extends OperationInputs,
  TOutputs,
  TContracts extends ResourceContracts,
> = {
  [TId in keyof TInputs]: {
    input: TInputs[TId];
    output?: OperationOutputSchema<TOutputs, TId>;
    handle: OperationDefinition<
      TInputs[TId],
      OperationOutputSchema<TOutputs, TId>,
      OperationContext<ResourceInputs<TContracts>>
    >["handle"];
  };
} & {
  [TId in keyof TOutputs]: TOutputs[TId] extends z.ZodType
    ? { output: TOutputs[TId] }
    : { output?: never };
};

type NormalizedOperations<
  TInputs extends OperationInputs,
  TOutputs,
  TContracts extends ResourceContracts,
> = {
  [TId in keyof TInputs]: OperationDefinition<
    TInputs[TId],
    OperationOutputSchema<TOutputs, TId>,
    OperationContext<ResourceInputs<TContracts>>
  >;
};

const normalizeOperations = <
  TInputs extends OperationInputs,
  TOutputs,
  TContracts extends ResourceContracts,
>(
  operations: ConfiguredOperations<TInputs, TOutputs, TContracts> | undefined,
): NormalizedOperations<TInputs, TOutputs, TContracts> | undefined => {
  if (operations === undefined) {
    return undefined;
  }
  // Preserve every key and handler; only absent output schemas become ZodVoid.
  return Object.fromEntries(
    Object.entries(operations).map(([id, definition]) => [
      id,
      { ...definition, output: definition.output ?? z.void() },
    ]),
  ) as NormalizedOperations<TInputs, TOutputs, TContracts>;
};

export type ConfigDefinition<
  TResources extends Readonly<Record<string, unknown>> = Readonly<
    Record<string, ResourceDefinition>
  >,
  TStreams extends StreamDefinitions = StreamDefinitions,
  TOperations extends OperationDefinitions = OperationDefinitions,
> = {
  operations?: TOperations;
  resources: TResources;
  streams?: TStreams;
};

export type OvermuxConfigDefinition<
  TServer extends ConfigDefinition = ConfigDefinition,
> = ServerConfigDefinition & {
  aiContextSnippets?: AiContextSnippetDefinition;
  auth: AuthConfigDefinition;
  debug?: boolean;
  instanceId?: string | ((context: { port: number }) => string);
  server: TServer;
  vite?: string;
};

export type OvermuxServerResources<TServer> = TServer extends {
  resources: infer TResources;
}
  ? TResources
  : never;

export type OvermuxServerStreams<TServer> = TServer extends {
  streams?: infer TStreams;
}
  ? NonNullable<TStreams>
  : never;

export type OvermuxServerOperations<TServer> = TServer extends {
  operations?: infer TOperations;
}
  ? NonNullable<TOperations>
  : never;

export const defineOvermuxServer = <
  const TContracts extends ResourceContracts = {},
  const TDependencies = {},
  const TStreams extends StreamDefinitions = {},
  const TInputs extends OperationInputs = {},
  const TOutputs = {},
>(definition: {
  operations?: ConfiguredOperations<TInputs, TOutputs, NoInfer<TContracts>>;
  resources: ConfiguredResources<TContracts, TDependencies>;
  streams?: TStreams &
    StreamDefinitions<HandlerContext<ResourceInputs<NoInfer<TContracts>>>>;
}): ConfigDefinition<
  ConfiguredResources<TContracts, TDependencies>,
  TStreams,
  NormalizedOperations<TInputs, TOutputs, TContracts>
> => ({
  ...definition,
  operations: normalizeOperations(definition.operations),
});

export const defineOvermuxConfig = <const TServer extends ConfigDefinition>(
  definition: OvermuxConfigDefinition<TServer>,
): OvermuxConfigDefinition<TServer> => definition;
