import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);

const fixtureApp = resolve(
  import.meta.dirname,
  "../../../../fixtures/src/app.tsx",
);
const fixtureConfig = resolve(
  import.meta.dirname,
  "../../../../fixtures/overmux.config.ts",
);

test.describe.configure({ mode: "serial" });

const createLoginGrant = async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    resolve(import.meta.dirname, "../dist/bin.js"),
    "auth",
    "login",
    "--json",
  ]);
  return JSON.parse(stdout) as { code: string; urls: string[] };
};

const establishBrowserSession = async (page: Page) => {
  const grant = await createLoginGrant();
  await page.goto(grant.urls[0]!);
  await expect(page).toHaveURL(/\/$/);
};

const pasteLoginCode = async (input: Locator, text: string) => {
  await input.evaluate((element, pasted) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", pasted);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, text);
};

const placeCodeCaret = async (input: Locator, position: number) => {
  await input.focus();
  await input.evaluate((element: HTMLInputElement, caret) => {
    element.setSelectionRange(caret, caret);
  }, position);
};

test("keeps Vite HTTP and WebSocket traffic private before login", async ({
  page,
  request,
}) => {
  const responses = await Promise.all([
    request.get("/api/runtime-manifest"),
    request.get("/@vite/client"),
    request.get("/src/app.tsx"),
  ]);
  const socketResult = await page.evaluate(
    (socketUrl) =>
      new Promise<"opened" | "rejected">((resolveSocket) => {
        const socket = new WebSocket(socketUrl, "vite-hmr");
        socket.addEventListener("open", () => resolveSocket("opened"), {
          once: true,
        });
        socket.addEventListener("error", () => resolveSocket("rejected"), {
          once: true,
        });
      }),
    "ws://127.0.0.1:4210/_overmux/vite/hmr",
  );

  expect(responses.map((response) => response.status())).toEqual([
    401, 401, 401,
  ]);
  await expect(responses[0]!.json()).resolves.toEqual({
    error: "Authentication required",
  });
  expect(socketResult).toBe("rejected");
});

test("serves the locked shell and completes user-facing login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).toContainText("Overmux is locked");
  expect((await page.request.get("/@vite/client")).status()).toBe(401);

  const grant = await createLoginGrant();
  await pasteLoginCode(
    page.getByLabel("Login code"),
    `  ${grant.code.replace("-", "").toLowerCase()}\n`,
  );
  const loginRequest = page.waitForRequest("**/api/auth/login");
  await page.getByRole("button", { name: "Unlock Overmux" }).click();
  expect((await loginRequest).postDataJSON()).toEqual({ code: grant.code });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("main")).toContainText(
    /Loading workspace|Reload tmux config/,
  );
});

test("edits the grouped login code as one text field", async ({ page }) => {
  await page.goto("/login");
  const input = page.getByLabel("Login code");
  await input.pressSequentially("abcd-efgh");
  await expect(input).toHaveValue("ABCD-EFGH");
  await input.pressSequentially("jkl");
  await expect(input).toHaveValue("ABCD-EFGH");
  await placeCodeCaret(input, 2);
  await input.pressSequentially("j");
  await expect(input).toHaveValue("ABCD-EFGH");

  await placeCodeCaret(input, 5);
  await input.press("Backspace");
  await expect(input).toHaveValue("ABCE-FGH");
  await input.pressSequentially("d");
  await expect(input).toHaveValue("ABCD-EFGH");

  await input.press("ArrowLeft");
  await input.press("Delete");
  await expect(input).toHaveValue("ABCD-FGH");
  await input.pressSequentially("e");
  await expect(input).toHaveValue("ABCD-EFGH");

  await placeCodeCaret(input, 3);
  await input.press("Backspace");
  await expect(input).toHaveValue("ABDE-FGH");
  await input.pressSequentially("c");
  await expect(input).toHaveValue("ABCD-EFGH");

  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await input.press("Tab");
  await expect(
    page.getByRole("button", { name: "Unlock Overmux" }),
  ).toBeFocused();
});

test("pastes whole codes into either group and partial codes into a selection", async ({
  page,
}) => {
  await page.goto("/login");
  const input = page.getByLabel("Login code");
  const pasteCases = [
    { caret: 0, text: "  abcd-efgh\n" },
    { caret: 5, text: "\tabcdefgh  " },
  ];
  for (const { caret, text } of pasteCases) {
    await input.fill("ZZZZ-ZZZZ");
    await placeCodeCaret(input, caret);
    await pasteLoginCode(input, text);
    await expect(input).toHaveValue("ABCD-EFGH");
  }

  await input.evaluate((element: HTMLInputElement) =>
    element.setSelectionRange(5, 9),
  );
  await pasteLoginCode(input, "jklm");
  await expect(input).toHaveValue("ABCD-JKLM");

  await expect(page.locator("#auth-code-error")).toBeEmpty();
  await expect(page).toHaveURL(/\/login$/);
});

