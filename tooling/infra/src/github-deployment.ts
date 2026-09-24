import { appendFile } from "node:fs/promises";
import { getPreviewAlias } from "./branch-preview.ts";
import { PRODUCTION_DOMAIN } from "./deployment.ts";

type Environment = Record<string, string | undefined>;
type Variables = Record<string, string>;

const mainUrl = `https://${PRODUCTION_DOMAIN}`;

const required = (environment: Environment, name: string) => {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const validateCloudflareEnvironment = (environment: Environment) => {
  required(environment, "CLOUDFLARE_ACCOUNT_ID");
  required(environment, "CLOUDFLARE_API_TOKEN");
};

const validateDeploymentEnvironment = (environment: Environment) => {
  validateCloudflareEnvironment(environment);
  required(environment, "PUBLIC_POSTHOG_KEY");
};

export const getPreviewDeploymentVariables = (
  environment: Environment,
): Variables => {
  validateDeploymentEnvironment(environment);
  const branch = required(environment, "INPUT_BRANCH");
  const prNumber = required(environment, "INPUT_PR_NUMBER");
  const gitSha = required(environment, "INPUT_SHA");
  return {
    DEPLOYMENT_KIND: "preview",
    DEPLOY_MESSAGE: `Deploy PR #${prNumber} at ${gitSha}`,
    GIT_SHA: gitSha,
    PR_BRANCH: branch,
    PREVIEW_STAGE: `pr-${prNumber}`,
  };
};

export const getPreviewCleanupVariables = (
  environment: Environment,
): Variables => {
  validateCloudflareEnvironment(environment);
  required(environment, "PR_BRANCH");
  const prNumber = required(environment, "INPUT_PR_NUMBER");
  return { PREVIEW_STAGE: `pr-${prNumber}` };
};

export const getPreviewUrl = (environment: Environment) => {
  const branch = required(environment, "PR_BRANCH");
  const subdomain = required(environment, "WORKERS_SUBDOMAIN");
  return `https://${getPreviewAlias(branch)}-overmux-main.${subdomain}.workers.dev`;
};

const appendVariables = async (environment: Environment, values: Variables) => {
  const path = required(environment, "GITHUB_ENV");
  const content = Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  await appendFile(path, `${content}\n`);
};

const appendOutput = async (
  environment: Environment,
  name: string,
  value: string,
) => {
  await appendFile(
    required(environment, "GITHUB_OUTPUT"),
    `${name}=${value}\n`,
  );
};

const appendSummary = async (environment: Environment, summary: string) => {
  await appendFile(
    required(environment, "GITHUB_STEP_SUMMARY"),
    `${summary}\n`,
  );
};

const prepareMain = async (environment: Environment) => {
  validateDeploymentEnvironment(environment);
};

const preparePreview = async (environment: Environment) => {
  await appendVariables(
    environment,
    getPreviewDeploymentVariables(environment),
  );
};

const prepareCleanup = async (environment: Environment) => {
  await appendVariables(environment, getPreviewCleanupVariables(environment));
};

const publishMain = async (environment: Environment) => {
  await appendSummary(environment, `### Deployed ${mainUrl}`);
};

const publishPreview = async (environment: Environment) => {
  const url = getPreviewUrl(environment);
  await appendOutput(environment, "url", url);
  await appendSummary(environment, `### Preview: ${url}`);
};

const commands: Record<string, (environment: Environment) => Promise<void>> = {
  "prepare-cleanup": prepareCleanup,
  "prepare-main": prepareMain,
  "prepare-preview": preparePreview,
  "publish-main": publishMain,
  "publish-preview": publishPreview,
};

const run = async () => {
  const commandName = process.argv[2] ?? "";
  const command = commands[commandName];
  if (!command) {
    throw new Error(`Unknown GitHub deployment command: ${commandName}`);
  }
  await command(process.env);
};

if (import.meta.main) {
  await run();
}
