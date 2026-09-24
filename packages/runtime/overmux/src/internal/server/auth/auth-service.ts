import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, open, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { durationToMilliseconds } from "@overmux/lib";
import { authDurationSchema } from "@overmux/shared/node";
import { z } from "zod";

import type { AuthConfigDefinition } from "../../../public/config";
import {
  createPrivateJsonExclusively,
  readPrivateJson,
  replacePrivateJsonAtomically,
} from "../notifications/private-json-file";
import { getOvermuxPaths } from "../paths";

// Login grants are brief, single-use browser bootstrap credentials. Local
// bearers last only long enough for a CLI request because the owner-only control
// socket can cheaply issue another without interactive authentication.
const loginGrantLifetimeMs = 10 * 60_000;
const localBearerLifetimeMs = 60_000;
const maxCodeAttempts = 8;
const lastSeenWriteIntervalMs = 60_000;
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const loginGrantSchema = z.object({
  codeHash: z.string(),
  codeLookupHash: z.string(),
  consumedAt: z.string().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  failedCodeAttempts: z.number().int().nonnegative(),
  id: z.string(),
  linkTokenHash: z.string(),
});

const authSessionSchema = z.object({
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  id: z.string(),
  kind: z.enum(["browser", "local"]),
  lastSeenAt: z.string(),
  origin: z.string().optional(),
  revokedAt: z.string().optional(),
  tokenHash: z.string(),
});

const authStoreSchema = z.object({
  grants: z.array(loginGrantSchema),
  installationId: z.string(),
  sessions: z.array(authSessionSchema),
  version: z.literal(1),
});

type AuthStore = z.infer<typeof authStoreSchema>;
type StoredSession = z.infer<typeof authSessionSchema>;

export type AuthSession = Omit<StoredSession, "kind" | "tokenHash">;
export type LoginGrant = {
  code: string;
  expiresAt: string;
  id: string;
  urls: string[];
};
export type LoginResult =
  | { status: "expired" | "invalid" | "rate-limited" }
  | { session: AuthSession; status: "authenticated"; token: string };
export type AuthenticatedSession = {
  expiresAt?: string;
  id: string;
  kind: "browser" | "local";
  origin?: string;
  token: string;
};
// AuthService is transport-neutral and persists grants and sessions across
// server replacement. Opaque credentials are returned once; only their hashes
// and non-secret lifecycle metadata are stored. Every session represents
// authority delegated by the OS user; there are no application users or roles.
export type AuthService = {
  authenticateToken: (
    token: string,
    origin?: string,
  ) => Promise<AuthenticatedSession | undefined>;
  consumeLoginGrant: (input: {
    code?: string;
    origin: string;
    ticket?: string;
  }) => Promise<LoginResult>;
  createLoginGrant: () => Promise<LoginGrant>;
  issueLocalBearer: () => Promise<{ expiresAt: string; token: string }>;
  isSessionActive: (id: string) => Promise<boolean>;
  listSessions: () => Promise<AuthSession[]>;
  onSessionsRevoked: (
    listener: (ids: ReadonlySet<string>) => void,
  ) => () => void;
  revokeAllSessions: () => Promise<number>;
  revokeSession: (id: string) => Promise<boolean>;
  setOrigins: (origins: string[]) => void;
};

