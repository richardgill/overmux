import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPrivateJsonExclusively,
  readPrivateJson,
  replacePrivateJsonAtomically,
} from "./private-json-file";

const directories: string[] = [];
const valueSchema = z.object({ value: z.string() }).strict();

const createPath = async () => {
  const directory = await mkdtemp(join(tmpdir(), "overmux-private-json-"));
  directories.push(directory);
  return join(directory, "nested", "value.json");
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("private JSON files", () => {
  it("creates owner-only files and atomically replaces their validated value", async () => {
    const path = await createPath();

    await createPrivateJsonExclusively(path, { value: "first" });
    await replacePrivateJsonAtomically(path, { value: "second" });

    expect(await readPrivateJson(path, valueSchema)).toEqual({
      value: "second",
    });
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("preserves the first exclusively created value", async () => {
    const path = await createPath();
    await createPrivateJsonExclusively(path, { value: "first" });

    await expect(
      createPrivateJsonExclusively(path, { value: "second" }),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readPrivateJson(path, valueSchema)).toEqual({
      value: "first",
    });
  });
});
