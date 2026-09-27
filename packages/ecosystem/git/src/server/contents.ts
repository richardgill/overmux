// Captures immutable blobs in batches and working files without following filesystem links.
import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitFileSchema } from "../shared";
import type { ContentSource, FileComparison } from "./comparisons";
import { MAX_CONTENT_BYTES, runGit } from "./execution";
import { assertFileOutsideMetadata, type Repository } from "./repository";

export type FileContents = {
  file: string;
  previousPath?: string;
  oldBytes: Buffer | null;
  newBytes: Buffer | null;
};

type WorkingOptions = {
  repository: Repository;
  file: string;
  signal: AbortSignal;
};

const isMissing = (cause: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((cause as NodeJS.ErrnoException)?.code ?? "");

const workingChunks = async function* ({
  repository,
  file,
  signal,
}: WorkingOptions) {
  gitFileSchema.parse(file);

  const path = join(repository.repoRoot, file);
  assertFileOutsideMetadata(repository, path);

  try {
    // Reject directory symlinks, including links back into the tree: their Git path
    // names the link, not its descendants. A final symlink is read as target text.
    const parent = dirname(path);

    if ((await realpath(parent)) !== parent) {
      throw new Error("Git file cannot traverse a symlink directory");
    }

    signal.throwIfAborted();
    const metadata = await lstat(path);

    if (metadata.isSymbolicLink()) {
      yield await readlink(path, { encoding: "buffer" });
      return;
    }

    if (!metadata.isFile()) {
      throw new Error("Git diff does not support directories or submodules");
    }

    // O_NOFOLLOW closes a final-component replacement race between lstat and open.
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const opened = await handle.stat();
      if (
        opened.dev !== metadata.dev ||
        opened.ino !== metadata.ino ||
        (await realpath(parent)) !== parent
      ) {
        throw new Error(
          "Git file changed identity while opening it; retry the read",
        );
      }

      // A stream bounds growth during the read too, unlike a size check + readFile.
      yield Buffer.alloc(0);

      for await (const chunk of handle.createReadStream({
        autoClose: false,
        signal,
      })) {
        yield chunk as Buffer;
      }
    } finally {
      await handle.close();
    }
  } catch (cause) {
    signal.throwIfAborted();
    if (!isMissing(cause)) {
      throw cause;
    }
  }
};

const readWorkingFile = async (
  options: WorkingOptions,
): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of workingChunks(options)) {
    size += chunk.length;
    if (size > MAX_CONTENT_BYTES) {
      throw new Error(`Git file content exceeded ${MAX_CONTENT_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
};

export const readWorkingSummary = async (options: WorkingOptions) => {
  let lines = 0;
  let finalByte: number | undefined;
  let sample = Buffer.alloc(0);

  // Summary counts stream without retaining file contents or building hunks.
  for await (const chunk of workingChunks(options)) {
    if (sample.length < 8192) {
      sample = Buffer.concat([sample, chunk.subarray(0, 8192 - sample.length)]);
    }
    if (sample.includes(0)) {
      return { binary: true, lineStats: null };
    }
    if (chunk.length) {
      finalByte = chunk[chunk.length - 1];
    }
    for (const byte of chunk) {
      if (byte === 10) {
        lines += 1;
      }
    }
  }

  try {
    // A character split at the sample boundary is not evidence of binary data.
    new TextDecoder("utf-8", { fatal: true }).decode(sample, {
      stream: sample.length === 8192,
    });
  } catch {
    return { binary: true, lineStats: null };
  }

  return {
    binary: false,
    lineStats: {
      added: lines + Number(finalByte !== undefined && finalByte !== 10),
      deleted: 0,
    },
  };
};

const readBlobs = async ({
  repository,
  files,
  signal,
}: {
  repository: Repository;
  files: readonly FileComparison[];
  signal: AbortSignal;
}) => {
  const ids = [
    ...new Set(
      files
        .flatMap((file) => [file.old, file.new])
        .flatMap((side) => (side.kind === "blob" ? [side.gitObjectId] : [])),
    ),
  ];
  const blobs = new Map<string, Buffer>();

  if (!ids.length) {
    return blobs;
  }

  // Check every object size before asking Git to emit payloads. Batch output has a
  // separate ceiling; the content-side bound still applies independently.
  const sizes = await runGit(
    repository.repoRoot,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { signal, input: `${ids.join("\n")}\n` },
  );

  for (const row of sizes.toString("utf8").trim().split("\n")) {
    const [, type, size] = row.split(" ");
    if (type !== "blob") {
      throw new Error("Git diff does not support directories or submodules");
    }
    if (Number(size) > MAX_CONTENT_BYTES) {
      throw new Error(`Git blob content exceeded ${MAX_CONTENT_BYTES} bytes`);
    }
  }

  const output = await runGit(repository.repoRoot, ["cat-file", "--batch"], {
    signal,
    input: `${ids.join("\n")}\n`,
    maxOutputBytes: ids.length * (MAX_CONTENT_BYTES + 128),
  });

  let offset = 0;
  for (const id of ids) {
    const end = output.indexOf(10, offset);
    const [actualId, type, sizeText] = output
      .subarray(offset, end)
      .toString("utf8")
      .split(" ");
    const size = Number(sizeText);
    if (
      actualId !== id ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_CONTENT_BYTES ||
      end + size + 2 > output.length
    ) {
      throw new Error("Invalid Git batch blob response");
    }
    blobs.set(id, output.subarray(end + 1, end + 1 + size));
    offset = end + size + 2;
  }
  return blobs;
};

const readSide = (
  side: ContentSource,
  blobs: Map<string, Buffer>,
  repository: Repository,
  signal: AbortSignal,
) => {
  if (side.kind === "absent") {
    return null;
  }
  if (side.kind === "workingFile") {
    return readWorkingFile({ repository, file: side.path, signal });
  }
  const bytes = blobs.get(side.gitObjectId);
  if (!bytes) {
    throw new Error("Missing captured Git blob");
  }
  return bytes;
};

export const readContents = async ({
  repository,
  files,
  signal,
}: {
  repository: Repository;
  files: readonly FileComparison[];
  signal: AbortSignal;
}): Promise<FileContents[]> => {
  if (files.some((file) => file.status === "conflicted")) {
    throw new Error("Git diff does not support conflicted files");
  }

  const blobs = await readBlobs({ repository, files, signal });

  return Promise.all(
    files.map(async (file) => {
      const [oldBytes, newBytes] = await Promise.all([
        readSide(file.old, blobs, repository, signal),
        readSide(file.new, blobs, repository, signal),
      ]);
      return {
        file: file.path,
        ...(file.previousPath === undefined
          ? {}
          : { previousPath: file.previousPath }),
        oldBytes,
        newBytes,
      };
    }),
  );
};
