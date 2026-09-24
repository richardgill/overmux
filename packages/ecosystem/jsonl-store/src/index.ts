import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

const MAX_ROW_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const jsonValue = z.json();

export type JsonlStore<TSchema extends z.ZodType> = {
  append: (row: z.input<TSchema>) => Promise<z.output<TSchema>>;
  getAll: () => Promise<readonly z.output<TSchema>[]>;
  rows: () => AsyncIterable<z.output<TSchema>>;
};

export class JsonlStoreCorruptionError extends Error {
  readonly path: string;
  readonly lineNumber: number;

  constructor({
    cause,
    lineNumber,
    path,
  }: {
    cause: unknown;
    lineNumber: number;
    path: string;
  }) {
    super(`JSONL store corruption at ${path}:${lineNumber}`, { cause });
    this.name = "JsonlStoreCorruptionError";
    this.path = path;
    this.lineNumber = lineNumber;
  }
}

export class JsonlStoreSerializationError extends Error {
  readonly path: string;

  constructor({ cause, path }: { cause: unknown; path: string }) {
    super(`Cannot serialize JSONL store row for ${path}`, { cause });
    this.name = "JsonlStoreSerializationError";
    this.path = path;
  }
}

type LineState = {
  chunks: Buffer[];
  length: number;
  lineNumber: number;
};

const isMissingFile = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const parseLine = <TSchema extends z.ZodType>({
  line,
  lineNumber,
  path,
  schema,
}: {
  line: Buffer;
  lineNumber: number;
  path: string;
  schema: TSchema;
}): z.output<TSchema> => {
  try {
    return schema.parse(JSON.parse(line.toString("utf8")));
  } catch (cause) {
    throw new JsonlStoreCorruptionError({ cause, lineNumber, path });
  }
};

const collectRows = async <T>(rows: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const row of rows) {
    collected.push(row);
  }
  return collected;
};

const truncateIncompleteFinalLine = async (
  handle: Awaited<ReturnType<typeof open>>,
) => {
  const { size } = await handle.stat();
  for (let end = size; end > 0;) {
    const start = Math.max(0, end - READ_CHUNK_BYTES);
    const bytes = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    const newline = bytes.subarray(0, bytesRead).lastIndexOf(10);
    if (newline >= 0) {
      if (start + newline + 1 < size) {
        await handle.truncate(start + newline + 1);
      }
      return;
    }
    end = start;
  }
  if (size > 0) {
    await handle.truncate(0);
  }
};

const appendLine = async (path: string, line: Buffer): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "a+", 0o600);
  try {
    await truncateIncompleteFinalLine(handle);
    await handle.writeFile(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const consumeChunk = ({
  bytes,
  path,
  state,
}: {
  bytes: Buffer;
  path: string;
  state: LineState;
}): Buffer[] => {
  const completeLines: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 10) {
      continue;
    }
    const fragment = bytes.subarray(offset, index);
    const lineLength = state.length + fragment.length;
    if (lineLength > MAX_ROW_BYTES) {
      throw new JsonlStoreCorruptionError({
        cause: new RangeError(`Row exceeds ${MAX_ROW_BYTES} bytes`),
        lineNumber: state.lineNumber,
        path,
      });
    }
    if (fragment.length > 0) {
      state.chunks.push(fragment);
    }
    completeLines.push(Buffer.concat(state.chunks, lineLength));
    state.chunks = [];
    state.length = 0;
    state.lineNumber += 1;
    offset = index + 1;
  }
  const fragment = bytes.subarray(offset);
  state.length += fragment.length;
  if (state.length <= MAX_ROW_BYTES && fragment.length > 0) {
    state.chunks.push(fragment);
  }
  return completeLines;
};

const streamRows = async function* <TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): AsyncGenerator<z.output<TSchema>> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const state: LineState = {
      chunks: [],
      length: 0,
      lineNumber: 1,
    };
    for (let position = 0; position < size;) {
      const length = Math.min(READ_CHUNK_BYTES, size - position);
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, position);
      if (bytesRead === 0) {
        return;
      }
      position += bytesRead;
      const completeLines = consumeChunk({
        bytes: bytes.subarray(0, bytesRead),
        path,
        state,
      });
      const firstLineNumber = state.lineNumber - completeLines.length;
      for (const [index, line] of completeLines.entries()) {
        yield parseLine({
          line,
          lineNumber: firstLineNumber + index,
          path,
          schema,
        });
      }
    }
  } finally {
    await handle.close();
  }
};

const serializeRow = <TSchema extends z.ZodType>({
  parsed,
  path,
  schema,
}: {
  parsed: z.output<TSchema>;
  path: string;
  schema: TSchema;
}): Buffer => {
  try {
    const canonical = jsonValue.parse(parsed);
    const serialized = JSON.stringify(canonical);
    if (typeof serialized !== "string") {
      throw new TypeError("Row does not serialize to JSON");
    }
    const replayed = jsonValue.parse(schema.parse(JSON.parse(serialized)));
    if (!isDeepStrictEqual(replayed, canonical)) {
      throw new TypeError("Row schema output does not replay from JSON");
    }
    const line = Buffer.from(`${serialized}\n`, "utf8");
    if (line.length - 1 > MAX_ROW_BYTES) {
      throw new RangeError(`Row exceeds ${MAX_ROW_BYTES} bytes`);
    }
    return line;
  } catch (cause) {
    throw new JsonlStoreSerializationError({ cause, path });
  }
};

export const createJsonlStore = <TSchema extends z.ZodType>({
  path,
  schema,
}: {
  path: string;
  schema: TSchema;
}): JsonlStore<TSchema> => {
  let writeChain = Promise.resolve();

  const append = async (row: z.input<TSchema>): Promise<z.output<TSchema>> => {
    const parsed = schema.parse(row);
    const line = serializeRow({ parsed, path, schema });
    const operation = writeChain.then(() => appendLine(path, line));
    writeChain = operation.catch(() => undefined);
    await operation;
    return parsed;
  };

  const rows = () => streamRows(path, schema);

  return {
    append,
    getAll: () => collectRows(rows()),
    rows,
  };
};
