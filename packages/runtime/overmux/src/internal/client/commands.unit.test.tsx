import { defineOperation, type ConfigDefinition } from "../../public/index";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { RuntimeOvermuxServerApi } from "./browser-api";
import {
  defineCommandRegistry,
  defineOvermuxClient,
} from "./client-definition";
import {
  createCommandEntries,
  createRegisteredCommand,
  executeCommand,
  selectCommandRegistration,
  skipToken,
  useCommand,
  type RegisteredCommand,
} from "./commands";

const closePaneOperation = defineOperation({
  handle: () => ({ closed: true }),
  input: z.object({ paneId: z.string() }),
  output: z.object({ closed: z.boolean() }),
});
const reloadOperation = defineOperation({
  handle: () => undefined,
  input: z.undefined(),
});
type ServerConfig = ConfigDefinition<
  {},
  {},
  { closePane: typeof closePaneOperation; reload: typeof reloadOperation }
>;

const commands = defineCommandRegistry<ServerConfig>()({
  closePane: {
    defaultBindings: [["§", "X"]],
    params: z.object({ paneId: z.string() }),
    run: ({ overmuxServerApi, params }) =>
      overmuxServerApi.executeOperation("closePane", {
        paneId: params.paneId,
      }),
    title: "Close pane",
  },
  copy: {
    defaultBindings: ["Control+Shift+C"],
    title: "Copy",
  },
  reload: {
    run: ({ overmuxServerApi }) => overmuxServerApi.executeOperation("reload"),
    title: "Reload",
  },
  rename: {
    params: z.object({ name: z.string() }),
    title: "Rename",
  },
  settings: { title: "Settings" },
});

const typeExamples = () => {
  const exactId: "closePane" = commands.closePane.id;
  void exactId;
  commands.closePane.run({
    overmuxServerApi: {} as never,
    params: { paneId: "%1" },
  });

  useCommand(commands.closePane, { params: { paneId: "%1" } });
  useCommand(commands.closePane, skipToken);
  useCommand(commands.closePane, {
    params: { paneId: "%1" },
    run: () => undefined,
  });
  useCommand(commands.copy, { enabled: false, run: () => undefined });
  useCommand(commands.reload, {});
  useCommand(commands.rename, {
    params: { name: "main" },
    run: () => undefined,
  });
  useCommand(commands.rename, skipToken);

  // @ts-expect-error Command IDs are inferred from object keys.
  commands.missing;
  // @ts-expect-error Commands with required params cannot register without them.
  useCommand(commands.closePane, {});
  // @ts-expect-error Commands without a default implementation require a local run.
  useCommand(commands.copy, {});
  // @ts-expect-error Parameterless commands cannot use skipToken.
  useCommand(commands.copy, skipToken);
  // @ts-expect-error Bound params are inferred from the Zod schema.
  useCommand(commands.rename, { params: { name: 1 }, run: () => undefined });
  defineCommandRegistry<ServerConfig>()({
    invalidId: {
      title: "Invalid operation",
      run: ({ overmuxServerApi }) => {
        // @ts-expect-error Default implementations use exact server operation names.
        void overmuxServerApi.executeOperation("missing");
      },
    },
    invalidInput: {
      title: "Invalid input",
      run: ({ overmuxServerApi }) => {
        // @ts-expect-error Default implementations check server operation inputs.
        void overmuxServerApi.executeOperation("closePane", { paneId: 1 });
      },
    },
  });
  void skipToken;
};

void typeExamples;

type FakeElement = HTMLElement & { parentElement: FakeElement | null };
const fakeElement = (parentElement: FakeElement | null = null): FakeElement => {
  const element = {
    parentElement,
    contains: (candidate: unknown) => {
      for (
        let current = candidate as FakeElement | null;
        current;
        current = current.parentElement
      ) {
        if (current === element) {
          return true;
        }
      }
      return false;
    },
  };
  return element as FakeElement;
};

const registration = ({
  command = commands.copy,
  element,
  enabled = true,
  run = vi.fn(),
}: {
  command?: (typeof commands)[keyof typeof commands];
  element?: FakeElement;
  enabled?: boolean;
  run?: () => void;
} = {}): RegisteredCommand => ({
  command,
  element: () => element,
  enabled: () => enabled,
  execute: async () => run(),
});

