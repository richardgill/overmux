import { createHash } from "node:crypto";

const PARENT_WORKER_NAME = "overmux-main";
const DNS_LABEL_LIMIT = 63;
const HASH_LENGTH = 8;
const ALIAS_LIMIT = DNS_LABEL_LIMIT - PARENT_WORKER_NAME.length - 1;
const READABLE_LIMIT = ALIAS_LIMIT - HASH_LENGTH - 1;

export const getPreviewAlias = (branch: string) => {
  const hash = createHash("sha256")
    .update(branch)
    .digest("hex")
    .slice(0, HASH_LENGTH);
  const normalized = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixed = /^[a-z]/.test(normalized)
    ? normalized
    : `branch-${normalized}`;
  const readable =
    prefixed.replace(/-+$/g, "").slice(0, READABLE_LIMIT).replace(/-+$/g, "") ||
    "branch";

  return `${readable}-${hash}`;
};

export const PREVIEW_WORKER_LABEL_LIMIT = DNS_LABEL_LIMIT;
export const PARENT_WORKER = PARENT_WORKER_NAME;
