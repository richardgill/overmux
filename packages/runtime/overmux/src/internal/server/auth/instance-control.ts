import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, readdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { z } from "zod";

import { instanceIdSchema } from "@overmux/shared";

import { getOvermuxPaths } from "../paths";
import { replacePrivateJsonAtomically } from "../notifications/private-json-file";
import type { AuthService } from "./auth-service";

const maxControlMessageBytes = 16_384;

const controlRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("get-instance") }).strict(),
  z.object({ type: z.literal("ping") }).strict(),
  z.object({ type: z.literal("create-login") }).strict(),
  z.object({ type: z.literal("issue-bearer") }).strict(),
  z.object({ type: z.literal("list-sessions") }).strict(),
  z.object({ id: z.string(), type: z.literal("revoke-session") }).strict(),
  z.object({ type: z.literal("revoke-all") }).strict(),
]);

const loginGrantSchema = z
  .object({
    code: z.string(),
    expiresAt: z.string(),
    id: z.string(),
    urls: z.array(z.string()),
  })
  .strict();

const sessionSchema = z
  .object({
    createdAt: z.string(),
    expiresAt: z.string().optional(),
    id: z.string(),
    lastSeenAt: z.string(),
    origin: z.string().optional(),
    revokedAt: z.string().optional(),
  })
  .strict();

const controlResponseSchemas = {
  "get-instance": z
    .object({ instanceId: instanceIdSchema, ok: z.literal(true) })
    .strict(),
  "create-login": z
    .object({ login: loginGrantSchema, ok: z.literal(true) })
    .strict(),
  "issue-bearer": z
    .object({
      bearer: z.object({ expiresAt: z.string(), token: z.string() }).strict(),
      ok: z.literal(true),
    })
    .strict(),
  "list-sessions": z
    .object({ ok: z.literal(true), sessions: z.array(sessionSchema) })
    .strict(),
  ping: z.object({ ok: z.literal(true) }).strict(),
  "revoke-all": z
    .object({ count: z.number().int().nonnegative(), ok: z.literal(true) })
    .strict(),
  "revoke-session": z
    .object({ ok: z.literal(true), revoked: z.boolean() })
    .strict(),
};

const controlResponseEnvelopeSchema = z
  .object({ error: z.unknown().optional(), ok: z.unknown() })
  .passthrough();

const registrationSchema = z.object({
  apiUrl: z.string().url(),
  controlSocket: z.string(),
  id: z.string(),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  url: z.string().url(),
});

export type InstanceRegistration = z.infer<typeof registrationSchema>;
export type ControlRequest = z.infer<typeof controlRequestSchema>;
export type InstanceControl = { close: () => Promise<void> };

type ControlResponseByType = {
  [Type in keyof typeof controlResponseSchemas]: z.infer<
    (typeof controlResponseSchemas)[Type]
  >;
};

const currentUid = () => {
  if (!process.getuid) {
    throw new Error("Overmux instance control requires a Unix user ID");
  }
  return process.getuid();
};

export const runtimeDirectory = () => {
  const fallback = `/tmp/overmux-${currentUid()}`;
  const preferred = getOvermuxPaths().runtimeDir;
  if (!preferred) {
    return fallback;
  }
  // Leave room for the slash, 16-character ID and .sock on macOS and Linux.
  if (Buffer.byteLength(preferred) <= 80) {
    return preferred;
  }
  const suffix = createHash("sha256")
    .update(preferred)
    .digest("hex")
    .slice(0, 12);
  return `${fallback}-${suffix}`;
};

const secureRuntimeDirectory = async (directory: string) => {
  // Only the final component must not be a symlink: macOS /tmp is a symlink.
  // Validate and chmod the same inode, never a path that could be swapped
  // between checking ownership and changing permissions. The sticky /tmp
  // parent (or user-controlled XDG parent) then protects our owned directory
  // from replacement by other users. Same-user processes are already trusted.
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || metadata.uid !== currentUid()) {
      throw new Error(`Unsafe Overmux runtime directory: ${directory}`);
    }
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
};

const readRegistration = async (path: string) => {
  // An existing directory may have been writable before we secured it. Do not
  // trust planted symlinks, foreign-owned files or publicly writable records.
  // O_NONBLOCK also prevents a planted FIFO from hanging discovery on open.
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== currentUid() ||
      (metadata.mode & 0o077) !== 0
    ) {
      return undefined;
    }
    return registrationSchema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
};

const readNewlineFrame = ({
  maximumBytes,
  socket,
  timeout,
}: {
  maximumBytes: number;
  socket: Socket;
  timeout?: number;
}): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      if (timer) {
        clearTimeout(timer);
      }
    };
    const fail = (cause: Error) => {
      cleanup();
      reject(cause);
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maximumBytes) {
        fail(new Error("Control message is too large"));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) {
        return;
      }
      cleanup();
      resolve(buffer.subarray(0, newline));
    };
    const onEnd = () =>
      fail(new Error("Control socket ended before a complete frame"));
    const onError = (cause: Error) => fail(cause);

    if (socket.errored) {
      fail(socket.errored);
    } else if (socket.readableEnded || socket.destroyed) {
      fail(new Error("Control socket is already closed"));
    } else {
      socket.on("data", onData);
      socket.once("end", onEnd);
      socket.once("error", onError);
      if (timeout !== undefined) {
        timer = setTimeout(() => {
          socket.destroy();
          fail(new Error("Control request timed out"));
        }, timeout);
      }
    }
  });

