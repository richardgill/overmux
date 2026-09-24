// Defines reusable tmux mutations as validated Overmux operations.
// Backend access stays behind this boundary so callers share cancellation behavior.
import { defineOperation, type OperationDefinition } from "overmux";
import { noInputSchema } from "overmux";
import { z } from "zod";

import {
  tmuxOperationResultSchema,
  type TmuxOperationResult,
} from "../shared/operation-contracts";
import type { TmuxState } from "../shared/state-contract";
import {
  tmuxFormats,
  tmuxPaneIdSchema,
  tmuxSessionIdSchema,
  tmuxWindowIdSchema,
} from "../shared/tmux-values";
import type { TmuxBackend } from "./backend";
const paneTargetSchema = z.object({ paneId: tmuxPaneIdSchema }).strict();
const sessionTargetSchema = z
  .object({ sessionId: tmuxSessionIdSchema })
  .strict();

export { tmuxOperationResultSchema, type TmuxOperationResult };
type Operation<TInput extends z.ZodType> = OperationDefinition<
  TInput,
  typeof tmuxOperationResultSchema
>;
const hasPane = (state: TmuxState, paneId: string) =>
  state.hierarchy.sessions.some((session) =>
    session.windows.some((window) =>
      window.panes.some((pane) => pane.id === paneId),
    ),
  );
const hasSession = (state: TmuxState, sessionId: string) =>
  state.hierarchy.sessions.some((session) => session.id === sessionId);
const hasWindow = (state: TmuxState, sessionId: string, windowId: string) =>
  state.hierarchy.sessions.some(
    (session) =>
      session.id === sessionId &&
      session.windows.some((window) => window.id === windowId),
  );
const hasWindowPane = (state: TmuxState, windowId: string, paneId: string) =>
  state.hierarchy.sessions.some((session) =>
    session.windows.some(
      (window) =>
        window.id === windowId &&
        window.panes.some((pane) => pane.id === paneId),
    ),
  );
const findSessionContainingWindow = (state: TmuxState, windowId: string) =>
  state.hierarchy.sessions.find((session) =>
    session.windows.some((window) => window.id === windowId),
  );

const defineTmuxOperation = <TInput extends z.ZodType>(
  input: TInput,
  handle: Operation<TInput>["handle"],
): Operation<TInput> =>
  defineOperation({ handle, input, output: tmuxOperationResultSchema });

const runSafely = async (
  run: () => Promise<TmuxOperationResult>,
): Promise<TmuxOperationResult> => {
  try {
    return await run();
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      outcome: "error",
    };
  }
};

