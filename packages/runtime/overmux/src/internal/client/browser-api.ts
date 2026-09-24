import type { RuntimeManifest } from "../shared/index";
import type {
  ContractInputArguments,
  InstanceIdentity,
} from "../../public/index";
import type { z } from "zod";

import type { ClientTransport } from "./transport";

type Operations<TConfig> = TConfig extends { operations?: infer TOperations }
  ? NonNullable<TOperations>
  : never;
type InputOf<T> = T extends { input: infer TInput extends z.ZodType }
  ? TInput
  : never;
type OutputOf<T> = T extends { output: infer TOutput extends z.ZodType }
  ? z.output<TOutput>
  : never;
type OperationId<TConfig> = Extract<keyof Operations<TConfig>, string>;
type OperationInput<TConfig, TId extends OperationId<TConfig>> = InputOf<
  Operations<TConfig>[TId]
>;
type OperationOutput<TConfig, TId extends OperationId<TConfig>> = OutputOf<
  Operations<TConfig>[TId]
>;
type OperationArguments<TInput extends z.ZodType> = [
  ...ContractInputArguments<TInput>,
  signal?: AbortSignal,
];

type InstanceGetters = {
  getInstanceId: () => string | undefined;
  getDeepLinkPrefix: () => string | undefined;
};

export type OvermuxServerApi<TServerConfig> = InstanceGetters & {
  executeOperation: <TId extends OperationId<TServerConfig>>(
    id: TId,
    ...args: OperationArguments<OperationInput<TServerConfig, TId>>
  ) => Promise<OperationOutput<TServerConfig, TId>>;
};

export type RuntimeOvermuxServerApi = InstanceGetters & {
  getInstance: () => InstanceIdentity | undefined;
  subscribeInstance: (listener: () => void) => () => void;
  executeOperation: (
    id: string,
    input?: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  openStream: (input: {
    id: string;
    input?: unknown;
    onClose: () => void;
    onError: (error: Error) => void;
    onMessage: (message: unknown) => void;
    onOpen: () => void;
  }) => { close: () => void; send: (message: unknown) => boolean };
  readResource: (input: { id: string; input?: unknown }) => Promise<unknown>;
  subscribeResource: (input: {
    id: string;
    input?: unknown;
    onError: (error: Error) => void;
    onInvalidate: () => void;
  }) => () => void;
};

const availableName = (
  names: readonly string[],
  kind: "Resource" | "Stream",
  name: string,
) => {
  if (!names.includes(name)) {
    throw new Error(`${kind} is not available: ${name}`);
  }
  return name;
};

export const createOvermuxServerApi = ({
  manifest,
  transport,
}: {
  manifest: RuntimeManifest;
  transport: ClientTransport;
}): RuntimeOvermuxServerApi => ({
  getInstance: transport.getInstance,
  subscribeInstance: transport.subscribeInstance,
  getInstanceId: () => transport.getInstance()?.instanceId,
  getDeepLinkPrefix: () => transport.getInstance()?.deepLinkPrefix,
  executeOperation: (id, input, signal) => {
    if (!manifest.operations.includes(id)) {
      throw new Error(`Operation is not available: ${id}`);
    }
    return transport.invokeOperation({ input, name: id, signal });
  },
  openStream: ({ id, ...input }) =>
    transport.openStream({
      ...input,
      streamName: availableName(manifest.streams, "Stream", id),
    }),
  readResource: ({ id, input }) =>
    transport.readResource({
      input,
      resourceName: availableName(manifest.resources, "Resource", id),
    }),
  subscribeResource: ({ id, ...input }) =>
    transport.subscribeResource({
      ...input,
      resourceName: availableName(manifest.resources, "Resource", id),
    }),
});
