import { describe, expect, test } from "vitest";
import {
  getPreviewCleanupVariables,
  getPreviewDeploymentVariables,
  getPreviewUrl,
} from "./github-deployment.ts";

const deploymentEnvironment = {
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "cloudflare-token",
  INPUT_BRANCH: "Feature/Documentation",
  INPUT_PR_NUMBER: "46",
  INPUT_SHA: "abc123",
  PUBLIC_POSTHOG_KEY: "phc_test",
};

describe("GitHub deployment input", () => {
  test("creates preview deployment variables", () => {
    expect(getPreviewDeploymentVariables(deploymentEnvironment)).toEqual({
      DEPLOYMENT_KIND: "preview",
      DEPLOY_MESSAGE: "Deploy PR #46 at abc123",
      GIT_SHA: "abc123",
      PR_BRANCH: "Feature/Documentation",
      PREVIEW_STAGE: "pr-46",
    });
  });

  test("requires the public PostHog key", () => {
    expect(() =>
      getPreviewDeploymentVariables({
        ...deploymentEnvironment,
        PUBLIC_POSTHOG_KEY: undefined,
      }),
    ).toThrow("PUBLIC_POSTHOG_KEY is required");
  });

  test("creates preview cleanup variables", () => {
    expect(
      getPreviewCleanupVariables({
        ...deploymentEnvironment,
        PR_BRANCH: "feature/documentation",
      }),
    ).toEqual({ PREVIEW_STAGE: "pr-46" });
  });

  test("creates the stable branch preview URL", () => {
    expect(
      getPreviewUrl({
        PR_BRANCH: "Feature/Documentation",
        WORKERS_SUBDOMAIN: "example",
      }),
    ).toBe(
      "https://feature-documentation-0d6f6802-overmux-main.example.workers.dev",
    );
  });
});
