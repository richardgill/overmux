import { open, stat } from "node:fs/promises";

const ANCHOR_BYTES = 512;

export type JsonlRead = { records: unknown[]; reset: boolean };
export type JsonlTail = { read: (path: string) => Promise<JsonlRead> };

export const parseCompleteJsonlBytes = (bytes: Buffer): unknown[] => {
  const records: unknown[] = [];
  let offset = 0;
  bytes.forEach((byte, index) => {
    if (byte !== 10) {
      return;
    }
    const line = bytes.subarray(offset, index);
    offset = index + 1;
    if (!line.length) {
      return;
    }
    try {
      records.push(JSON.parse(line.toString("utf8")) as unknown);
    } catch {}
  });
  return records;
};

const parseJsonlLines = (bytes: Buffer) => {
  const newline = bytes.lastIndexOf(10);
  if (newline < 0) {
    return { records: [] as unknown[], remainder: bytes };
  }
  return {
    records: parseCompleteJsonlBytes(bytes.subarray(0, newline + 1)),
    remainder: bytes.subarray(newline + 1),
  };
};

const readBytes = async (
  path: string,
  offset: number,
  length: number,
): Promise<Buffer<ArrayBufferLike>> => {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, offset);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const anchorMatches = async (
  path: string,
  cursor: number,
  anchor: Buffer<ArrayBufferLike>,
) => {
  if (!anchor.length) {
    return true;
  }
  const committed = await readBytes(
    path,
    cursor - anchor.length,
    anchor.length,
  );
  return committed.equals(anchor);
};

const nextAnchor = (
  previous: Buffer<ArrayBufferLike>,
  appended: Buffer<ArrayBufferLike>,
) => Buffer.concat([previous, appended]).subarray(-ANCHOR_BYTES);

export const createJsonlTail = (): JsonlTail => {
  let anchor: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let cursor = 0;
  let identity: string | undefined;
  let remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  return {
    read: async (path) => {
      const metadata = await stat(path).catch(() => undefined);
      if (!metadata?.isFile()) {
        return { records: [], reset: false };
      }
      const nextIdentity = `${metadata.dev}:${metadata.ino}`;
      const replaced = identity !== undefined && identity !== nextIdentity;
      const truncated = metadata.size < cursor;
      const rewritten =
        !replaced && !truncated && !(await anchorMatches(path, cursor, anchor));
      const reset = replaced || truncated || rewritten;
      if (reset) {
        anchor = Buffer.alloc(0);
        cursor = 0;
        remainder = Buffer.alloc(0);
      }
      identity = nextIdentity;
      if (metadata.size === cursor) {
        return { records: [], reset };
      }

      const bytes = await readBytes(path, cursor, metadata.size - cursor);
      cursor += bytes.length;
      anchor = nextAnchor(anchor, bytes);
      const parsed = parseJsonlLines(Buffer.concat([remainder, bytes]));
      remainder = parsed.remainder;
      return { records: parsed.records, reset };
    },
  };
};
