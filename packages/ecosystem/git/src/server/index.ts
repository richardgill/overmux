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

type Access = {
  allowedRoots: readonly string[];
  failures: Map<string, Set<Error>>;
};
const createAccess = (options: GitResourceOptions): Access => ({
  allowedRoots: gitResourceOptionsSchema.parse(options).allowedRoots ?? ["/"],
  failures: new Map(),
});
const assertSubscriptionHealthy = (access: Access, repoRoot: string) => {
  const failure = access.failures.get(repoRoot)?.values().next().value;
  if (failure) {
    throw failure;
  }
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
  const fail = (cause: unknown) => {
    if (controller.signal.aborted || failure) {
      return;
    }
    // A transient authorization/startup failure must not turn into a successful
    // but permanently unwatched read. Keep it scoped to this factory's policy.
    failure = new Error("Git subscription failed; resubscribe to retry", {
      cause,
    });
    const failures = access.failures.get(repoRoot) ?? new Set<Error>();
    failures.add(failure);
    access.failures.set(repoRoot, failures);
    invalidate();
  };
  context.signal.addEventListener("abort", dispose, { once: true });
  if (context.signal.aborted) {
    dispose();
  }
  void authorizeRepository({
    repoRoot,
    allowedRoots: access.allowedRoots,
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
  const access = createAccess(options);
  return {
    kind: "subscription",
    contract: { input: gitChangesInputSchema, output: gitChangesSchema },
    read: async (input, { signal }) => {
      const {
        repoRoot,
        comparisons,
        detail = "summary",
        contextLines = 3,
      } = gitChangesInputSchema.parse(input);
      assertSubscriptionHealthy(access, repoRoot);
      const repository = await authorizeRepository({
        repoRoot,
        allowedRoots: access.allowedRoots,
        signal,
      });
      const result = await readChanges({
        repository,
        comparisons,
        detail,
        contextLines,
        signal,
      });
      signal.throwIfAborted();
      assertSubscriptionHealthy(access, repoRoot);
      return gitChangesSchema.parse(result);
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        access,
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
  const access = createAccess(options);
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
      assertSubscriptionHealthy(access, repoRoot);
      const repository = await authorizeRepository({
        repoRoot,
        allowedRoots: access.allowedRoots,
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
      assertSubscriptionHealthy(access, repoRoot);
      return gitDiffSchema.parse(result);
    },
    subscribe: (input, invalidate, context) =>
      subscribeAuthorized(
        access,
        gitDiffParamsSchema.parse(input).repoRoot,
        invalidate,
        context,
      ),
  };
};
