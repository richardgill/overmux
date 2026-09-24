import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigStore } from "./config-store.js";

const temporaryDirectories: string[] = [];

const createStore = async () => {
  const root = join(import.meta.dirname, "../../../../.test-tmp");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "overmux-electron-test-"));
  temporaryDirectories.push(directory);
  return {
    path: join(directory, "desktop-config.json"),
    store: new ConfigStore(join(directory, "desktop-config.json")),
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("desktop config store", () => {
  it("persists and restores one configured URL", async () => {
    const { path, store } = await createStore();
    const config = {
      url: "https://overmux.test/workspace",
      instanceAddresses: [
        { url: "https://overmux.test/workspace", instanceId: "work" },
      ],
    };

    await store.save(config);

    expect(await store.load()).toEqual(config);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
  });

  it("rejects malformed and legacy configuration", async () => {
    const { path, store } = await createStore();
    await writeFile(
      path,
      '{"url":"https://overmux.test/","notificationPermission":"granted"}',
    );

    expect(await store.load()).toBeUndefined();
  });

  it("serializes concurrent snapshots and clear in invocation order", async () => {
    const { store } = await createStore();
    const first = { url: "https://first.test/", instanceAddresses: [] };
    const latest = {
      url: "https://last.test/",
      instanceAddresses: [{ url: "https://last.test/", instanceId: "latest" }],
    };

    await Promise.all([store.save(first), store.clear(), store.save(latest)]);
    expect(await store.load()).toEqual(latest);

    await Promise.all([store.save(first), store.save(latest), store.clear()]);
    expect(await store.load()).toBeUndefined();
  });

  it("rejects the previous URL-only schema without migration", async () => {
    const { path, store } = await createStore();
    await writeFile(path, JSON.stringify({ url: "https://overmux.test/" }));
    expect(await store.load()).toBeUndefined();
  });

  it("removes saved configuration", async () => {
    const { store } = await createStore();
    await store.save({ url: "http://localhost:4242/", instanceAddresses: [] });

    await store.clear();

    expect(await store.load()).toBeUndefined();
  });
});
