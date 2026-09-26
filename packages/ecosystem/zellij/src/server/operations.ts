// Exposes only Zellij 0.45.1 actions with stable session, tab, or pane targets.
// State checks and successful mutations reconcile against authoritative newer plugin snapshots.
// Client-relative actions remain absent because transient CLI clients cannot target a user's view.

import { defineOperation, type OperationDefinition } from "overmux";
import { z } from "zod";

import {
  zellijOperationResultSchema,
  type ZellijOperationResult,
  type ZellijPaneIdentity,
} from "../shared/operation-contracts";
import type { ZellijSession, ZellijState } from "../shared/state-contract";
import type { ZellijBackend } from "./backend";
import { runZellijCommand } from "./zellij-process";

const commandSchema = z.tuple([z.string().min(1)], z.string());
const sessionNameSchema = z.string().min(1);
const tabIdSchema = z.number().int().nonnegative();
const paneIdentitySchema = z
  .object({ id: z.number().int().nonnegative(), isPlugin: z.boolean() })
  .strict();
const sessionTargetSchema = z
  .object({ sessionName: sessionNameSchema })
  .strict();
type Operation<TInput extends z.ZodType> = OperationDefinition<
  TInput,
  typeof zellijOperationResultSchema
>;

const defineZellijOperation = <TInput extends z.ZodType>(
  input: TInput,
  handle: Operation<TInput>["handle"],
): Operation<TInput> =>
  defineOperation({ handle, input, output: zellijOperationResultSchema });
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const runSafely = async (
  run: () => Promise<ZellijOperationResult>,
): Promise<ZellijOperationResult> => {
  try {
    return await run();
  } catch (error) {
    return { message: errorMessage(error), outcome: "error" };
  }
};
const sessionArguments = (sessionName: string, action: readonly string[]) => [
  "--session",
  sessionName,
  "action",
  ...action,
];
const paneDirectorySchema = z.object({
  id: tabIdSchema,
  is_plugin: z.boolean(),
  pane_cwd: z.string().optional(),
});
const readTerminalPaneDirectory = async (
  sessionName: string,
  id: number,
  signal: AbortSignal,
) => {
  // SessionUpdate omits cwd. Query CLI metadata once for this operation, never to publish topology.
  const output = await runZellijCommand(
    sessionArguments(sessionName, ["list-panes", "--all", "--json"]),
    signal,
  );
  return z
    .array(paneDirectorySchema)
    .parse(JSON.parse(output))
    .find((pane) => pane.id === id && !pane.is_plugin);
};
const findSession = (state: ZellijState, sessionName: string) =>
  state.sessions.find((session) => session.name === sessionName);
const hasTab = (state: ZellijState, sessionName: string, tabId: number) =>
  Boolean(
    findSession(state, sessionName)?.tabs.some(
      (tab) => tab.info.tab_id === tabId,
    ),
  );
const hasPane = (
  state: ZellijState,
  sessionName: string,
  target: ZellijPaneIdentity,
) =>
  Boolean(
    findSession(state, sessionName)?.tabs.some((tab) =>
      tab.panes.some(
        (pane) => pane.id === target.id && pane.is_plugin === target.isPlugin,
      ),
    ),
  );
const orderedTabIds = (session: ZellijSession) =>
  [...session.tabs]
    .sort((left, right) => left.info.position - right.info.position)
    .map((tab) => tab.info.tab_id);
const hasTabOrder = (
  state: ZellijState,
  sessionName: string,
  expected: number[],
) => {
  const session = findSession(state, sessionName);
  const actual = session ? orderedTabIds(session) : [];
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
};
const movedTabOrder = (
  ids: number[],
  tabId: number,
  direction: "left" | "right",
) => {
  const index = ids.indexOf(tabId);
  const adjacent = index + (direction === "left" ? -1 : 1);
  // Zellij rotates all positions at an edge, rather than swapping the first and last tabs.
  // https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/screen.rs#L5959-L5987
  if (adjacent < 0) {
    return [...ids.slice(1), tabId];
  }
  if (adjacent === ids.length) {
    return [tabId, ...ids.slice(0, -1)];
  }
  return ids.map((id, position) =>
    position === index ? ids[adjacent]! : position === adjacent ? tabId : id,
  );
};
const paneId = ({ id, isPlugin }: ZellijPaneIdentity) =>
  `${isPlugin ? "plugin" : "terminal"}_${id}`;
