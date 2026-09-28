import * as fs from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, test as testCases, vi } from "vitest";
import { readContents, readWorkingSummary } from "./contents";

vi.mock("node:fs/promises", { spy: true });
const actualFs = await vi.importActual<typeof fs>("node:fs/promises");
const roots: string[] = [];
const testRoot = fileURLToPath(
  new URL("../../../../../.test-tmp/", import.meta.url),
);

const workingFile = async (content = Buffer.from("one\ntwo\n")) => {
  await fs.mkdir(testRoot, { recursive: true });
  const repoRoot = await fs.mkdtemp(join(testRoot, "git-contents-"));
  roots.push(repoRoot);
  await fs.writeFile(join(repoRoot, "file.txt"), content);
  return {
    repository: {
      repoRoot,
      worktreeGitDir: join(repoRoot, ".git"),
      sharedGitDir: join(repoRoot, ".git"),
    },
    file: "file.txt",
    signal: new AbortController().signal,
  };
};

const readWorkingContents = (
  options: Awaited<ReturnType<typeof workingFile>>,
) =>
  readContents({
    ...options,
    files: [
      {
        path: options.file,
        status: "added",
        binary: false,
        old: { kind: "absent" },
        new: { kind: "workingFile", path: options.file },
      },
    ],
  });

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

testCases.each([
  { name: "diff contents", read: readWorkingContents },
  { name: "working summary", read: readWorkingSummary },
])(
  "cancels $name after opening without an unhandled stream error",
  async ({ read }) => {
    const options = await workingFile();
    const controller = new AbortController();
    const reason = new Error("WebSocket connection closed");
    const handle = await actualFs.open(
      join(options.repository.repoRoot, options.file),
    );
    vi.mocked(fs.open).mockImplementationOnce(async () => {
      controller.abort(reason);
      return handle;
    });

    await expect(read({ ...options, signal: controller.signal })).rejects.toBe(
      reason,
    );
    // The original iterator rejected correctly, then crashed on a later error event.
    await setImmediate();
    expect(handle.fd).toBe(-1);
  },
);

it("cancels an active stream and closes the file handle", async () => {
  const options = await workingFile(Buffer.alloc(256 * 1024, 65));
  const controller = new AbortController();
  const reason = new Error("WebSocket connection closed");
  const handle = await actualFs.open(
    join(options.repository.repoRoot, options.file),
  );
  const createReadStream = handle.createReadStream.bind(handle);
  vi.spyOn(handle, "createReadStream").mockImplementation((streamOptions) => {
    const stream = createReadStream(streamOptions);
    stream.once("readable", () => controller.abort(reason));
    return stream;
  });
  vi.mocked(fs.open).mockResolvedValueOnce(handle);

  await expect(
    readWorkingContents({ ...options, signal: controller.signal }),
  ).rejects.toBe(reason);
  await setImmediate();
  expect(handle.fd).toBe(-1);
});

it("propagates read failures and closes the file handle", async () => {
  const options = await workingFile();
  const reason = Object.assign(new Error("disk read failed"), { code: "EIO" });
  const handle = await actualFs.open(
    join(options.repository.repoRoot, options.file),
  );
  vi.spyOn(handle, "read").mockRejectedValueOnce(reason);
  vi.mocked(fs.open).mockResolvedValueOnce(handle);

  await expect(readWorkingContents(options)).rejects.toBe(reason);
  await setImmediate();
  expect(handle.fd).toBe(-1);
});

it("closes the handle when a binary summary stops reading early", async () => {
  const options = await workingFile(Buffer.alloc(256 * 1024));
  const handle = await actualFs.open(
    join(options.repository.repoRoot, options.file),
  );
  vi.mocked(fs.open).mockResolvedValueOnce(handle);

  await expect(readWorkingSummary(options)).resolves.toEqual({
    binary: true,
    lineStats: null,
  });
  await setImmediate();
  expect(handle.fd).toBe(-1);
});