const runIfTargetExists = ({
  backend,
  targetExists,
  run,
  signal,
}: {
  backend: TmuxBackend;
  targetExists: (state: TmuxState) => boolean;
  run: (signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
}): Promise<TmuxOperationResult> =>
  runSafely(async () => {
    const state = await backend.refresh(signal);
    if (!targetExists(state)) {
      return { outcome: "not-found" };
    }
    await run(signal);
    return { outcome: "success" };
  });

const reloadConfig = async ({
  backend,
  signal,
}: {
  backend: TmuxBackend;
  signal: AbortSignal;
}) => {
  if (backend.configPath) {
    await backend.run(["source-file", backend.configPath], signal);
    return;
  }
  const reported = await backend.run(
    ["display-message", "-p", tmuxFormats.configFiles],
    signal,
  );
  const configPaths = reported.trim().split(",").filter(Boolean);
  if (!configPaths.length) {
    throw new Error("Tmux server did not report any configuration files");
  }
  await backend.run(["source-file", "-q", ...configPaths], signal);
};

const createWindowFromPane = async ({
  backend,
  paneId,
  signal,
}: {
  backend: TmuxBackend;
  paneId: string;
  signal: AbortSignal;
}) => {
  const path = (
    await backend.run(
      ["display-message", "-p", "-t", paneId, tmuxFormats.paneCurrentPath],
      signal,
    )
  ).trim();
  if (!path) {
    throw new Error(`Pane is no longer available: ${paneId}`);
  }
  await backend.run(["new-window", "-d", "-c", path, "-t", paneId], signal);
};

const moveWindow = async ({
  backend,
  direction,
  signal,
  windowId,
}: {
  backend: TmuxBackend;
  direction: "left" | "right";
  signal: AbortSignal;
  windowId: string;
}): Promise<TmuxOperationResult> => {
  const state = await backend.refresh(signal);
  const session = findSessionContainingWindow(state, windowId);
  if (!session) {
    return { outcome: "not-found" };
  }
  if (session.windows.length < 2) {
    return { outcome: "success" };
  }

  const source = session.windows.findIndex((window) => window.id === windowId);
  const offset = direction === "left" ? -1 : 1;
  const destination =
    session.windows[
      (source + offset + session.windows.length) % session.windows.length
    ]!;
  await backend.run(
    ["swap-window", "-d", "-s", windowId, "-t", destination.id],
    signal,
  );
  return { outcome: "success" };
};

export const tmuxOperations = ({ backend }: { backend: TmuxBackend }) => ({
  createTmuxWindow: defineTmuxOperation(
    paneTargetSchema,
    ({ paneId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasPane(state, paneId),
        run: (signal) => createWindowFromPane({ backend, paneId, signal }),
        signal: context.signal,
      }),
  ),
  detachTmuxSession: defineTmuxOperation(
    sessionTargetSchema,
    ({ sessionId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasSession(state, sessionId),
        run: (signal) =>
          backend.run(["detach-client", "-s", sessionId], signal),
        signal: context.signal,
      }),
  ),
  killTmuxPane: defineTmuxOperation(paneTargetSchema, ({ paneId }, context) =>
    runIfTargetExists({
      backend,
      targetExists: (state) => hasPane(state, paneId),
      run: (signal) => backend.run(["kill-pane", "-t", paneId], signal),
      signal: context.signal,
    }),
  ),
  killTmuxSession: defineTmuxOperation(
    sessionTargetSchema,
    ({ sessionId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasSession(state, sessionId),
        run: (signal) => backend.run(["kill-session", "-t", sessionId], signal),
        signal: context.signal,
      }),
  ),
  moveTmuxWindow: defineTmuxOperation(
    z
      .object({
        direction: z.enum(["left", "right"]),
        windowId: tmuxWindowIdSchema,
      })
      .strict(),
    ({ direction, windowId }, context) =>
      runSafely(() =>
        moveWindow({ backend, direction, signal: context.signal, windowId }),
      ),
  ),
  reloadTmuxConfig: defineTmuxOperation(noInputSchema, (_input, context) =>
    runSafely(async () => {
      await reloadConfig({ backend, signal: context.signal });
      return { outcome: "success" };
    }),
  ),
  selectTmuxPane: defineTmuxOperation(
    z
      .object({ paneId: tmuxPaneIdSchema, windowId: tmuxWindowIdSchema })
      .strict(),
    ({ paneId, windowId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasWindowPane(state, windowId, paneId),
        run: (signal) => backend.run(["select-pane", "-t", paneId], signal),
        signal: context.signal,
      }),
  ),
  selectTmuxWindow: defineTmuxOperation(
    z
      .object({
        sessionId: tmuxSessionIdSchema,
        windowId: tmuxWindowIdSchema,
      })
      .strict(),
    ({ sessionId, windowId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasWindow(state, sessionId, windowId),
        run: (signal) =>
          backend.run(
            ["select-window", "-t", `${sessionId}:${windowId}`],
            signal,
          ),
        signal: context.signal,
      }),
  ),
  splitTmuxPane: defineTmuxOperation(
    z
      .object({
        direction: z.enum(["horizontal", "vertical"]),
        paneId: tmuxPaneIdSchema,
      })
      .strict(),
    ({ direction, paneId }, context) =>
      runIfTargetExists({
        backend,
        targetExists: (state) => hasPane(state, paneId),
        run: (signal) =>
          backend.run(
            [
              "split-window",
              direction === "horizontal" ? "-h" : "-v",
              "-c",
              tmuxFormats.paneCurrentPath,
              "-t",
              paneId,
            ],
            signal,
          ),
        signal: context.signal,
      }),
  ),
});