const writeResponse = (socket: Socket, response: unknown) => {
  socket.end(`${JSON.stringify(response)}\n`);
};

const handleRequest = async ({
  auth,
  instanceId,
  request,
}: {
  auth: AuthService;
  instanceId: string;
  request: ControlRequest;
}) => {
  if (request.type === "get-instance") {
    return { instanceId, ok: true };
  }
  if (request.type === "ping") {
    return { ok: true };
  }
  if (request.type === "create-login") {
    return { login: await auth.createLoginGrant(), ok: true };
  }
  if (request.type === "issue-bearer") {
    return { bearer: await auth.issueLocalBearer(), ok: true };
  }
  if (request.type === "list-sessions") {
    return { ok: true, sessions: await auth.listSessions() };
  }
  if (request.type === "revoke-session") {
    return { ok: true, revoked: await auth.revokeSession(request.id) };
  }
  return { count: await auth.revokeAllSessions(), ok: true };
};

const handleConnection = async ({
  auth,
  instanceId,
  socket,
}: {
  auth: AuthService;
  instanceId: string;
  socket: Socket;
}) => {
  try {
    const frame = await readNewlineFrame({
      maximumBytes: maxControlMessageBytes,
      socket,
    });
    const request = controlRequestSchema.parse(JSON.parse(frame.toString()));
    writeResponse(socket, await handleRequest({ auth, instanceId, request }));
  } catch (cause) {
    writeResponse(socket, {
      error: cause instanceof Error ? cause.message : "Invalid control request",
      ok: false,
    });
  }
};

// Instance control is the private, same-user administration channel for a running
// server. It bootstraps browser login grants and short-lived CLI bearers without
// exposing those privileged operations over HTTP. The owner-only runtime
// directory, registration file, and Unix socket make OS permissions the root of
// trust. This boundary intentionally does not defend against another process
// already running as the same OS user.
export const startInstanceControl = async ({
  auth,
  apiUrl,
  instanceId,
  port,
  url,
}: {
  auth: AuthService;
  apiUrl: string;
  instanceId: string;
  port: number;
  url: string;
}): Promise<InstanceControl> => {
  const directory = runtimeDirectory();
  await mkdir(directory, { mode: 0o700, recursive: true });
  await secureRuntimeDirectory(directory);
  const id = randomBytes(8).toString("hex");
  const socketPath = join(directory, `${id}.sock`);
  const registrationPath = join(directory, `${id}.json`);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    void handleConnection({ auth, instanceId, socket });
  });
  const close = async () => {
    sockets.forEach((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      );
    } finally {
      await Promise.all([
        rm(socketPath, { force: true }),
        rm(registrationPath, { force: true }),
      ]);
    }
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    await chmod(socketPath, 0o600);
    await replacePrivateJsonAtomically(registrationPath, {
      apiUrl,
      controlSocket: socketPath,
      id,
      pid: process.pid,
      port,
      url,
    });
  } catch (cause) {
    await close().catch(() => undefined);
    throw cause;
  }

  return { close };
};

const processIsLive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
};

// Finds the sole responsive local server, optionally filtered by port.
export const discoverInstance = async (
  port?: number,
): Promise<InstanceRegistration> => {
  const directory = runtimeDirectory();
  let names: string[];
  try {
    await secureRuntimeDirectory(directory);
    names = await readdir(directory);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("No running Overmux server was found");
    }
    throw cause;
  }
  const candidates = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) =>
          readRegistration(join(directory, name)).catch(() => undefined),
        ),
    )
  ).filter((registration): registration is InstanceRegistration =>
    Boolean(
      registration &&
      processIsLive(registration.pid) &&
      (port === undefined || registration.port === port),
    ),
  );
  const registrations = (
    await Promise.all(
      candidates.map(async (registration) => {
        try {
          await sendControlRequest(registration, { type: "ping" });
          return registration;
        } catch {
          return undefined;
        }
      }),
    )
  ).filter(
    (registration): registration is InstanceRegistration =>
      registration !== undefined,
  );
  if (registrations.length === 0) {
    throw new Error(
      port === undefined
        ? "No running Overmux server was found"
        : `No running Overmux server was found on port ${port}`,
    );
  }
  if (registrations.length > 1) {
    throw new Error(
      "Multiple Overmux servers are running; use --port to select one",
    );
  }
  return registrations[0]!;
};

export const sendControlRequest = async <Request extends ControlRequest>(
  registration: InstanceRegistration,
  request: Request,
): Promise<ControlResponseByType[Request["type"]]> => {
  const socket = createConnection(registration.controlSocket);
  let frame: Buffer;
  try {
    const response = readNewlineFrame({
      maximumBytes: maxControlMessageBytes,
      socket,
      timeout: 1_000,
    });
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    frame = await response;
  } finally {
    socket.destroy();
  }
  const parsed = controlResponseEnvelopeSchema.safeParse(
    JSON.parse(frame.toString()),
  );
  if (!parsed.success) {
    throw new Error("Invalid control response");
  }
  if (parsed.data.ok !== true) {
    throw new Error(
      typeof parsed.data.error === "string"
        ? parsed.data.error
        : "Control request failed",
    );
  }
  const response = controlResponseSchemas[request.type].safeParse(parsed.data);
  if (!response.success) {
    throw new Error("Invalid control response");
  }
  return response.data as ControlResponseByType[Request["type"]];
};
