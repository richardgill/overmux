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
export type { GitResourceOptions } from "../shared";

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

const subscribeAuthorized = (
  gitResourceState: GitResourceState,
  repoRoot: string,
  invalidate: () => void,
  context: HandlerContext,
): (() => void) => {
  const controller = new AbortController();
  let release: (() => void) | undefined;
  let failure: Error | undefined;
  // Authorization and watcher startup can finish after unsubscribe. A local
  // signal cancels authorization; the guard prevents attaching a late listener.
  const dispose = () => {
    controller.abort();
    context.signal.removeEventListener("abort", dispose);
    release?.();
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
    if (controller.signal.aborted || failure) {
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
  context.signal.addEventListener("abort", dispose, { once: true });
  if (context.signal.aborted) {
    dispose();
  }
  void authorizeRepository({
    repoRoot,
    allowedRoots: gitResourceState.allowedRoots,
    signal: controller.signal,
  })
    .then((repository) => {
      if (!controller.signal.aborted) {
        release = watchRepository({
          repository,
          invalidate,
          onError: fail,
          signal: controller.signal,
        });
        // A synchronous startup failure can invalidate and abort reentrantly.
        if (controller.signal.aborted) {
          release();
        }
      }
    })
    .catch(fail);
  return dispose;
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
      } = gitChangesInputSchema.parse(input);
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
      return gitChangesSchema.parse(result);
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        state,
        gitChangesInputSchema.parse(input).repoRoot,
        invalidate,
        context,
      ),
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
      const {
        repoRoot,
        file,
        comparison,
        contextLines = 3,
      } = gitDiffParamsSchema.parse(input);
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
      return gitDiffSchema.parse(result);
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        state,
        gitDiffParamsSchema.parse(input).repoRoot,
        invalidate,
        context,
      ),
  };
};
