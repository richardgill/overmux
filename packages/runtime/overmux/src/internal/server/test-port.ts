// Shared utility for tests that need an ephemeral local port.
import { createServer } from "node:net";

export const findAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a test port"));
        return;
      }
      server.close((cause) => {
        if (cause) {
          reject(cause);
          return;
        }
        resolve(address.port);
      });
    });
  });
