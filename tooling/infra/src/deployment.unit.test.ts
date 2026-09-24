import { describe, expect, test } from "vitest";
import { getDeploymentInput } from "./deployment.js";

describe("getDeploymentInput", () => {
  test("defaults to a local deployment", () => {
    expect(getDeploymentInput({})).toMatchObject({
      environment: "local",
      gitSha: "local",
      kind: "local",
    });
  });

  test("targets the production domain for main deployments", () => {
    expect(
      getDeploymentInput({ DEPLOYMENT_KIND: "main", GIT_SHA: "abc123" }),
    ).toMatchObject({
      domain: "overmux.com",
      environment: "main",
      kind: "main",
    });
  });

  test("builds a preview input with a safe branch alias", () => {
    expect(
      getDeploymentInput({
        DEPLOYMENT_KIND: "preview",
        GIT_SHA: "abc123",
        PR_BRANCH: "Feature/Docs",
      }),
    ).toMatchObject({
      environment: "preview",
      gitSha: "abc123",
      kind: "preview",
      previewAlias: expect.stringMatching(/^feature-docs-[a-f0-9]{8}$/),
    });
  });

  test("requires metadata for remote deployments", () => {
    expect(() => getDeploymentInput({ DEPLOYMENT_KIND: "main" })).toThrow(
      "GIT_SHA",
    );
    expect(() =>
      getDeploymentInput({ DEPLOYMENT_KIND: "preview", GIT_SHA: "abc123" }),
    ).toThrow("PR_BRANCH");
  });
});
