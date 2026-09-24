// Exercises both installed xterm distributions through browser events and the public API.
// Synthetic IME events verify xterm's deferred paths, not real-phone keyboard behavior.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  chromium,
  expect,
  test as testCases,
  type Browser,
  type Page,
} from "@playwright/test";
import type { IInputTransformEvent, Terminal } from "@overmux/xterm-fork";

type TerminalConstructor = typeof import("@overmux/xterm-fork").Terminal;
declare global {
  interface Window {
    Terminal: TerminalConstructor;
    terminal: Terminal;
    received: string[];
    intents: { kind: string; data: string }[];
    pending: "ctrl" | "alt" | "both" | undefined;
    FitAddon: typeof import("@xterm/addon-fit");
    Unicode11Addon: typeof import("@xterm/addon-unicode11");
    WebglAddon: typeof import("@xterm/addon-webgl");
    ClipboardAddon: typeof import("@xterm/addon-clipboard");
    WebLinksAddon: typeof import("@xterm/addon-web-links");
  }
}

let browser: Browser;
let page: Page;
const consumerRoot =
  process.env.FORK_CONSUMER_ROOT ??
  resolve(homedir(), "code/noisy-files/xterm-fork-consumer");
const packageRoot = resolve(consumerRoot, "node_modules/@overmux/xterm-fork");
testCases.beforeAll(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
});
testCases.afterAll(async () => browser?.close());
testCases.afterEach(async () => page?.close());

const openTerminal = async (format: "js" | "mjs", android = false) => {
  page = await browser.newPage(
    android
      ? {
          userAgent:
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
        }
      : {},
  );
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.setContent(
    '<div id="terminal" style="width:800px;height:400px"></div>',
  );
  await page.addStyleTag({
    content: await readFile(resolve(packageRoot, "css/xterm.css"), "utf8"),
  });
  const code = await readFile(
    resolve(packageRoot, `lib/xterm.${format}`),
    "utf8",
  );
  if (format === "js") {
    await page.addScriptTag({ content: code });
  } else {
    const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    await page.addScriptTag({
      type: "module",
      content: `import { Terminal } from ${JSON.stringify(url)}; window.Terminal = Terminal;`,
    });
    await page.waitForFunction(() => typeof window.Terminal === "function");
  }
};

const prepareTerminal = async () =>
  page.evaluate(() => {
    window.terminal = new window.Terminal({ cols: 80, rows: 24 });
    window.received = [];
    window.intents = [];
    window.pending = "ctrl";
    window.terminal.open(document.getElementById("terminal")!);
    window.terminal.onData((data) => window.received.push(data));
    window.terminal.attachInputTransform((event: IInputTransformEvent) => {
      window.intents.push({ kind: event.kind, data: event.data });
      const pending = window.pending;
      window.pending = undefined;
      // Native modifier encoding wins. Applications can consume pending state without re-encoding.
      if (
        event.kind === "paste" ||
        event.data.length !== 1 ||
        (event.kind === "key" &&
          (event.domEvent.ctrlKey ||
            event.domEvent.altKey ||
            event.domEvent.metaKey))
      ) {
        return event.data;
      }
      const data =
        (pending === "ctrl" || pending === "both") &&
        /^[a-z]$/i.test(event.data)
          ? String.fromCharCode(event.data.toUpperCase().charCodeAt(0) - 64)
          : event.data;
      return pending === "alt" || pending === "both" ? `\x1b${data}` : data;
    });
    window.terminal.focus();
  });
const snapshot = () =>
  page.evaluate(() => ({
    data: window.received,
    intents: window.intents,
    pending: window.pending,
  }));
const write = (data: string) =>
  page.evaluate(
    (value) => new Promise<void>((done) => window.terminal.write(value, done)),
    data,
  );
const commit = (data: string) =>
  page.evaluate((value) => {
    window.terminal.textarea!.dispatchEvent(
      new InputEvent("input", {
        data: value,
        inputType: "insertText",
        bubbles: true,
      }),
    );
  }, data);

