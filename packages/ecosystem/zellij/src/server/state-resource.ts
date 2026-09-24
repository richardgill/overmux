// Adapts the retained Zellij backend to Overmux's subscription resource boundary.
// Reads await the bounded initial plugin snapshot; invalidations follow later SessionUpdate events.
// The final subscriber cooperatively closes the owned pipe process.

import {
  defineResourceContract,
  noInputSchema,
  type HandlerContext,
  type SubscriptionResourceDefinition,
} from "overmux";

import { zellijStateSchema } from "../shared/state-contract";
import type { ZellijBackend } from "./backend";

export type ZellijStateResource = SubscriptionResourceDefinition<
  typeof noInputSchema,
  typeof zellijStateSchema
>;

export const zellijStateResource = ({
  backend,
}: {
  backend: ZellijBackend;
}): ZellijStateResource => {
  const subscribers = new Set<() => void>();
  let unsubscribeBackend: (() => void) | undefined;

  return {
    contract: defineResourceContract({
      input: noInputSchema,
      output: zellijStateSchema,
    }),
    kind: "subscription",
    read: (_input: void, context: HandlerContext) =>
      backend.read(context.signal),
    subscribe: (_input, invalidate, context) => {
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
          void backend.close();
        }
      };
      subscribers.add(invalidate);
      if (!unsubscribeBackend) {
        unsubscribeBackend = backend.subscribe(() =>
          subscribers.forEach((subscriber) => subscriber()),
        );
      }
      context.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
};
