import { z } from "zod";
import { getPreviewAlias } from "./branch-preview.ts";

export const PRODUCTION_DOMAIN = "overmux.com";

const logsEndpointDefault = "https://eu.i.posthog.com/i/v1/logs";
const inputSchema = z
  .object({
    DEPLOYMENT_KIND: z.enum(["local", "main", "preview"]).default("local"),
    DEPLOY_MESSAGE: z.string().optional(),
    GIT_SHA: z.string().min(1).optional(),
    POSTHOG_LOGS_ENDPOINT: z.url().default(logsEndpointDefault),
    PR_BRANCH: z.string().min(1).optional(),
  })
  .strict();

type DeploymentInput =
  | {
      kind: "local";
      environment: "local";
      gitSha: string;
      logsEndpoint: string;
      message: string;
    }
  | {
      kind: "main";
      domain: typeof PRODUCTION_DOMAIN;
      environment: "main";
      gitSha: string;
      logsEndpoint: string;
      message: string;
    }
  | {
      kind: "preview";
      environment: "preview";
      gitSha: string;
      logsEndpoint: string;
      message: string;
      previewAlias: string;
    };

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`${name} is required for remote deployments`);
  }
  return value;
};

export const getDeploymentInput = (
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentInput => {
  const input = inputSchema.parse({
    DEPLOYMENT_KIND: environment.DEPLOYMENT_KIND,
    DEPLOY_MESSAGE: environment.DEPLOY_MESSAGE,
    GIT_SHA: environment.GIT_SHA,
    POSTHOG_LOGS_ENDPOINT: environment.POSTHOG_LOGS_ENDPOINT,
    PR_BRANCH: environment.PR_BRANCH,
  });
  const message =
    input.DEPLOY_MESSAGE ?? `Overmux WWW ${input.DEPLOYMENT_KIND} deployment`;

  if (input.DEPLOYMENT_KIND === "local") {
    return {
      kind: "local",
      environment: "local",
      gitSha: input.GIT_SHA ?? "local",
      logsEndpoint: input.POSTHOG_LOGS_ENDPOINT,
      message,
    };
  }

  const gitSha = required(input.GIT_SHA, "GIT_SHA");
  if (input.DEPLOYMENT_KIND === "main") {
    return {
      kind: "main",
      domain: PRODUCTION_DOMAIN,
      environment: "main",
      gitSha,
      logsEndpoint: input.POSTHOG_LOGS_ENDPOINT,
      message,
    };
  }

  const branch = required(input.PR_BRANCH, "PR_BRANCH");
  return {
    kind: "preview",
    environment: "preview",
    gitSha,
    logsEndpoint: input.POSTHOG_LOGS_ENDPOINT,
    message,
    previewAlias: getPreviewAlias(branch),
  };
};
