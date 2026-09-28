// Independent resource factories own defaults, authorization, cancellation and terminal subscription failures.
import type { HandlerContext, SubscriptionResourceDefinition } from "overmux";
import {
  gitChangesInputSchema,
  gitChangesSchema,
  gitDiffParamsSchema,
  gitDiffSchema,
  gitResourceOptionsSchema,
  type GitResourceOptions,
} from "../shared";
import { authorizeRepository } from "./repository";
import { readChanges, readDiff } from "./reads";
import { watchRepository } from "./watchers";

export type { GitResourceOptions, GitOperationOptions } from "../shared";
export { gitOperationHandlers } from "./operations";

type GitResourceState = {
  allowedRoots: readonly string[];
  subscriptionErrors: Map<string, Set<Error>>;
};

const createGitResourceState = (
  options: GitResourceOptions,
): GitResourceState => ({
  allowedRoots: gitResourceOptionsSchema.parse(options).allowedRoots ?? ["/"],
  subscriptionErrors: new Map(),
});

const assertSubscriptionHealthy = (
  state: GitResourceState,
  repoRoot: string,
) => {
  const error = state.subscriptionErrors.get(repoRoot)?.values().next().value;
  if (error) {
    throw error;
  }
};

const subscribeToRepository = async (
  gitResourceState: GitResourceState,
  repoRoot: string,
  invalidate: () => void,
  context: HandlerContext,
): Promise<() => void> => {
  let failure: Error | undefined;
  const clearSubscriptionError = () => {
    if (failure) {
      const subscriptionErrors =
        gitResourceState.subscriptionErrors.get(repoRoot);
      subscriptionErrors?.delete(failure);
      if (subscriptionErrors?.size === 0) {
        gitResourceState.subscriptionErrors.delete(repoRoot);
      }
    }
  };
  const fail = (cause: unknown) => {
    if (context.signal.aborted || failure) {
      return;
    }
    // A transient authorization/startup failure must not turn into a successful
    // but permanently unwatched read. Keep it scoped to this factory's policy.
    failure = new Error("Git subscription failed; resubscribe to retry", {
      cause,
    });
    const subscriptionErrors =
      gitResourceState.subscriptionErrors.get(repoRoot) ?? new Set<Error>();
    subscriptionErrors.add(failure);
    gitResourceState.subscriptionErrors.set(repoRoot, subscriptionErrors);
    invalidate();
  };

  try {
    // Authorization and watcher startup can finish after unsubscribe. Context.signal
    // is the core-owned subscription-local signal that cancels authorization.
    const repository = await authorizeRepository({
      repoRoot,
      allowedRoots: gitResourceState.allowedRoots,
      signal: context.signal,
    });
    context.signal.throwIfAborted();
    const release = watchRepository({
      repository,
      invalidate,
      onError: fail,
      signal: context.signal,
    });
    // A synchronous startup failure can invalidate and abort reentrantly.
    // Core invokes the returned cleanup even when startup aborted the subscription.
    return () => {
      release();
      clearSubscriptionError();
    };
  } catch (cause) {
    fail(cause);
    return clearSubscriptionError;
  }
};

export const gitChangesResource = (
  options: GitResourceOptions = {},
): SubscriptionResourceDefinition<
  typeof gitChangesInputSchema,
  typeof gitChangesSchema
> => {
  const state = createGitResourceState(options);
  return {
    kind: "subscription",
    contract: { input: gitChangesInputSchema, output: gitChangesSchema },
    read: async (input, { signal }) => {
      const {
        repoRoot,
        comparisons,
        detailLevel = "summary",
        contextLines = 3,
      } = input;

      assertSubscriptionHealthy(state, repoRoot);
      const repository = await authorizeRepository({
        repoRoot,
        allowedRoots: state.allowedRoots,
        signal,
      });

      const result = await readChanges({
        repository,
        comparisons,
        detailLevel,
        contextLines,
        signal,
      });

      signal.throwIfAborted();
      assertSubscriptionHealthy(state, repoRoot);
      return result;
    },
    subscribe: (input, invalidate, context) =>
      subscribeToRepository(state, input.repoRoot, invalidate, context),
  };
};

export const gitDiffResource = (
  options: GitResourceOptions = {},
): SubscriptionResourceDefinition<
  typeof gitDiffParamsSchema,
  typeof gitDiffSchema
> => {
  const state = createGitResourceState(options);
  return {
    kind: "subscription",
    contract: { input: gitDiffParamsSchema, output: gitDiffSchema },
    read: async (input, { signal }) => {
      const { repoRoot, file, comparison, contextLines = 3 } = input;

      assertSubscriptionHealthy(state, repoRoot);
      const repository = await authorizeRepository({
        repoRoot,
        allowedRoots: state.allowedRoots,
        signal,
      });

      const result = await readDiff({
        repository,
        file,
        comparison,
        contextLines,
        signal,
      });

      signal.throwIfAborted();
      assertSubscriptionHealthy(state, repoRoot);
      return result;
    },
    subscribe: (input, invalidate, context) =>
      subscribeToRepository(state, input.repoRoot, invalidate, context),
  };
};
