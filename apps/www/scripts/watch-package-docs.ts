import { isAbsolute, relative } from "node:path";
import type { Plugin } from "vite";
import {
  syncWebsiteDocumentation,
  websiteDocumentationSourceDirectories,
} from "./stage-package-docs.ts";

const debounceMilliseconds = 50;

const isDocumentationSource = (path: string) =>
  websiteDocumentationSourceDirectories.some((directory) => {
    const pathFromDirectory = relative(directory, path);
    return (
      pathFromDirectory === "" ||
      (!isAbsolute(pathFromDirectory) &&
        pathFromDirectory !== ".." &&
        !pathFromDirectory.startsWith("../"))
    );
  });

const formatError = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

export const watchPackageDocumentation = (): Plugin => ({
  name: "overmux-package-documentation",
  configureServer: (server) => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let pendingStage = Promise.resolve();

    const stage = () => {
      pendingStage = pendingStage
        .then(syncWebsiteDocumentation)
        .catch((error: unknown) => {
          server.config.logger.error(
            `Failed to stage package documentation:\n${formatError(error)}`,
          );
        });
    };
    const onChange = (_event: string, path: string) => {
      if (!isDocumentationSource(path)) {
        return;
      }
      clearTimeout(debounce);
      debounce = setTimeout(stage, debounceMilliseconds);
    };
    const stop = () => {
      clearTimeout(debounce);
      server.watcher.off("all", onChange);
    };

    server.watcher.add(websiteDocumentationSourceDirectories);
    server.watcher.on("all", onChange);
    server.httpServer?.once("close", stop);
  },
});
