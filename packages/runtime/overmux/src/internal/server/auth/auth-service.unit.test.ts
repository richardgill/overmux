import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAuthService } from "./auth-service";

const directories: string[] = [];
const origin = "https://overmux.example.com";

const createService = async ({
  lifetime = "forever" as const,
  now,
}: {
  lifetime?: "forever" | "30m";
  now?: () => number;
} = {}) => {
  const dataHome = await mkdtemp(join(tmpdir(), "overmux-auth-"));
  directories.push(dataHome);
  const options = {
    config: { mode: "cli-login" as const, sessionLifetime: lifetime },
    environment: { XDG_DATA_HOME: dataHome },
    homeDirectory: "/unused",
    now,
  };
  const service = createAuthService(options);
  service.setOrigins([origin]);
  return { dataHome, options, service };
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CLI-issued authentication persistence", () => {
  it("stores only hashes and atomically consumes either grant credential", async () => {
    const { dataHome, service } = await createService();
    const login = await service.createLoginGrant();
    const ticket = new URL(login.urls[0]!).hash.slice("#ticket=".length);

    const [first, second] = await Promise.all([
      service.consumeLoginGrant({ code: login.code, origin }),
      service.consumeLoginGrant({ origin, ticket }),
    ]);

    expect([first.status, second.status].sort()).toEqual([
      "authenticated",
      "invalid",
    ]);
    const persisted = await readFile(
      join(dataHome, "overmux", "auth", "auth.json"),
      "utf8",
    );
    expect(persisted).not.toContain(login.code);
    expect(persisted).not.toContain(ticket);
    expect((await stat(join(dataHome, "overmux", "auth"))).mode & 0o777).toBe(
      0o700,
    );
    expect(
      (await stat(join(dataHome, "overmux", "auth", "auth.json"))).mode & 0o777,
    ).toBe(0o600);
  });

  it("creates one origin-agnostic grant whose redemption records one origin", async () => {
    const { service } = await createService();
    const secondaryOrigin = "https://machine.example.com";
    service.setOrigins([origin, secondaryOrigin]);

    const login = await service.createLoginGrant();
    const tickets = login.urls.map((url) =>
      new URL(url).hash.slice("#ticket=".length),
    );
    const authenticated = await service.consumeLoginGrant({
      code: login.code,
      origin: secondaryOrigin,
    });

    expect(login.urls.map((url) => new URL(url).origin)).toEqual([
      origin,
      secondaryOrigin,
    ]);
    expect(new Set(tickets)).toEqual(new Set([tickets[0]]));
    expect(authenticated.status).toBe("authenticated");
    if (authenticated.status !== "authenticated") {
      throw new Error("Expected an authenticated session");
    }
    expect(authenticated.session.origin).toBe(secondaryOrigin);
    expect(
      await service.authenticateToken(authenticated.token, origin),
    ).toBeUndefined();
    expect(
      await service.authenticateToken(authenticated.token, secondaryOrigin),
    ).toBeDefined();
    expect(
      await service.consumeLoginGrant({
        origin,
        ticket: tickets[0],
      }),
    ).toEqual({ status: "invalid" });
  });

  it("serializes concurrent writers from separate service instances", async () => {
    const { options, service } = await createService();
    const concurrent = createAuthService(options);
    concurrent.setOrigins([origin]);

    const [first, second] = await Promise.all([
      service.createLoginGrant(),
      concurrent.createLoginGrant(),
    ]);

    expect(
      (await service.consumeLoginGrant({ code: first.code, origin })).status,
    ).toBe("authenticated");
    expect(
      (await concurrent.consumeLoginGrant({ code: second.code, origin }))
        .status,
    ).toBe("authenticated");
  });

  it("selects an exact code when active grant lookup prefixes collide", async () => {
    const { dataHome, service } = await createService();
    await service.createLoginGrant();
    const second = await service.createLoginGrant();
    const storePath = join(dataHome, "overmux", "auth", "auth.json");
    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      grants: { codeLookupHash: string }[];
    };
    store.grants[1]!.codeLookupHash = store.grants[0]!.codeLookupHash;
    await writeFile(storePath, `${JSON.stringify(store)}\n`, { mode: 0o600 });

    expect(
      (await service.consumeLoginGrant({ code: second.code, origin })).status,
    ).toBe("authenticated");
  });

  it("keeps non-expiring sessions valid across service restarts and revokes them", async () => {
    const { options, service } = await createService();
    const login = await service.createLoginGrant();
    const result = await service.consumeLoginGrant({
      code: login.code,
      origin,
    });
    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") {
      throw new Error("Expected an authenticated session");
    }

    const restarted = createAuthService(options);
    const authenticated = await restarted.authenticateToken(
      result.token,
      origin,
    );
    expect(authenticated).toMatchObject({ id: result.session.id });
    expect(authenticated).not.toHaveProperty("expiresAt");
    expect(await restarted.revokeSession(result.session.id)).toBe(true);
    expect(
      await restarted.authenticateToken(result.token, origin),
    ).toBeUndefined();
  });

  it("revokes all active browser sessions without revoking local bearers", async () => {
    const { service } = await createService();
    const local = await service.issueLocalBearer();
    const login = await service.createLoginGrant();
    const browser = await service.consumeLoginGrant({
      code: login.code,
      origin,
    });
    if (browser.status !== "authenticated") {
      throw new Error("Expected an authenticated browser session");
    }
    const revoked: string[][] = [];
    const removeListener = service.onSessionsRevoked((ids) =>
      revoked.push([...ids]),
    );

    expect(await service.revokeAllSessions()).toBe(1);
    expect(revoked).toEqual([[browser.session.id]]);
    expect(
      await service.authenticateToken(browser.token, origin),
    ).toBeUndefined();
    const localSession = await service.authenticateToken(local.token);
    expect(localSession).toBeDefined();

    removeListener();
    await service.revokeSession(localSession!.id);
    expect(revoked).toHaveLength(1);
  });

  it("uses fixed configured expiry rather than sliding activity", async () => {
    let currentTime = Date.parse("2026-01-01T00:00:00.000Z");
    const { service } = await createService({
      lifetime: "30m",
      now: () => currentTime,
    });
    const login = await service.createLoginGrant();
    const result = await service.consumeLoginGrant({
      code: login.code,
      origin,
    });
    if (result.status !== "authenticated") {
      throw new Error("Expected an authenticated session");
    }
    expect(result.session.expiresAt).toBe("2026-01-01T00:30:00.000Z");

    currentTime += 29 * 60_000;
    expect(await service.authenticateToken(result.token, origin)).toBeDefined();
    currentTime += 2 * 60_000;
    expect(
      await service.authenticateToken(result.token, origin),
    ).toBeUndefined();
  });

  it("limits wrong attempts against a grant code prefix", async () => {
    const { service } = await createService();
    const login = await service.createLoginGrant();
    const prefix = login.code.slice(0, 4);
    const wrongCode = `${prefix}-AAAA`;

    for (const _attempt of Array.from({ length: 8 })) {
      expect(
        (await service.consumeLoginGrant({ code: wrongCode, origin })).status,
      ).toBe("invalid");
    }
    expect(
      (await service.consumeLoginGrant({ code: login.code, origin })).status,
    ).toBe("rate-limited");
  });
});
