// Public status and selected-file diff subscriptions, with independent access policies.
// Reads authorize first; subscriptions own cancellation while the registry owns shared watcher handles.
import type { HandlerContext, SubscriptionResourceDefinition } from "overmux";

import {
  gitDiffInputSchema,
  gitDiffSchema,
  gitResourceOptionsSchema,
  gitStatusInputSchema,
  gitStatusSchema,
  type GitResourceOptions,
} from "../shared";
import { buildDiff } from "./diff";
import {
  authorizeRepository,
  captureDiff,
  readStatus,
  type Repository,
} from "./repository";
import { assertRepositoryWatchHealthy, subscribeRepository } from "./watchers";

export type { GitResourceOptions } from "../shared";

type Access = GitResourceOptions & { failures: Map<string, Set<Error>> };
const createAccess = (options: GitResourceOptions): Access => ({
  ...gitResourceOptionsSchema.parse(options),
  failures: new Map(),
});
const assertSubscriptionHealthy = (
  access: Access,
  requestedRoot: string,
  repository: Repository,
) => {
  const failure = access.failures.get(requestedRoot)?.values().next().value;
  if (failure) {
    throw failure;
  }
  assertRepositoryWatchHealthy(repository);
};

const subscribeAuthorized = (
  access: Access,
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
      const failures = access.failures.get(repoRoot);
      failures?.delete(failure);
      if (failures?.size === 0) {
        access.failures.delete(repoRoot);
      }
    }
  };
  context.signal.addEventListener("abort", dispose, { once: true });
  if (context.signal.aborted) {
    dispose();
  }
  void authorizeRepository({ ...access, repoRoot, signal: controller.signal })
    .then((repository) => {
      if (!controller.signal.aborted) {
        release = subscribeRepository({ repository, invalidate });
        // A synchronous startup failure can invalidate and abort reentrantly.
        if (controller.signal.aborted) {
          release();
        }
      }
    })
    .catch((cause: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      // A transient authorization/startup failure must not turn into a successful
      // but permanently unwatched read. Keep it scoped to this factory's policy.
      failure = new Error(
        "Git subscription could not start; resubscribe to retry",
        { cause },
      );
      const failures = access.failures.get(repoRoot) ?? new Set<Error>();
      failures.add(failure);
      access.failures.set(repoRoot, failures);
      invalidate();
    });
  return dispose;
};

export const gitStatusResource = (
  options: GitResourceOptions,
): SubscriptionResourceDefinition<
  typeof gitStatusInputSchema,
  typeof gitStatusSchema
> => {
  const access = createAccess(options);
  return {
    kind: "subscription",
    contract: { input: gitStatusInputSchema, output: gitStatusSchema },
    read: async (input, { signal }) => {
      const { repoRoot } = gitStatusInputSchema.parse(input);
      const repository = await authorizeRepository({
        ...access,
        repoRoot,
        signal,
      });
      assertSubscriptionHealthy(access, repoRoot, repository);
      const status = await readStatus({ repository, signal });
      assertSubscriptionHealthy(access, repoRoot, repository);
      return status;
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        access,
        gitStatusInputSchema.parse(input).repoRoot,
        invalidate,
        context,
      ),
  };
};

export const gitDiffResource = (
  options: GitResourceOptions,
): SubscriptionResourceDefinition<
  typeof gitDiffInputSchema,
  typeof gitDiffSchema
> => {
  const access = createAccess(options);
  return {
    kind: "subscription",
    contract: { input: gitDiffInputSchema, output: gitDiffSchema },
    read: async (input, { signal }) => {
      const { repoRoot, file, comparison } = gitDiffInputSchema.parse(input);
      const repository = await authorizeRepository({
        ...access,
        repoRoot,
        signal,
      });
      assertSubscriptionHealthy(access, repoRoot, repository);
      const sides = await captureDiff({ repository, file, comparison, signal });
      signal.throwIfAborted();
      const diff = buildDiff(sides);
      assertSubscriptionHealthy(access, repoRoot, repository);
      return diff;
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        access,
        gitDiffInputSchema.parse(input).repoRoot,
        invalidate,
        context,
      ),
  };
};
