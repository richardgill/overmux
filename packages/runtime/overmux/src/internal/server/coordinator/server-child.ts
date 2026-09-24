// Executable entry for one fresh application-server child process.
// It translates lifecycle IPC only and never retains state across restarts.

import { startApplicationServer } from "../start-application-server";
import { errorMessage } from "../server-logger";
import { parseParentMessage, type ChildToParentMessage } from "./ipc-protocol";

const send = (message: ChildToParentMessage) => {
  if (!process.connected) {
    return;
  }
  try {
    process.send?.(message, () => undefined);
  } catch {}
};

const disconnect = () => {
  if (!process.connected) {
    return;
  }
  try {
    process.disconnect();
  } catch {}
};

const runServerChild = () => {
  let serverPromise: ReturnType<typeof startApplicationServer> | undefined;
  let closing: Promise<void> | undefined;

  const close = () => {
    if (closing) {
      return closing;
    }
    closing =
      serverPromise?.then(
        (server) => server.close(),
        () => undefined,
      ) ?? Promise.resolve();
    return closing;
  };

  process.on("message", (raw) => {
    let message;
    try {
      message = parseParentMessage(raw);
    } catch (cause) {
      send({ message: errorMessage(cause), type: "startup-failed" });
      return;
    }
    if (message.type === "update-available") {
      if (!closing) {
        void serverPromise?.then(
          (server) => server.announceUpdateAvailable(),
          () => undefined,
        );
      }
      return;
    }
    if (message.type === "stop") {
      void close()
        .catch((cause: unknown) => {
          process.stderr.write(
            `[overmux] child shutdown failed: ${errorMessage(cause)}\n`,
          );
        })
        .finally(disconnect);
      return;
    }
    if (serverPromise || closing) {
      send({
        message: "Server child received more than one start request",
        type: "startup-failed",
      });
      return;
    }
    serverPromise = startApplicationServer({
      onRestartRequested: () => send({ type: "restart-requested" }),
      options: message.options,
    });
    void serverPromise
      .then((server) => {
        if (closing) {
          return;
        }
        send({
          host: server.host,
          port: server.port,
          type: "ready",
          url: server.url,
          watch: server.watch,
        });
      })
      .catch((cause: unknown) => {
        send({ message: errorMessage(cause), type: "startup-failed" });
        disconnect();
      });
  });

  process.once("disconnect", () => {
    void close().catch((cause: unknown) => {
      process.stderr.write(
        `[overmux] disconnected child shutdown failed: ${errorMessage(cause)}\n`,
      );
    });
  });
};

runServerChild();
