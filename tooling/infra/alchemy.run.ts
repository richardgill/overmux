import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PARENT_WORKER } from "./src/branch-preview.ts";
import { getDeploymentInput } from "./src/deployment.ts";

const deployment = getDeploymentInput();
const publicPosthogKey =
  deployment.kind === "local" || process.env.DESTROYING === "true"
    ? "unused-local-key"
    : process.env.PUBLIC_POSTHOG_KEY;
if (!publicPosthogKey) {
  throw new Error("PUBLIC_POSTHOG_KEY is required for remote deployments");
}
const workerEnv = {
  ENVIRONMENT: deployment.environment,
  GIT_SHA: deployment.gitSha,
  POSTHOG_LOGS_ENDPOINT: deployment.logsEndpoint,
  PUBLIC_POSTHOG_KEY: publicPosthogKey,
  SERVICE_NAME: "overmux-www",
  VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
};
const Worker = Cloudflare.Worker as typeof Cloudflare.Worker & {
  ref: (
    id: string,
    options: { stage: string },
  ) => Effect.Effect<Cloudflare.Workers.Worker>;
};
// Alchemy beta.74 treats built-in Vite as parent-level; source keeps it version-level.
const viteSource = {
  devMode: "bundle" as const,
  options: { rootDir: "../../apps/www" },
  provider: import.meta.resolve("./src/vite-worker-source.ts"),
  rootDir: "../../apps/www",
};

export default Alchemy.Stack(
  "OvermuxWWW",
  {
    providers: Cloudflare.providers(),
    state:
      deployment.kind === "local" ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    if (deployment.kind === "preview") {
      const parent = yield* Worker.ref("WWW", { stage: "main" });
      const website = yield* Cloudflare.Worker("WWW", {
        env: workerEnv,
        source: viteSource,
        version: {
          alias: deployment.previewAlias,
          message: deployment.message,
          parent,
          tag: deployment.gitSha,
          traffic: 0,
        },
      });
      return { url: website.url, versionId: website.versionId };
    }

    const website = yield* Cloudflare.Website.Vite("WWW", {
      rootDir: "../../apps/www",
      domain: deployment.kind === "main" ? deployment.domain : undefined,
      env: workerEnv,
      name: PARENT_WORKER,
      version: { message: deployment.message, tag: deployment.gitSha },
      workersDev: true,
    });
    return { url: website.url, versionId: website.versionId };
  }),
);
