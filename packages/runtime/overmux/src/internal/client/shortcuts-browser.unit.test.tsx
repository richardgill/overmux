import {
  act,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

import {
  defineCommandRegistry,
  defineOvermuxClient,
} from "./client-definition";
import {
  RuntimeContext,
  useCommand,
  useCommands,
  type RegisteredCommand,
} from "./commands";
import { ShortcutHost, useShortcutInputTarget } from "./shortcuts";

const commands = defineCommandRegistry<unknown>()({
  chord: { defaultBindings: [["F12", "D", "D"]], title: "Chord" },
  navigate: { defaultBindings: ["H"], title: "Navigate" },
  responsive: {
    defaultBindings: [{ binding: "J", when: { media: "(min-width: 800px)" } }],
    title: "Responsive",
  },
});
const definition = defineOvermuxClient({
  chordPrefixes: [{ binding: "F12", unmatched: "replay-to-focused-input" }],
  commands,
  component: () => null,
});

const RuntimeHarness = ({ children }: { children: ReactNode }) => {
  const [manifest] = useState({} as never);
  const [overmuxServerApi] = useState({} as never);
  const [registrations] = useState(new Set<RegisteredCommand>());
  const [revision, setRevision] = useState(0);
  const refreshCommands = useCallback(
    () => setRevision((current) => current + 1),
    [],
  );
  const registerCommand = useCallback(
    (registration: RegisteredCommand) => {
      registrations.add(registration);
      setRevision((current) => current + 1);
      return () => {
        registrations.delete(registration);
        setRevision((current) => current + 1);
      };
    },
    [registrations],
  );
  return (
    <RuntimeContext.Provider
      value={{
        manifest,
        overmuxServerApi,
        refreshCommands,
        registerCommand,
      }}
    >
      <ShortcutHost
        definition={definition}
        registrationRevision={revision}
        registrations={registrations}
      >
        {children}
      </ShortcutHost>
    </RuntimeContext.Provider>
  );
};

const Target = ({ active, run }: { active: boolean; run: () => void }) => {
  useCommand(commands.navigate, { enabled: active, run });
  return <input aria-label="Editor" />;
};

const ResponsiveTarget = ({ run }: { run: () => void }) => {
  useCommand(commands.responsive, { run });
  return null;
};

const ChordTarget = ({ run }: { run: () => void }) => {
  useCommand(commands.chord, { run });
  return null;
};

const PassthroughTarget = ({
  onKeyDown,
}: {
  onKeyDown: (key: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useShortcutInputTarget({ container: containerRef, input: inputRef });
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="xterm" ref={containerRef}>
      <input
        aria-label="Passthrough target"
        onKeyDown={(event) => onKeyDown(event.key)}
        ref={inputRef}
      />
    </div>
  );
};

const CommandEntries = () => (
  <output>
    {useCommands()
      .map(({ bindings, id }) => `${id}:${bindings.join("+")}`)
      .join(",")}
  </output>
);

let container: HTMLDivElement;
let root: Root;

const pressKey = (key: string) =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );

const pressH = () => pressKey("h");

type MediaQuery = {
  listeners: Set<(event: MediaQueryListEvent) => void>;
  matches: boolean;
};

const mediaQueries = new Map<string, MediaQuery>();

const setMediaMatch = (media: string, matches: boolean) => {
  const query = mediaQueries.get(media);
  if (!query) {
    throw new Error(`Unknown media query: ${media}`);
  }
  query.matches = matches;
  query.listeners.forEach((listener) =>
    listener({ matches, media } as MediaQueryListEvent),
  );
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mediaQueries.clear();
  vi.stubGlobal("matchMedia", (media: string) => {
    const query = mediaQueries.get(media) ?? {
      listeners: new Set(),
      matches: false,
    };
    mediaQueries.set(media, query);
    return {
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => query.listeners.add(listener),
      matches: query.matches,
      media,
      removeEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => query.listeners.delete(listener),
    } as unknown as MediaQueryList;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("scoped keyboard commands", () => {
  testCases("run only while an enabled target is mounted", async () => {
    const run = vi.fn();
    await act(async () =>
      root.render(
        <RuntimeHarness>
          <Target active run={run} />
        </RuntimeHarness>,
      ),
    );

    pressH();
    expect(run).toHaveBeenCalledOnce();

    await act(async () =>
      root.render(
        <RuntimeHarness>
          <Target active={false} run={run} />
        </RuntimeHarness>,
      ),
    );
    pressH();
    expect(run).toHaveBeenCalledOnce();

    await act(async () => root.render(<RuntimeHarness>{null}</RuntimeHarness>));
    pressH();
    expect(run).toHaveBeenCalledOnce();
  });

  testCases(
    "updates active shortcuts and command entries when media changes",
    async () => {
      const run = vi.fn();
      await act(async () =>
        root.render(
          <RuntimeHarness>
            <ResponsiveTarget run={run} />
            <CommandEntries />
          </RuntimeHarness>,
        ),
      );

      expect(container.querySelector("output")?.textContent).toContain(
        "responsive:",
      );
      expect(container.querySelector("output")?.textContent).not.toContain(
        "responsive:J",
      );
      pressKey("j");
      expect(run).not.toHaveBeenCalled();

      await act(async () => setMediaMatch("(min-width: 800px)", true));

      expect(container.querySelector("output")?.textContent).toContain(
        "responsive:J",
      );
      pressKey("j");
      expect(run).toHaveBeenCalledOnce();
    },
  );

  testCases(
    "replays unmatched shared chords to the focused input",
    async () => {
      const replayed = vi.fn();
      const run = vi.fn();
      await act(async () =>
        root.render(
          <RuntimeHarness>
            <ChordTarget run={run} />
            <PassthroughTarget onKeyDown={replayed} />
          </RuntimeHarness>,
        ),
      );

      pressKey("F12");
      pressKey("f");

      expect(replayed.mock.calls).toEqual([["F12"], ["f"]]);
      expect(run).not.toHaveBeenCalled();
    },
  );

  testCases("consumes complete shared chords", async () => {
    const replayed = vi.fn();
    const run = vi.fn();
    await act(async () =>
      root.render(
        <RuntimeHarness>
          <ChordTarget run={run} />
          <PassthroughTarget onKeyDown={replayed} />
        </RuntimeHarness>,
      ),
    );

    pressKey("F12");
    pressKey("d");
    pressKey("d");

    expect(run).toHaveBeenCalledOnce();
    expect(replayed).not.toHaveBeenCalled();
  });

  testCases("replays incomplete shared chords after the timeout", async () => {
    vi.useFakeTimers();
    const replayed = vi.fn();
    const run = vi.fn();
    await act(async () =>
      root.render(
        <RuntimeHarness>
          <ChordTarget run={run} />
          <PassthroughTarget onKeyDown={replayed} />
        </RuntimeHarness>,
      ),
    );

    pressKey("F12");
    pressKey("d");
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();

    expect(replayed.mock.calls).toEqual([["F12"], ["d"]]);
    expect(run).not.toHaveBeenCalled();
  });

  testCases(
    "leave unmodified text input keys available to editing",
    async () => {
      const run = vi.fn();
      await act(async () =>
        root.render(
          <RuntimeHarness>
            <Target active run={run} />
          </RuntimeHarness>,
        ),
      );
      const input = container.querySelector("input");
      await act(async () => input?.focus());

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "h",
      });
      window.dispatchEvent(event);

      expect(run).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );
});
