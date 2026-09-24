// Runtime manifest responses must not be stored by client caches.
import type { Handler } from "hono";

import type { AuthEnvironment } from "../auth/auth-http";
import type { Runtime } from "../runtime/create-runtime";

export const createRuntimeManifestHandler =
  ({ runtime }: { runtime: Runtime }): Handler<AuthEnvironment> =>
  (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(runtime.manifest);
  };