const tokenHash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const hashesEqual = (left: string, right: string) => {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const randomToken = () => randomBytes(32).toString("base64url");

const randomCode = () => {
  const bytes = randomBytes(8);
  const characters = Array.from(
    bytes,
    (byte) => codeAlphabet[byte % codeAlphabet.length],
  );
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
};

const durationMilliseconds = (
  duration: Exclude<
    AuthConfigDefinition["sessionLifetime"],
    "forever" | undefined
  >,
) => {
  const milliseconds = durationToMilliseconds(
    authDurationSchema.parse(duration),
  );
  if (milliseconds === undefined) {
    throw new Error("Expected a validated authentication duration");
  }
  return milliseconds;
};

// Old and replacement server processes may overlap, so every read-modify-write
// transaction takes a filesystem lock. This is what makes grant consumption and
// revocation atomic across processes, not only within one AuthService instance.
const acquireStoreLock = async (
  path: string,
  deadline = Date.now() + 5_000,
): Promise<() => Promise<void>> => {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await chmod(dirname(path), 0o700);
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    return () => rm(path, { force: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
      throw cause;
    }
    let lockAge: number;
    try {
      lockAge = Date.now() - (await stat(path)).mtimeMs;
    } catch (statCause) {
      if ((statCause as NodeJS.ErrnoException).code === "ENOENT") {
        return acquireStoreLock(path, deadline);
      }
      throw statCause;
    }
    if (lockAge > 30_000) {
      await rm(path, { force: true });
      return acquireStoreLock(path, deadline);
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the authentication store lock");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return acquireStoreLock(path, deadline);
  }
};

const dataDirectory = ({
  environment,
  homeDirectory,
}: {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
}) =>
  join(
    getOvermuxPaths({ environment, homeDir: homeDirectory }).dataDir,
    "auth",
  );

const publicSession = ({
  kind: _kind,
  tokenHash: _tokenHash,
  ...session
}: StoredSession): AuthSession => session;
const activeSession = (session: StoredSession, now: number) =>
  !session.revokedAt &&
  (session.kind === "local" || Boolean(session.origin)) &&
  (!session.expiresAt || Date.parse(session.expiresAt) > now);

const revokeExpired = (store: AuthStore, currentTime: number) => {
  const expiredIds: string[] = [];
  const sessions = store.sessions.map((session) => {
    if (
      !session.revokedAt &&
      session.expiresAt &&
      Date.parse(session.expiresAt) <= currentTime
    ) {
      expiredIds.push(session.id);
      return { ...session, revokedAt: new Date(currentTime).toISOString() };
    }
    return session;
  });
  return { expiredIds, sessions };
};

const authenticateStoredToken = ({
  currentTime,
  store,
  origin,
  token,
}: {
  currentTime: number;
  origin?: string;
  store: AuthStore;
  token: string;
}) => {
  const { expiredIds, sessions } = revokeExpired(store, currentTime);
  const expectedHash = tokenHash(token);
  const session = sessions.find((candidate) =>
    hashesEqual(candidate.tokenHash, expectedHash),
  );
  const authenticated =
    session &&
    activeSession(session, currentTime) &&
    (session.kind === "local" || session.origin === origin)
      ? {
          ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
          id: session.id,
          kind: session.kind,
          ...(session.origin ? { origin: session.origin } : {}),
          token,
        }
      : undefined;
  const updateLastSeen = Boolean(
    session &&
    authenticated &&
    currentTime - Date.parse(session.lastSeenAt) >= lastSeenWriteIntervalMs,
  );
  const nextSessions = updateLastSeen
    ? sessions.map((candidate) =>
        candidate.id === session?.id
          ? { ...candidate, lastSeenAt: new Date(currentTime).toISOString() }
          : candidate,
      )
    : sessions;
  return { authenticated, expiredIds, nextSessions, updateLastSeen };
};

export const createAuthService = ({
  config,
  environment = process.env,
  homeDirectory = homedir(),
  now = Date.now,
}: {
  config: AuthConfigDefinition;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  now?: () => number;
}): AuthService => {
  const directory = dataDirectory({ environment, homeDirectory });
  const storePath = join(directory, "auth.json");
  const lockPath = join(directory, "auth.lock");
  const listeners = new Set<(ids: ReadonlySet<string>) => void>();
  let origins = config.origins;
  let pendingWrite = Promise.resolve();

  const readStore = async (): Promise<AuthStore> => {
    const existing = await readPrivateJson(storePath, authStoreSchema);
    if (existing) {
      return existing;
    }
    const initial: AuthStore = {
      grants: [],
      installationId: randomUUID(),
      sessions: [],
      version: 1,
    };
    try {
      await createPrivateJsonExclusively(storePath, initial);
      return initial;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
        throw cause;
      }
      const concurrentlyCreated = await readPrivateJson(
        storePath,
        authStoreSchema,
      );
      if (!concurrentlyCreated) {
        throw cause;
      }
      return concurrentlyCreated;
    }
  };

  const updateStore = <T>(
    update: (store: AuthStore) => {
      result: T;
      revokedIds?: string[];
      store?: AuthStore;
    },
  ) => {
    const operation = pendingWrite.then(async () => {
      const release = await acquireStoreLock(lockPath);
      try {
        const current = await readStore();
        const updated = update(current);
        if (updated.store) {
          await replacePrivateJsonAtomically(storePath, updated.store);
        }
        emitRevoked(updated.revokedIds ?? []);
        return updated.result;
      } finally {
        await release();
      }
    });
    pendingWrite = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  // Revocation is the shared lifecycle signal for closing WebSockets and
  // removing session-owned background notification subscriptions.
  const emitRevoked = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    const revoked = new Set(ids);
    listeners.forEach((listener) => listener(revoked));
  };

  const createSession = ({
    kind,
    lifetimeMs,
    origin,
  }: {
    kind: StoredSession["kind"];
    lifetimeMs?: number;
    origin?: string;
  }) => {
    const token = randomToken();
    const createdAt = new Date(now()).toISOString();
    const configuredLifetime =
      config.sessionLifetime && config.sessionLifetime !== "forever"
        ? durationMilliseconds(config.sessionLifetime)
        : undefined;
    const expiresIn = lifetimeMs ?? configuredLifetime;
    const stored: StoredSession = {
      createdAt,
      ...(expiresIn
        ? { expiresAt: new Date(now() + expiresIn).toISOString() }
        : {}),
      id: randomUUID(),
      kind,
      lastSeenAt: createdAt,
      ...(origin ? { origin } : {}),
      tokenHash: tokenHash(token),
    };
    return { stored, token };
  };

  const authenticateToken = async (token: string, origin?: string) => {
    await pendingWrite;
    const currentTime = now();
    const inspected = authenticateStoredToken({
      currentTime,
      origin,
      store: await readStore(),
      token,
    });
    if (inspected.expiredIds.length === 0 && !inspected.updateLastSeen) {
      return inspected.authenticated;
    }
    return updateStore((store) => {
      const current = authenticateStoredToken({
        currentTime: now(),
        origin,
        store,
        token,
      });
      return {
        result: current.authenticated,
        revokedIds: current.expiredIds,
        store: { ...store, sessions: current.nextSessions },
      };
    });
  };

  return {
    authenticateToken,
    consumeLoginGrant: (input) =>
      updateStore<LoginResult>((store) => {
        const currentTime = now();
        const presented = input.code?.trim().toUpperCase() ?? input.ticket;
        if (!presented || Boolean(input.code) === Boolean(input.ticket)) {
          return { result: { status: "invalid" } as const };
        }
        const expectedHash = tokenHash(presented);
        const codeLookupHash = input.code
          ? tokenHash(presented.split("-", 1)[0] ?? "")
          : undefined;
        const exactCodeIndex = store.grants.findIndex((grant) =>
          hashesEqual(grant.codeHash, expectedHash),
        );
        const codeIndex =
          exactCodeIndex >= 0
            ? exactCodeIndex
            : store.grants.findIndex((grant) =>
                hashesEqual(grant.codeLookupHash, codeLookupHash ?? ""),
              );
        const index = input.code
          ? codeIndex
          : store.grants.findIndex((grant) =>
              hashesEqual(grant.linkTokenHash, expectedHash),
            );
        if (index < 0) {
          return { result: { status: "invalid" } as const };
        }
        const grant = store.grants[index]!;
        if (grant.consumedAt) {
          return { result: { status: "invalid" } as const };
        }
        if (Date.parse(grant.expiresAt) <= currentTime) {
          return { result: { status: "expired" } as const };
        }
        if (input.code && grant.failedCodeAttempts >= maxCodeAttempts) {
          return { result: { status: "rate-limited" } as const };
        }
        if (input.code && !hashesEqual(grant.codeHash, expectedHash)) {
          const grants = store.grants.map((candidate, grantIndex) =>
            grantIndex === index
              ? {
                  ...candidate,
                  failedCodeAttempts: candidate.failedCodeAttempts + 1,
                }
              : candidate,
          );
          return {
            result: { status: "invalid" } as const,
            store: { ...store, grants },
          };
        }
        const { stored, token } = createSession({
          kind: "browser",
          origin: input.origin,
        });
        const grants = store.grants.map((candidate, grantIndex) =>
          grantIndex === index
            ? { ...candidate, consumedAt: new Date(currentTime).toISOString() }
            : candidate,
        );
        return {
          result: {
            session: publicSession(stored),
            status: "authenticated",
            token,
          } as const,
          store: {
            ...store,
            grants,
            sessions: [
              ...store.sessions.filter((session) =>
                activeSession(session, currentTime),
              ),
              stored,
            ],
          },
        };
      }),
    createLoginGrant: () =>
      updateStore((store) => {
        if (!origins) {
          throw new Error("The server has not established its browser origins");
        }
        const code = randomCode();
        const ticket = randomToken();
        const createdAt = new Date(now()).toISOString();
        const expiresAt = new Date(now() + loginGrantLifetimeMs).toISOString();
        const id = randomUUID();
        const grant = {
          codeHash: tokenHash(code),
          codeLookupHash: tokenHash(code.split("-", 1)[0]!),
          createdAt,
          expiresAt,
          failedCodeAttempts: 0,
          id,
          linkTokenHash: tokenHash(ticket),
        };
        return {
          result: {
            code,
            expiresAt,
            id,
            urls: origins.map(
              (origin) =>
                `${origin}/login#ticket=${encodeURIComponent(ticket)}`,
            ),
          },
          store: {
            ...store,
            grants: [
              ...store.grants.filter(
                (candidate) =>
                  Date.parse(candidate.expiresAt) > now() &&
                  !candidate.consumedAt,
              ),
              grant,
            ],
          },
        };
      }),
    issueLocalBearer: () =>
      updateStore((store) => {
        const currentTime = now();
        const { stored, token } = createSession({
          kind: "local",
          lifetimeMs: localBearerLifetimeMs,
        });
        return {
          result: { expiresAt: stored.expiresAt!, token },
          store: {
            ...store,
            sessions: [
              ...store.sessions.filter((session) =>
                activeSession(session, currentTime),
              ),
              stored,
            ],
          },
        };
      }),
    isSessionActive: (id) =>
      updateStore((store) => {
        const currentTime = now();
        const { expiredIds, sessions } = revokeExpired(store, currentTime);
        return {
          result: Boolean(
            sessions.find(
              (session) =>
                session.id === id && activeSession(session, currentTime),
            ),
          ),
          revokedIds: expiredIds,
          ...(expiredIds.length > 0 ? { store: { ...store, sessions } } : {}),
        };
      }),
    listSessions: () =>
      updateStore((store) => {
        const currentTime = now();
        const { expiredIds, sessions } = revokeExpired(store, currentTime);
        return {
          result: sessions
            .filter(
              (session) =>
                session.kind === "browser" &&
                activeSession(session, currentTime),
            )
            .map(publicSession),
          revokedIds: expiredIds,
          ...(expiredIds.length > 0 ? { store: { ...store, sessions } } : {}),
        };
      }),
    onSessionsRevoked: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revokeAllSessions: () =>
      updateStore((store) => {
        const currentTime = now();
        const expired = revokeExpired(store, currentTime);
        const ids = expired.sessions
          .filter(
            (session) =>
              session.kind === "browser" && activeSession(session, currentTime),
          )
          .map((session) => session.id);
        const revoked = new Set(ids);
        const revokedAt = new Date(currentTime).toISOString();
        const sessions = expired.sessions.map((session) =>
          revoked.has(session.id) ? { ...session, revokedAt } : session,
        );
        const revokedIds = [...expired.expiredIds, ...ids];
        return {
          result: ids.length,
          revokedIds,
          ...(revokedIds.length > 0 ? { store: { ...store, sessions } } : {}),
        };
      }),
    revokeSession: (id) =>
      updateStore((store) => {
        const session = store.sessions.find(
          (candidate) => candidate.id === id && !candidate.revokedAt,
        );
        if (!session) {
          return { result: false };
        }
        const revokedAt = new Date(now()).toISOString();
        const sessions = store.sessions.map((candidate) =>
          candidate.id === id ? { ...candidate, revokedAt } : candidate,
        );
        return {
          result: true,
          revokedIds: [id],
          store: { ...store, sessions },
        };
      }),
    setOrigins: (nextOrigins) => {
      origins = nextOrigins.map((origin) => new URL(origin).origin);
    },
  };
};
