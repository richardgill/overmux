import {
  defineResourceContract,
  noInputSchema,
  type HandlerContext,
  type SubscriptionResourceDefinition,
} from "overmux";

import { tmuxStateSchema, type TmuxState } from "../shared/state-contract";
import type { TmuxBackend } from "./backend";
import { observeTmuxDiagnostics } from "./diagnostics";

export type TmuxStateResource = SubscriptionResourceDefinition<
  typeof noInputSchema,
  typeof tmuxStateSchema
>;

export const tmuxResource = ({
  backend,
}: {
  backend: TmuxBackend;
}): TmuxStateResource => {
  let initialization: Promise<TmuxState> | undefined;
  let initialized = false;
  const subscribers = new Set<() => void>();
  let unsubscribeBackend: (() => void) | undefined;

  const read = (_input: void, context: HandlerContext) => {
    if (initialized) {
      return backend.state();
    }
    if (!initialization) {
      const releaseLogger = observeTmuxDiagnostics(
        backend,
        context.logger,
        context.signal,
      );
      initialization = backend.refresh(context.signal).then((state) => {
        initialized = true;
        return state;
      });
      void initialization
        .finally(() => {
          releaseLogger();
          initialization = undefined;
        })
        .catch(() => undefined);
    }
    return initialization;
  };
  return {
    contract: defineResourceContract({
      input: noInputSchema,
      output: tmuxStateSchema,
    }),
    kind: "subscription",
    read,
    subscribe: (_input, invalidate, context: HandlerContext) => {
      if (context.signal.aborted) {
        return () => undefined;
      }
      const releaseLogger = observeTmuxDiagnostics(
        backend,
        context.logger,
        context.signal,
      );
      let disposed = false;
      const dispose = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        releaseLogger();
        context.signal.removeEventListener("abort", dispose);
        subscribers.delete(invalidate);
        if (!subscribers.size) {
          unsubscribeBackend?.();
          unsubscribeBackend = undefined;
        }
      };
      subscribers.add(invalidate);
      if (!unsubscribeBackend) {
        unsubscribeBackend = backend.subscribe(() => {
          subscribers.forEach((subscriber) => subscriber());
        });
      }
      context.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
};