const scenarios = [
  {
    name: "official addons load into the fork without importing another engine",
    run: async () => {
      for (const name of [
        "fit",
        "unicode11",
        "webgl",
        "clipboard",
        "web-links",
      ]) {
        const code = await readFile(
          resolve(
            consumerRoot,
            `node_modules/@xterm/addon-${name}/lib/addon-${name}.js`,
          ),
          "utf8",
        );
        expect(code).not.toContain('require("@xterm/xterm")');
        await page.addScriptTag({ content: code });
      }
      const result = await page.evaluate(() => {
        const terminal = window.terminal;
        terminal.options.allowProposedApi = true;
        const fit = new window.FitAddon.FitAddon();
        const addons = [
          fit,
          new window.Unicode11Addon.Unicode11Addon(),
          new window.WebglAddon.WebglAddon(),
          new window.ClipboardAddon.ClipboardAddon(),
          new window.WebLinksAddon.WebLinksAddon(),
        ];
        for (const addon of addons) {
          terminal.loadAddon(addon);
        }
        fit.fit();
        terminal.unicode.activeVersion = "11";
        const result = {
          cols: terminal.cols,
          unicode: terminal.unicode.activeVersion,
        };
        for (const addon of addons) {
          addon.dispose();
        }
        return result;
      });
      expect(result.cols).toBeGreaterThan(0);
      expect(result.unicode).toBe("11");
    },
  },
  {
    name: "cancellation and reset discard stale deferred input without losing focus or fresh composition",
    run: async () => {
      for (const method of ["cancelPendingInput", "reset"] as const) {
        const retained = await page.evaluate(async (method) => {
          const terminal = window.terminal;
          const input = terminal.textarea!;
          input.value = "before";
          input.dispatchEvent(
            new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }),
          );
          input.dispatchEvent(new CompositionEvent("compositionstart"));
          input.value = "old text";
          input.dispatchEvent(
            new CompositionEvent("compositionupdate", { data: "old text" }),
          );
          input.dispatchEvent(new CompositionEvent("compositionend"));
          terminal[method]();
          // A late end from the cancelled composition must not revive its commit.
          input.dispatchEvent(new CompositionEvent("compositionend"));
          window.pending = "ctrl";
          input.dispatchEvent(new CompositionEvent("compositionstart"));
          input.value = "c";
          input.dispatchEvent(new CompositionEvent("compositionend"));
          await new Promise((done) => setTimeout(done, 10));
          return (
            terminal.textarea === input && document.activeElement === input
          );
        }, method);
        expect(retained).toBe(true);
      }
      expect(await snapshot()).toEqual({
        data: ["\x03", "\x03"],
        intents: [
          { kind: "text", data: "c" },
          { kind: "text", data: "c" },
        ],
        pending: undefined,
      });
    },
  },
  {
    name: "phone commits apply Ctrl, Alt and Ctrl+Alt exactly once; long commits pass through",
    run: async () => {
      await commit("c");
      await page.evaluate(() => {
        window.pending = "alt";
      });
      await commit("x");
      await page.evaluate(() => {
        window.pending = "both";
      });
      await commit("c");
      await page.evaluate(() => {
        window.pending = "ctrl";
      });
      await commit("hello");
      expect(await snapshot()).toEqual({
        data: ["\x03", "\x1bx", "\x1b\x03", "hello"],
        intents: ["c", "x", "c", "hello"].map((data) => ({
          kind: "text",
          data,
        })),
        pending: undefined,
      });
    },
  },
  {
    name: "keydown and keypress transform once; native Ctrl/Alt remain encoded",
    run: async () => {
      await page.keyboard.press("c");
      await page.evaluate(() => {
        window.pending = "ctrl";
      });
      await page.keyboard.press("Control+c");
      await page.evaluate(() => {
        window.pending = "alt";
      });
      await page.keyboard.press("Alt+x");
      await page.evaluate(() => {
        window.pending = "ctrl";
      });
      await page.keyboard.press("Shift+C");
      expect(await snapshot()).toEqual({
        data: ["\x03", "\x03", "\x1bx", "\x03"],
        intents: ["c", "\x03", "\x1bx", "C"].map((data) => ({
          kind: "key",
          data,
        })),
        pending: undefined,
      });
    },
  },
  {
    name: "DOM and public paste keep their origin, normalization and bracketing",
    run: async () => {
      await page.evaluate(() => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "c");
        window.terminal.textarea!.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData, bubbles: true }),
        );
      });
      await write("\x1b[?2004h");
      await page.evaluate(() => {
        window.pending = "ctrl";
        window.terminal.paste("hello\r\nworld\n");
      });
      expect(await snapshot()).toEqual({
        data: ["c", "\x1b[200~hello\rworld\r\x1b[201~"],
        intents: [
          { kind: "paste", data: "c" },
          { kind: "paste", data: "hello\rworld\r" },
        ],
        pending: undefined,
      });
    },
  },
  {
    name: "deferred composition and keyCode 229 retain text origin",
    run: async () => {
      await page.evaluate(async () => {
        const input = window.terminal.textarea!;
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "c";
        input.dispatchEvent(
          new CompositionEvent("compositionupdate", { data: "c" }),
        );
        await new Promise((done) => setTimeout(done, 10));
        input.dispatchEvent(
          new CompositionEvent("compositionend", { data: "c" }),
        );
        await new Promise((done) => setTimeout(done, 10));
        window.pending = "alt";
        input.dispatchEvent(
          new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }),
        );
        input.value += "x";
        await new Promise((done) => setTimeout(done, 10));
      });
      expect(await snapshot()).toEqual({
        data: ["\x03", "\x1bx"],
        intents: [
          { kind: "text", data: "c" },
          { kind: "text", data: "x" },
        ],
        pending: undefined,
      });
    },
  },
  {
    name: "textarea fallback replacements, deletions and multi-character commits remain text",
    run: async () => {
      await page.evaluate(async () => {
        const input = window.terminal.textarea!;
        for (const [oldValue, nextValue] of [
          ["old", "new"],
          ["ab", "a"],
          ["", "hello"],
        ]) {
          input.value = oldValue;
          input.dispatchEvent(
            new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }),
          );
          input.value = nextValue;
          await new Promise((done) => setTimeout(done, 10));
        }
      });
      expect(await snapshot()).toEqual({
        data: ["new", "\x7f", "hello"],
        intents: ["new", "\x7f", "hello"].map((data) => ({
          kind: "text",
          data,
        })),
        pending: undefined,
      });
    },
  },
  {
    name: "custom key handlers can emit mapped input without a second transformation",
    run: async () => {
      await page.evaluate(() =>
        window.terminal.attachCustomKeyEventHandler((event) => {
          if (event.type === "keydown") {
            window.terminal.input("\x03");
          }
          return false;
        }),
      );
      await page.keyboard.press("c");
      expect(await snapshot()).toEqual({
        data: ["\x03"],
        intents: [],
        pending: "ctrl",
      });
    },
  },
  {
    name: "immediate composition flush precedes Enter without a duplicate deferred send",
    run: async () => {
      await page.evaluate(async () => {
        const input = window.terminal.textarea!;
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "c";
        input.dispatchEvent(
          new CompositionEvent("compositionupdate", { data: "c" }),
        );
        await new Promise((done) => setTimeout(done, 10));
        input.dispatchEvent(new CompositionEvent("compositionend"));
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            keyCode: 13,
            bubbles: true,
          }),
        );
        await new Promise((done) => setTimeout(done, 10));
      });
      expect(await snapshot()).toEqual({
        data: ["\x03", "\r"],
        intents: [
          { kind: "text", data: "c" },
          { kind: "key", data: "\r" },
        ],
        pending: undefined,
      });
    },
  },
  {
    name: "protocol replies, focus, alternate wheel, mouse reports and toolbar input bypass the hook",
    run: async () => {
      await write("\x1b[6n\x1b[?1049h\x1b[?1004h");
      await page.evaluate(() => {
        window.terminal.blur();
        window.terminal.focus();
      });
      await page
        .locator(".xterm-screen")
        .dispatchEvent("wheel", { deltaY: 3, deltaMode: 1 });
      await write("\x1b[?1000h\x1b[?1006h");
      await page.locator(".xterm-screen").dispatchEvent("wheel", {
        deltaY: 3,
        deltaMode: 1,
        clientX: 20,
        clientY: 20,
      });
      await page.evaluate(() => window.terminal.input("\x03"));
      const result = await snapshot();
      expect(result.intents).toEqual([]);
      expect(result.pending).toBe("ctrl");
      expect(result.data[0]).toBe("\x1b[1;1R");
      expect(result.data).toEqual(expect.arrayContaining(["\x1b[O", "\x1b[I"]));
      expect(result.data.filter((data) => data === "\x1b[B")).toHaveLength(3);
      expect(
        result.data.filter((data) => data.startsWith("\x1b[<65;")),
      ).toHaveLength(3);
      expect(result.data.at(-1)).toBe("\x03");
    },
  },
  {
    name: "disabled stdin and disposal do not consume pending state; stale disposers don't remove newer hooks",
    run: async () => {
      await page.evaluate(async () => {
        window.terminal.options.disableStdin = true;
        window.terminal.paste("c");
        window.terminal.textarea!.dispatchEvent(
          new InputEvent("input", { data: "c", inputType: "insertText" }),
        );
        window.terminal.options.disableStdin = false;
        const callback = (event: IInputTransformEvent) => {
          window.intents.push(event);
          return "";
        };
        const old = window.terminal.attachInputTransform(callback);
        const current = window.terminal.attachInputTransform(callback);
        old.dispose();
        window.terminal.paste("suppressed");
        current.dispose();
        window.terminal.paste("untransformed");
        window.terminal.attachInputTransform(callback);
        const input = window.terminal.textarea!;
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "c";
        input.dispatchEvent(new CompositionEvent("compositionend"));
        window.terminal.dispose();
        await new Promise((done) => setTimeout(done, 10));
      });
      expect(await snapshot()).toEqual({
        data: ["untransformed"],
        intents: [{ kind: "paste", data: "suppressed" }],
        pending: "ctrl",
      });
    },
  },
];