test("rejects malformed login codes locally without truncating or removing internal spaces", async ({
  page,
}) => {
  const loginRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/login")) {
      loginRequests.push(request.url());
    }
  });
  await page.goto("/login");
  const input = page.getByLabel("Login code");
  const invalidCodes = [
    { text: "ABCD EFGH", expected: "" },
    { text: "ABCD-EFGHJ", expected: "" },
    { text: "ABCD_EFGH", expected: "" },
    { text: "ABC", expected: "ABC" },
  ];
  for (const { text, expected } of invalidCodes) {
    await input.fill("");
    await pasteLoginCode(input, text);
    await input.press("Enter");
    await expect(input).toHaveValue(expected);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#auth-code-error")).toContainText(
      "no spaces inside",
    );
  }
  await input.fill("");
  await pasteLoginCode(input, "ABCD\nEFGH");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("aria-invalid", "true");

  await input.fill("");
  await input.pressSequentially("abcd efgh");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("abcdefgh");
  await pasteLoginCode(input, "ABCD-EFGHJ");
  await input.press("Enter");
  await expect(input).toHaveValue("ABCD-EFGH");
  await expect(input).toHaveAttribute("aria-invalid", "true");

  await placeCodeCaret(input, 5);
  await pasteLoginCode(input, "JK");
  await input.press("Enter");
  await expect(input).toHaveValue("ABCD-EFGH");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(loginRequests).toEqual([]);

  await input.fill("abcdefgh");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveValue("ABCD-EFGH");
});

test.describe("authenticated Vite app", () => {
  test.beforeEach(async ({ page }) => establishBrowserSession(page));

  test("serves the Vite app and proxies HTTP and WebSocket runtime traffic", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("main")).toContainText(
      /Loading workspace|Reload tmux config/,
    );

    const manifest = await page.request.get("/api/runtime-manifest");
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({
      resources: expect.arrayContaining(["workspaceState"]),
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolveSocket, reject) => {
              const socket = new WebSocket(
                `${location.origin.replace("http", "ws")}/api/socket`,
              );
              socket.addEventListener(
                "open",
                () => {
                  socket.close();
                  resolveSocket("open");
                },
                { once: true },
              );
              socket.addEventListener(
                "error",
                () => reject(new Error("WebSocket failed to connect")),
                { once: true },
              );
            }),
        ),
      )
      .toBe("open");
  });

  test("closes the Vite HMR socket when its session logs out", async ({
    page,
  }) => {
    await page.route("**/src/main.tsx", (route) =>
      route.fulfill({ body: "", contentType: "application/javascript" }),
    );
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, argumentsList) {
          const socket = new Target(...argumentsList);
          if (
            String(argumentsList[0]).includes("/_overmux/vite/hmr") &&
            !(window as typeof window & { viteSocket?: WebSocket }).viteSocket
          ) {
            const trackedWindow = window as typeof window & {
              viteCloseCode?: number;
              viteSocket?: WebSocket;
            };
            trackedWindow.viteSocket = socket;
            socket.addEventListener("close", (event) => {
              trackedWindow.viteCloseCode = event.code;
            });
          }
          return socket;
        },
      });
    });
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { viteSocket?: WebSocket }).viteSocket
              ?.readyState,
        ),
      )
      .toBe(WebSocket.OPEN);

    const logout = await page.request.post("/api/auth/logout", {
      headers: {
        Origin: page.url().replace(/\/$/, ""),
        "Sec-Fetch-Site": "same-origin",
      },
    });

    expect(logout.ok()).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { viteCloseCode?: number })
              .viteCloseCode,
        ),
      )
      .toBe(4001);
    expect((await page.request.get("/src/app.tsx")).status()).toBe(401);
  });

  test("keeps frontend edits under Vite HMR ownership", async ({ page }) => {
    const original = await readFile(fixtureApp, "utf8");
    try {
      await page.goto("/");
      await writeFile(
        fixtureApp,
        original.replace("Loading workspace…", "Vite HMR marker"),
      );
      await expect(page.locator("main")).toContainText("Vite HMR marker");
      await expect(
        page.locator("[data-om-update], [data-om-restarting]"),
      ).toHaveCount(0);
    } finally {
      await writeFile(fixtureApp, original);
    }
  });

  test("restarts trusted changes through the mandatory recovery UI and reconnects", async ({
    page,
    request,
  }) => {
    const original = await readFile(fixtureConfig, "utf8");
    try {
      await page.goto("/");
      await writeFile(
        fixtureConfig,
        `${original}\n// watched by the Vite integration e2e\n`,
      );
      await expect(page.locator("[data-om-update]")).toBeVisible();
      let restartOutageObserved = false;
      await page.route("**/api/health", async (route) => {
        try {
          if (!(await route.fetch()).ok()) {
            restartOutageObserved = true;
          }
        } catch {
          restartOutageObserved = true;
        }
        await route.fulfill({ status: 503 });
      });
      await page.locator("[data-om-update-reload]").click();
      await expect(page.locator("[data-om-restarting]")).toBeVisible();
      await expect.poll(() => restartOutageObserved).toBe(true);
      await expect
        .poll(
          async () =>
            request
              .get("/api/health")
              .then((response) => response.ok())
              .catch(() => false),
          { timeout: 15_000 },
        )
        .toBe(true);
      // Drain the intercepted health probe before reload can abort it.
      await page.unrouteAll({ behavior: "wait" });
      await page.reload();
      await expect(page.locator("main")).toContainText(
        /Loading workspace|Reload tmux config/,
      );
    } finally {
      await writeFile(fixtureConfig, original);
    }
  });
});