const readConnectedState = async (
  backend: ZellijBackend,
  signal: AbortSignal,
) => {
  const state = await backend.read(signal);
  if (!state.connected) {
    throw new Error("Zellij state is unavailable");
  }
  return state;
};
const mutateIf = ({
  args,
  backend,
  exists,
  reconciled,
  signal,
}: {
  args: readonly string[];
  backend: ZellijBackend;
  exists: (state: ZellijState) => boolean;
  reconciled?: (state: ZellijState) => boolean;
  signal: AbortSignal;
}) =>
  runSafely(async () => {
    if (!exists(await readConnectedState(backend, signal))) {
      return { outcome: "not-found" };
    }
    await backend.mutate(args, () => reconciled, signal);
    return { outcome: "success" };
  });

const parseTabId = (output: string) => {
  const id = Number(output.trim());
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error(
      `Zellij returned an invalid tab ID: ${JSON.stringify(output.trim())}`,
    );
  }
  return id;
};
const parsePaneIdentity = (output: string): ZellijPaneIdentity => {
  const match = /^(terminal|plugin)_(\d+)$/.exec(output.trim());
  if (!match) {
    throw new Error(
      `Zellij returned an invalid pane ID: ${JSON.stringify(output.trim())}`,
    );
  }
  return { id: Number(match[2]), isPlugin: match[1] === "plugin" };
};

