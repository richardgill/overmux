import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFileBackgroundNotificationStore } from "./background-notification-store";

const directories: string[] = [];
const subscription = (endpoint: string, auth = "auth-key") => ({
  endpoint,
  expirationTime: null,
  keys: { auth, p256dh: "p256-key" },
});
const ownedSubscription = (
  sessionId: string,
  endpoint: string,
  auth = "auth-key",
) => ({
  sessionId,
  subscription: subscription(endpoint, auth),
});

const createStore = async () => {
  const dataHome = await mkdtemp(join(tmpdir(), "overmux-background-"));
  directories.push(dataHome);
  const store = createFileBackgroundNotificationStore({
    environment: { XDG_DATA_HOME: dataHome },
    homeDirectory: "/unused",
  });
  return { dataHome, store };
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("background notification persistence", () => {
  it("generates VAPID keys on first use and reloads them from the XDG path", async () => {
    const { dataHome, store } = await createStore();
    const generate = vi.fn(() => ({
      privateKey: "private-key",
      publicKey: "public-key",
    }));

    expect(await store.getOrCreateKeys(generate)).toEqual({
      privateKey: "private-key",
      publicKey: "public-key",
    });
    const restarted = createFileBackgroundNotificationStore({
      environment: { XDG_DATA_HOME: dataHome },
      homeDirectory: "/unused",
    });
    expect(await restarted.getOrCreateKeys(generate)).toEqual({
      privateKey: "private-key",
      publicKey: "public-key",
    });

    const directory = join(dataHome, "overmux", "background-notifications");
    expect(generate).toHaveBeenCalledOnce();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "vapid.json"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("uses the required home-directory fallback", async () => {
    const homeDirectory = await mkdtemp(
      join(tmpdir(), "overmux-background-home-"),
    );
    directories.push(homeDirectory);
    const store = createFileBackgroundNotificationStore({
      environment: {},
      homeDirectory,
    });

    await store.upsertSubscription(
      "session-a",
      subscription("https://push.test/a"),
    );

    expect(await store.listSubscriptions()).toEqual([
      ownedSubscription("session-a", "https://push.test/a"),
    ]);
    expect(
      (
        await stat(
          join(
            homeDirectory,
            ".local",
            "share",
            "overmux",
            "background-notifications",
          ),
        )
      ).isDirectory(),
    ).toBe(true);
  });

  it("does not rewrite unchanged subscription state", async () => {
    const { dataHome, store } = await createStore();
    const subscriptionsPath = join(
      dataHome,
      "overmux",
      "background-notifications",
      "subscriptions.json",
    );
    const input = subscription("https://push.test/a");
    await store.upsertSubscription("session-a", input);
    const original = await stat(subscriptionsPath);

    await store.upsertSubscription("session-a", input);
    await store.removeSubscription("https://push.test/missing");

    expect((await stat(subscriptionsPath)).ino).toBe(original.ino);
  });

  it("reports corrupt persisted subscriptions without overwriting them", async () => {
    const { dataHome, store } = await createStore();
    const directory = join(dataHome, "overmux", "background-notifications");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "subscriptions.json"), "not json\n");

    await expect(store.listSubscriptions()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("persists enable and disable by subscription endpoint", async () => {
    const { dataHome, store } = await createStore();
    await Promise.all([
      store.upsertSubscription(
        "session-a",
        subscription("https://push.test/a"),
      ),
      store.upsertSubscription(
        "session-b",
        subscription("https://push.test/b"),
      ),
    ]);
    await store.upsertSubscription(
      "session-a",
      subscription("https://push.test/a", "replacement-auth"),
    );

    const restarted = createFileBackgroundNotificationStore({
      environment: { XDG_DATA_HOME: dataHome },
      homeDirectory: "/unused",
    });
    expect(await restarted.listSubscriptions()).toEqual([
      ownedSubscription("session-b", "https://push.test/b"),
      ownedSubscription("session-a", "https://push.test/a", "replacement-auth"),
    ]);

    await restarted.removeSessionSubscriptions(new Set(["session-a"]));
    expect(await restarted.listSubscriptions()).toEqual([
      ownedSubscription("session-b", "https://push.test/b"),
    ]);

    await restarted.removeSubscription("https://push.test/b");
    expect(await restarted.listSubscriptions()).toEqual([]);
  });
});
