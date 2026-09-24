import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { init, parse } from "es-module-lexer";
import {
  searchForWorkspaceRoot,
  type InlineConfig,
  type Plugin,
  type UserConfig,
  type ViteDevServer,
} from "vite";

import { viteHmrPath } from "../shared/routes";

type ViteApi = {
  build: (options: { configFile: string; root: string }) => Promise<unknown>;
  createServer: (options: InlineConfig) => Promise<ViteDevServer>;
  loadConfigFromFile: (
    environment: {
      command: "build" | "serve";
      mode: "development" | "production";
    },
    configFile: string,
    configRoot: string,
  ) => Promise<{ config: UserConfig } | null | undefined>;
};

type ManagedVite = {
  close: () => Promise<void>;
  server: ViteDevServer;
  target: string;
};

export const loadViteRoot = async ({
  api,
  command,
  configPath,
}: {
  api: ViteApi;
  command: "build" | "serve";
  configPath: string;
}) => {
  const configRoot = resolve(configPath, "..");
  const mode = command === "build" ? "production" : "development";
  const loaded = await api.loadConfigFromFile(
    { command, mode },
    configPath,
    configRoot,
  );
  return {
    config: loaded?.config ?? {},
    root: resolve(configRoot, loaded?.config.root ?? "."),
  };
};

const conflictingHmrKeys = [
  "clientPort",
  "host",
  "path",
  "port",
  "protocol",
  "server",
] as const;

export const validateViteServerConfig = (config: UserConfig) => {
  const server = config.server;
  const conflict = ["host", "port", "strictPort", "https"].find(
    (key) => server?.[key as keyof typeof server] !== undefined,
  );
  if (conflict) {
    throw new Error(
      `Vite server.${conflict} is managed by \`overmux serve\`; remove it from the Vite config`,
    );
  }
  if (server?.hmr === false) {
    throw new Error(
      "Vite server.hmr cannot be disabled when managed by `overmux serve`",
    );
  }
  const hmr = server?.hmr;
  if (hmr && typeof hmr === "object") {
    const hmrConflict = conflictingHmrKeys.find(
      (key) => hmr[key] !== undefined,
    );
    if (hmrConflict) {
      throw new Error(
        `Vite server.hmr.${hmrConflict} is managed by \`overmux serve\`; remove it from the Vite config`,
      );
    }
  }
};

const validateResolvedViteServer = (server: ViteDevServer) => {
  const config = server.config.server;
  const hmr =
    config.hmr && typeof config.hmr === "object" ? config.hmr : undefined;
  const changedHmrEndpoint = conflictingHmrKeys.some(
    (key) => key !== "path" && hmr?.[key] !== undefined,
  );
  if (
    config.host !== "127.0.0.1" ||
    config.port !== 0 ||
    config.strictPort !== true ||
    config.https ||
    hmr?.path !== viteHmrPath ||
    changedHmrEndpoint
  ) {
    throw new Error(
      "A Vite plugin changed listener or HMR settings managed by `overmux serve`",
    );
  }
};

const pathIsWithin = (root: string, path: string) => {
  const pathFromRoot = relative(root, path);
  return !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
};

const localPath = async (id: string, trustedRoots: string[]) => {
  if (id.includes("\0")) {
    return;
  }
  try {
    const path = await realpath(id.split("?", 1)[0]!);
    if (
      path.includes("node_modules") ||
      !trustedRoots.some((root) => pathIsWithin(root, path))
    ) {
      return;
    }
    return path;
  } catch {
    return;
  }
};

const importsOf = async (path: string) => {
  const source = await readFile(path, "utf8");
  await init;
  try {
    return parse(source)[0];
  } catch {
    return [];
  }
};

const trustedFiles = async ({
  configPath,
  server,
  trustedRoots,
}: {
  configPath: string;
  server: ViteDevServer;
  trustedRoots: string[];
}): Promise<Set<string>> => {
  const files = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (files.has(path)) {
      return;
    }
    files.add(path);
    const imports = await importsOf(path);
    await Promise.all(
      imports.map(async (imported) => {
        if (!imported.n) {
          return;
        }
        const resolved = await server.pluginContainer.resolveId(
          imported.n,
          path,
        );
        const id = typeof resolved === "string" ? resolved : resolved?.id;
        const importedPath = id ? await localPath(id, trustedRoots) : undefined;
        if (importedPath) {
          await visit(importedPath);
        }
      }),
    );
  };
  await visit(configPath);
  return files;
};

// Watch overmux.config.ts and its imports because Vite only watches browser code.
// Changes notify Overmux that its trusted server code needs reloading.
export const watchTrustedFiles = async ({
  configPath,
  onUpdate,
  server,
}: {
  configPath: string;
  onUpdate: () => void;
  server: ViteDevServer;
}) => {
  const logicalApplicationRoot = resolve(configPath, "..");
  const [applicationRoot, workspaceRoot] = await Promise.all([
    realpath(logicalApplicationRoot),
    realpath(searchForWorkspaceRoot(logicalApplicationRoot)),
  ]);
  let files = new Set<string>();
  const refresh = async () => {
    files = await trustedFiles({
      configPath: await realpath(configPath),
      server,
      trustedRoots: [applicationRoot, workspaceRoot],
    });
    server.watcher.add([...files]);
  };
  await refresh();
  const changed = (path: string) => {
    if (files.has(path)) {
      void refresh().then(onUpdate);
    }
  };
  server.watcher.on("change", changed);
  return () => {
    server.watcher.off("change", changed);
  };
};

// Android HMR connections were observed closing after ~60s without incoming data,
// triggering Vite's reconnect reload. Vite's heartbeat only sends browser -> server.
// Harmless server -> browser custom events keep HMR alive without disabling updates.
const hmrHeartbeatPlugin = (): Plugin => ({
  name: "overmux:hmr-heartbeat",
  apply: "serve",
  configureServer(server) {
    server.httpServer?.once("listening", () => {
      const heartbeat = setInterval(() => {
        server.ws.send("overmux:heartbeat", {});
      }, 20_000);
      heartbeat.unref();
      // One timer per server, not per socket; Vite restarts get a fresh timer.
      server.httpServer?.once("close", () => clearInterval(heartbeat));
    });
  },
});

export const startManagedVite = async ({
  api,
  configPath,
}: {
  api: ViteApi;
  configPath: string;
}): Promise<ManagedVite> => {
  const { config, root } = await loadViteRoot({
    api,
    command: "serve",
    configPath,
  });
  validateViteServerConfig(config);
  const allowedRoots = [
    ...(config.server?.fs?.allow ?? []),
    root,
    await realpath(root),
    searchForWorkspaceRoot(root),
  ];
  const server = await api.createServer({
    configFile: configPath,
    root,
    // Vite merges inline plugins with the user's vite.config plugins; it doesn't replace them.
    plugins: [hmrHeartbeatPlugin()],
    server: {
      fs: { allow: [...new Set(allowedRoots)] },
      hmr: { path: viteHmrPath },
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
    },
  });
  try {
    validateResolvedViteServer(server);
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("Private Vite server did not bind a TCP address");
    }
    return {
      close: () => server.close(),
      server,
      target: `http://127.0.0.1:${address.port}`,
    };
  } catch (cause) {
    await server.close();
    throw cause;
  }
};

export type { ViteApi };