// Replay the phone trace using real DOM handlers. Each correction's deletion and insertion
// happen in one task, so neither keyCode 229 timeout can run between them.
const replayAndroidCorrection = async (stalePrefix: boolean) =>
  page.evaluate(async (stalePrefix) => {
    window.pending = undefined;
    const input = window.terminal.textarea!;
    const key = (type: string, keyCode = 229) =>
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: keyCode === 8 ? "Backspace" : "Unidentified",
          keyCode,
          bubbles: true,
          cancelable: true,
        }),
      );
    const edit = (inputType: string, value: string, data: string | null) => {
      const event = { inputType, data, bubbles: true, composed: true };
      input.dispatchEvent(new InputEvent("beforeinput", event));
      input.value = value;
      input.dispatchEvent(new InputEvent("input", event));
    };
    if (stalePrefix) {
      for (const char of "hello") {
        key("keydown");
        edit("insertText", input.value + char, char);
        key("keyup");
        await new Promise((done) => setTimeout(done, 10));
      }
      for (let index = 0; index < 5; index++) {
        key("keydown", 8);
        key("keyup", 8);
      }
      // Terminal-handled Backspace leaves the keyboard's hidden textarea unchanged.
      if (input.value !== "hello") {
        throw new Error("Unexpected backspace context");
      }
    }
    for (const char of "hello thre") {
      key("keydown");
      edit("insertText", input.value + char, char);
      key("keyup");
      await new Promise((done) => setTimeout(done, 10));
    }
    const before = window.received.slice();
    key("keydown");
    input.setSelectionRange(input.value.length - 2, input.value.length);
    edit("deleteContentBackward", input.value.slice(0, -2), null);
    key("keyup");
    key("keydown");
    edit("insertText", input.value + "ere ", "ere ");
    key("keyup");
    await new Promise((done) => setTimeout(done, 50));
    return {
      before,
      correction: window.received.slice(before.length),
      value: input.value,
    };
  }, stalePrefix);