export const zellijOperationHandlers = ({
  backend,
}: {
  backend: ZellijBackend;
}) => ({
  closePane: defineZellijOperation(
    z
      .object({ pane: paneIdentitySchema, sessionName: sessionNameSchema })
      .strict(),
    ({ pane, sessionName }, context) =>
      mutateIf({
        args: sessionArguments(sessionName, [
          "close-pane",
          "--pane-id",
          paneId(pane),
        ]),
        backend,
        exists: (state) => hasPane(state, sessionName, pane),
        reconciled: (state) => !hasPane(state, sessionName, pane),
        signal: context.signal,
      }),
  ),
  closeTab: defineZellijOperation(
    z.object({ sessionName: sessionNameSchema, tabId: tabIdSchema }).strict(),
    ({ sessionName, tabId }, context) =>
      mutateIf({
        args: sessionArguments(sessionName, ["close-tab-by-id", String(tabId)]),
        backend,
        exists: (state) => hasTab(state, sessionName, tabId),
        reconciled: (state) => !hasTab(state, sessionName, tabId),
        signal: context.signal,
      }),
  ),
  createPane: defineZellijOperation(
    z
      .object({
        command: commandSchema.optional(),
        cwd: z.string().min(1).optional(),
        floating: z.boolean().optional(),
        name: z.string().min(1).optional(),
        sessionName: sessionNameSchema,
        tabId: tabIdSchema,
      })
      .strict(),
    ({ command, cwd, floating, name, sessionName, tabId }, context) =>
      runSafely(async () => {
        const state = await readConnectedState(backend, context.signal);
        if (!hasTab(state, sessionName, tabId)) {
          return { outcome: "not-found" };
        }
        const args = ["new-pane", "--tab-id", String(tabId), "--no-focus"];
        if (cwd) {
          args.push("--cwd", cwd);
        }
        if (name) {
          args.push("--name", name);
        }
        if (floating) {
          args.push("--floating");
        }
        if (command) {
          args.push("--", ...command);
        }
        const output = await backend.mutate(
          sessionArguments(sessionName, args),
          (createdOutput) => {
            const createdPane = parsePaneIdentity(createdOutput);
            return (nextState) => hasPane(nextState, sessionName, createdPane);
          },
          context.signal,
        );
        return {
          created: { kind: "pane", pane: parsePaneIdentity(output) },
          outcome: "success",
        };
      }),
  ),
  createTab: defineZellijOperation(
    z
      .object({
        command: commandSchema.optional(),
        cwd: z.string().min(1).optional(),
        fromPane: paneIdentitySchema
          .extend({ isPlugin: z.literal(false) })
          .optional(),
        name: z.string().min(1).optional(),
        sessionName: sessionNameSchema,
      })
      .strict()
      .refine(
        (input) => input.cwd === undefined || input.fromPane === undefined,
        {
          message: "cwd and fromPane are mutually exclusive",
          path: ["fromPane"],
        },
      ),
    ({ command, cwd, fromPane, name, sessionName }, context) =>
      runSafely(async () => {
        const state = await readConnectedState(backend, context.signal);
        if (!findSession(state, sessionName)) {
          return { outcome: "not-found" };
        }
        let workingDirectory = cwd;
        if (fromPane) {
          const source = await readTerminalPaneDirectory(
            sessionName,
            fromPane.id,
            context.signal,
          );
          if (!source) {
            return { outcome: "not-found" };
          }
          if (!source.pane_cwd) {
            throw new Error(
              `Working directory unavailable for terminal pane ${fromPane.id} in session ${sessionName}`,
            );
          }
          workingDirectory = source.pane_cwd;
        }
        const args = ["new-tab", "--no-focus"];
        if (name) {
          args.push("--name", name);
        }
        if (workingDirectory) {
          args.push("--cwd", workingDirectory);
        }
        if (command) {
          args.push("--", ...command);
        }
        const output = await backend.mutate(
          sessionArguments(sessionName, args),
          (createdOutput) => {
            const createdTabId = parseTabId(createdOutput);
            return (nextState) => hasTab(nextState, sessionName, createdTabId);
          },
          context.signal,
        );
        return {
          created: { kind: "tab", tabId: parseTabId(output) },
          outcome: "success",
        };
      }),
  ),
  killSession: defineZellijOperation(
    sessionTargetSchema,
    ({ sessionName }, context) =>
      mutateIf({
        args: ["kill-session", sessionName],
        backend,
        exists: (state) => Boolean(findSession(state, sessionName)),
        signal: context.signal,
      }),
  ),
  moveTab: defineZellijOperation(
    z
      .object({
        direction: z.enum(["left", "right"]),
        sessionName: sessionNameSchema,
        tabId: tabIdSchema,
      })
      .strict(),
    ({ direction, sessionName, tabId }, context) =>
      runSafely(async () => {
        const state = await readConnectedState(backend, context.signal);
        const session = findSession(state, sessionName);
        if (!session || !hasTab(state, sessionName, tabId)) {
          return { outcome: "not-found" };
        }
        const expected = movedTabOrder(
          orderedTabIds(session),
          tabId,
          direction,
        );
        await backend.mutate(
          sessionArguments(sessionName, [
            "move-tab",
            direction,
            "--tab-id",
            String(tabId),
          ]),
          // A single-tab move emits no topology update; only await the CLI's completion in that case.
          () =>
            session.tabs.length < 2
              ? undefined
              : (nextState) => hasTabOrder(nextState, sessionName, expected),
          context.signal,
        );
        return { outcome: "success" };
      }),
  ),
  renameSession: defineZellijOperation(
    z
      .object({ name: sessionNameSchema, sessionName: sessionNameSchema })
      .strict(),
    ({ name, sessionName }, context) =>
      mutateIf({
        args: sessionArguments(sessionName, ["rename-session", name]),
        backend,
        exists: (state) => Boolean(findSession(state, sessionName)),
        reconciled: (state) =>
          !findSession(state, sessionName) && Boolean(findSession(state, name)),
        signal: context.signal,
      }),
  ),
  renameTab: defineZellijOperation(
    z
      .object({
        name: z.string().min(1),
        sessionName: sessionNameSchema,
        tabId: tabIdSchema,
      })
      .strict(),
    ({ name, sessionName, tabId }, context) =>
      mutateIf({
        args: sessionArguments(sessionName, [
          "rename-tab-by-id",
          String(tabId),
          name,
        ]),
        backend,
        exists: (state) => hasTab(state, sessionName, tabId),
        reconciled: (state) =>
          findSession(state, sessionName)?.tabs.find(
            (tab) => tab.info.tab_id === tabId,
          )?.info.name === name,
        signal: context.signal,
      }),
  ),
});

export { zellijOperationResultSchema, type ZellijOperationResult };
