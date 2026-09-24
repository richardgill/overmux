// Owns the coordinator's broad recursive watch of the config directory.
// Filtering and debounce keep update signaling independent of import analysis.

import { watch } from "node:fs";
import { dirname } from "node:path";

export type UpdateWatcher = {
  close: () => void;
};

export const isRelevantUpdatePath = (path: string): boolean => {
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => segment.toLowerCase() === "node_modules")) {
    return false;
  }
  return /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|json|css)$/i.test(path);
};

export const startUpdateWatcher = ({
  configPath,
  onUpdate,
}: {
  configPath: string;
  onUpdate: () => void;
}): UpdateWatcher => {
  let closed = false;
  let timeout: NodeJS.Timeout | undefined;
  const watcher = watch(
    dirname(configPath),
    { recursive: true },
    (_event, fileName) => {
      if (closed || !fileName || !isRelevantUpdatePath(fileName.toString())) {
        return;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(onUpdate, 100);
    },
  );

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      watcher.close();
    },
  };
};
