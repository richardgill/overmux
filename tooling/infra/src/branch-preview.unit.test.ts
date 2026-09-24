import { describe, expect, it, test as testCases } from "vitest";
import {
  getPreviewAlias,
  PARENT_WORKER,
  PREVIEW_WORKER_LABEL_LIMIT,
} from "./branch-preview.js";

const normalizationCases = [
  {
    branch: "feature/docs-navigation",
    pattern: /^feature-docs-navigation-[a-f0-9]{8}$/,
  },
  {
    branch: "Feature///DOCS___Navigation",
    pattern: /^feature-docs-navigation-[a-f0-9]{8}$/,
  },
  { branch: "123-deploy", pattern: /^branch-123-deploy-[a-f0-9]{8}$/ },
  { branch: "文档!!!", pattern: /^branch-[a-f0-9]{8}$/ },
];

describe("getPreviewAlias", () => {
  testCases.each(normalizationCases)(
    "normalizes $branch",
    ({ branch, pattern }) => {
      expect(getPreviewAlias(branch)).toMatch(pattern);
    },
  );

  it("is stable and fits the full Cloudflare DNS label", () => {
    const branch = `feature/${"very-long-name-".repeat(12)}`;
    const alias = getPreviewAlias(branch);

    expect(getPreviewAlias(branch)).toBe(alias);
    expect(`${alias}-${PARENT_WORKER}`).toHaveLength(
      PREVIEW_WORKER_LABEL_LIMIT,
    );
  });

  it("keeps colliding truncated prefixes distinct", () => {
    const prefix = `feature/${"same-prefix-".repeat(12)}`;

    expect(getPreviewAlias(`${prefix}one`)).not.toBe(
      getPreviewAlias(`${prefix}two`),
    );
  });
});