for (const format of ["js", "mjs"] as const) {
  for (const stalePrefix of [false, true]) {
    testCases(
      `${format}: Android correction sends only the removed suffix and replacement (stale prefix: ${stalePrefix})`,
      async () => {
        await openTerminal(format, true);
        await prepareTerminal();
        const result = await replayAndroidCorrection(stalePrefix);
        expect(result.before.join("")).toBe(
          (stalePrefix ? "hello" + "\x7f".repeat(5) : "") + "hello thre",
        );
        expect(result.correction).toEqual(["\x7f\x7f", "ere "]);
        expect(result.value).toBe(
          (stalePrefix ? "hello" : "") + "hello there ",
        );
        expect((await snapshot()).intents.slice(-2)).toEqual([
          { kind: "text", data: "\x7f\x7f" },
          { kind: "text", data: "ere " },
        ]);
      },
    );
  }
  testCases(
    `${format}: Android deletion only translates observed trailing removals`,
    async () => {
      await openTerminal(format, true);
      await prepareTerminal();
      const data = await page.evaluate(() => {
        const input = window.terminal.textarea!;
        return (
          [
            ["aaa", 2, "aa"],
            ["hello", 5, "hello"],
            ["hello🙂", 7, "hello"],
          ] as const
        ).map(([oldValue, end, value]) => {
          input.value = oldValue;
          input.setSelectionRange(end, end);
          input.dispatchEvent(
            new InputEvent("beforeinput", {
              inputType: "deleteContentBackward",
            }),
          );
          input.value = value;
          input.dispatchEvent(
            new InputEvent("input", { inputType: "deleteContentBackward" }),
          );
          return window.received.splice(0);
        });
      });
      expect(data).toEqual([[], [], ["\x7f"]]);
    },
  );
  testCases(
    `${format}: Android composition owns its final input and cancellation discards deletion snapshots`,
    async () => {
      await openTerminal(format, true);
      await prepareTerminal();
      await page.evaluate(async () => {
        const input = window.terminal.textarea!;
        input.dispatchEvent(
          new KeyboardEvent("keydown", { keyCode: 229, bubbles: true }),
        );
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "c";
        input.dispatchEvent(
          new InputEvent("input", {
            inputType: "insertCompositionText",
            data: "c",
            isComposing: true,
          }),
        );
        input.dispatchEvent(
          new CompositionEvent("compositionend", { data: "c" }),
        );
        input.dispatchEvent(
          new InputEvent("input", { inputType: "insertText", data: "c" }),
        );
        await new Promise((done) => setTimeout(done, 10));
        input.dispatchEvent(
          new InputEvent("beforeinput", { inputType: "deleteContentBackward" }),
        );
        window.terminal.cancelPendingInput();
        input.dispatchEvent(
          new InputEvent("input", { inputType: "deleteContentBackward" }),
        );
        input.value = "x";
        input.dispatchEvent(
          new InputEvent("input", { inputType: "insertText", data: "x" }),
        );
        await new Promise((done) => setTimeout(done, 10));
      });
      expect((await snapshot()).data).toEqual(["\x03", "x"]);
    },
  );
  for (const { name, run } of scenarios) {
    testCases(`${format}: ${name}`, async () => {
      await openTerminal(format);
      await prepareTerminal();
      await run();
    });
  }
}
