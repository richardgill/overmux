import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";

import {
  createJsonlStore,
  JsonlStoreCorruptionError,
  JsonlStoreSerializationError,
} from "./index";

const directories: string[] = [];

const createPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "overmux-jsonl-store-"));
  directories.push(directory);
  return join(directory, "nested", "records.jsonl");
};

const collect = async <T>(rows: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const row of rows) {
    collected.push(row);
  }
  return collected;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("JSONL store", () => {
  it("publishes only an explicit server entry point", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(packageJson.exports)).toEqual(["./server"]);
  });

  it("returns Zod defaults and transforms from appends and reads", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({
        count: z.number().default(1),
        name: z.string().transform((name) => name.toUpperCase()),
      }),
    });

    await expect(store.append({ name: "ada" })).resolves.toEqual({
      count: 1,
      name: "ADA",
    });
    await expect(store.getAll()).resolves.toEqual([{ count: 1, name: "ADA" }]);
  });

  it("rejects transforms that do not replay persisted output", async () => {
    const path = await createPath();
    const typeChanging = createJsonlStore({
      path,
      schema: z.string().transform((value) => value.length),
    });
    const incrementing = createJsonlStore({
      path: `${path}.incrementing`,
      schema: z.number().transform((value) => value + 1),
    });

    await expect(typeChanging.append("ada")).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    await expect(incrementing.append(1)).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
  });

  it("serializes concurrent appends in call order", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, value) => store.append({ value })),
    );

    await expect(store.getAll()).resolves.toEqual(
      Array.from({ length: 20 }, (_, value) => ({ value })),
    );
  });

  it("treats missing and empty files as empty stores", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });

    await expect(store.getAll()).resolves.toEqual([]);
    await expect(collect(store.rows())).resolves.toEqual([]);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "");
    await expect(store.getAll()).resolves.toEqual([]);
  });

  it("excludes later appends from an iterator snapshot", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });
    await store.append({ value: 1 });
    const iterator = store.rows()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { value: 1 },
    });
    await store.append({ value: 2 });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("streams rows that span multiple read chunks", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.string() }),
    });
    const row = { value: "x".repeat(70_000) };
    await store.append(row);

    await expect(collect(store.rows())).resolves.toEqual([row]);
  });

  it("reports oversized persisted rows as corruption", async () => {
    const path = await createPath();
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify("x".repeat(1024 * 1024))}\n`);
    const store = createJsonlStore({ path, schema: z.string() });

    await expect(store.getAll()).rejects.toMatchObject({ lineNumber: 1, path });
  });

  it("recovers an incomplete final line before the next append", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });
    await store.append({ value: 1 });
    await writeFile(path, '{"value":1}\n{"value":');

    await expect(store.getAll()).resolves.toEqual([{ value: 1 }]);
    await store.append({ value: 2 });
    await expect(store.getAll()).resolves.toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("reports malformed complete lines with their path and line number", async () => {
    const path = await createPath();
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, '{"value":1}\nnot json\n');
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });

    await expect(store.getAll()).rejects.toMatchObject({ lineNumber: 2, path });
    await expect(collect(store.rows())).rejects.toBeInstanceOf(
      JsonlStoreCorruptionError,
    );
  });

  it("rejects oversized and non-JSON rows", async () => {
    const path = await createPath();
    const store = createJsonlStore({ path, schema: z.any() });

    await expect(store.append("x".repeat(1024 * 1024))).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    await expect(store.append(NaN)).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    await expect(store.append({ missing: undefined })).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    await expect(store.append(new Date())).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    await expect(store.append(1n)).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(store.append(cyclic)).rejects.toBeInstanceOf(
      JsonlStoreSerializationError,
    );
  });

  it("creates private directories and files", async () => {
    const path = await createPath();
    const store = createJsonlStore({
      path,
      schema: z.object({ value: z.number() }),
    });
    await store.append({ value: 1 });

    if (process.platform !== "win32") {
      await expect(stat(path)).resolves.toMatchObject({
        mode: expect.any(Number),
      });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
    }
  });
});