describe("command execution", () => {
  const createApi = () =>
    ({
      executeOperation: vi.fn(async () => ({ closed: true })),
    }) as unknown as RuntimeOvermuxServerApi;

  it("runs default implementations with validated params and the server API", async () => {
    const overmuxServerApi = createApi();
    const registered = createRegisteredCommand({
      command: commands.closePane,
      getRegistration: () => ({ params: { paneId: "%1" } }),
      overmuxServerApi,
    });

    await registered.execute();

    expect(overmuxServerApi.executeOperation).toHaveBeenCalledWith(
      "closePane",
      {
        paneId: "%1",
      },
    );
  });

  it("prefers local implementations and does not run skipped registrations", async () => {
    const overmuxServerApi = createApi();
    const localRun = vi.fn();
    const local = createRegisteredCommand({
      command: commands.closePane,
      getRegistration: () => ({ params: { paneId: "%1" }, run: localRun }),
      overmuxServerApi,
    });
    const skipped = createRegisteredCommand({
      command: commands.closePane,
      getRegistration: () => skipToken,
      overmuxServerApi,
    });

    await local.execute();
    await skipped.execute();

    expect(localRun).toHaveBeenCalledOnce();
    expect(skipped.enabled()).toBe(false);
    expect(overmuxServerApi.executeOperation).not.toHaveBeenCalled();
  });

  it("validates bound params before a default implementation runs", async () => {
    const registered = createRegisteredCommand({
      command: commands.closePane,
      getRegistration: () => ({ params: { paneId: 1 } }),
      overmuxServerApi: createApi(),
    });

    await expect(registered.execute()).rejects.toThrow();
  });
});

describe("command registration selection", () => {
  it("selects the deepest focused registration", () => {
    const outer = fakeElement();
    const inner = fakeElement(outer);
    const active = fakeElement(inner);
    const outerRegistration = registration({ element: outer });
    const innerRegistration = registration({ element: inner });
    const registrations = new Set([outerRegistration, innerRegistration]);

    expect(
      selectCommandRegistration(commands.copy, registrations, active),
    ).toBe(innerRegistration);
  });

  it("selects the latest registration deterministically without focus", () => {
    const first = registration();
    const second = registration({ enabled: false });
    const registrations = new Set([first, second]);

    const selected = selectCommandRegistration(
      commands.copy,
      registrations,
      null,
    );
    expect(selected).toBe(second);
    expect(selected?.enabled()).toBe(false);
  });

  it("uses the same focused registration for keyboard and listing execution", async () => {
    const outer = fakeElement();
    const inner = fakeElement(outer);
    const active = fakeElement(inner);
    const outerRun = vi.fn();
    const innerRun = vi.fn();
    const registrations = new Set([
      registration({ element: outer, run: outerRun }),
      registration({ element: inner, run: innerRun }),
    ]);
    const definition = defineOvermuxClient({
      commands,
      component: () => null,
    });
    const entries = createCommandEntries(
      definition,
      registrations,
      () => active,
    );

    await executeCommand(commands.copy, registrations, () => active);
    await entries.find(({ id }) => id === "copy")?.execute();

    expect(innerRun).toHaveBeenCalledTimes(2);
    expect(outerRun).not.toHaveBeenCalled();
  });

  it("lists disabled and shortcut-free commands without executing them", async () => {
    const disabledRun = vi.fn();
    const settingsRun = vi.fn();
    const registrations = new Set([
      registration({ enabled: false, run: disabledRun }),
      registration({ command: commands.settings, run: settingsRun }),
    ]);
    const definition = defineOvermuxClient({
      commands,
      component: () => null,
      shortcutOverrides: { copy: ["Alt+C"] },
    });
    const entries = createCommandEntries(definition, registrations, () => null);
    const copy = entries.find(({ id }) => id === "copy");
    const settings = entries.find(({ id }) => id === "settings");

    await copy?.execute();
    await settings?.execute();

    expect(copy).toMatchObject({ bindings: ["Alt+C"], enabled: false });
    expect(disabledRun).not.toHaveBeenCalled();
    expect(settings).toMatchObject({ bindings: [], enabled: true });
    expect(settingsRun).toHaveBeenCalledOnce();
  });
});
