import {
  defineResourceContract,
  noInputSchema,
  type HandlerContext,
  type SubscriptionResourceDefinition,
} from "overmux";

import { tmuxStateSchema } from "../shared/state-contract";
import type { TmuxBackend } from "./backend";

export type TmuxStateResource = SubscriptionResourceDefinition<
  typeof noInputSchema,
  typeof tmuxStateSchema
>;

export const tmuxResource = ({
  backend,
}: {
  backend: TmuxBackend;
}): TmuxStateResource => {
  const subscribers = new Set<() => void>();
  let unsubscribeBackend: (() => void) | undefined;

  // The stream has its own backend, and tmux may also change without any UI subscriber.
  // Refresh explicit reads rather than trusting an unobserved worker-local cache.
  const read = (_input: void, context: HandlerContext) =>
    backend.refresh(context.signal);
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
      let disposed = false;
      const dispose = () => {
        if (disposed) {
          return;
        }
        disposed = true;
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
