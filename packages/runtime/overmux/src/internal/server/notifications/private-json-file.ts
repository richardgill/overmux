/*
 * Provides private, schema-validated JSON files with atomic persistence: directories and files
 * use owner-only modes; writes fsync a temporary file before rename replacement or hard-link
 * exclusive publication so concurrent first creation safely converges.
 */
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

const missingFile = (cause: unknown) =>
  (cause as NodeJS.ErrnoException).code === "ENOENT";

const preparePrivateDirectory = async (path: string) => {
  await mkdir(path, { mode: 0o700, recursive: true });
  await chmod(path, 0o700);
};

const writeTemporaryPrivateJson = async (path: string, value: unknown) => {
  await preparePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}`;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temporaryPath;
  } catch (cause) {
    await rm(temporaryPath, { force: true });
    throw cause;
  }
};

export const readPrivateJson = async <TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema> | undefined> => {
  try {
    const contents = await readFile(path, "utf8");
    await chmod(path, 0o600);
    return schema.parse(JSON.parse(contents));
  } catch (cause) {
    if (missingFile(cause)) {
      return undefined;
    }
    throw cause;
  }
};

export const replacePrivateJsonAtomically = async (
  path: string,
  value: unknown,
) => {
  const temporaryPath = await writeTemporaryPrivateJson(path, value);
  try {
    await rename(temporaryPath, path);
  } catch (cause) {
    await rm(temporaryPath, { force: true });
    throw cause;
  }
};

export const createPrivateJsonExclusively = async (
  path: string,
  value: unknown,
) => {
  const temporaryPath = await writeTemporaryPrivateJson(path, value);
  try {
    await link(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};
