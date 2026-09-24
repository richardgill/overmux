import { z } from "zod";

export const instanceIdSchema = z
  .string()
  .max(253)
  .regex(
    // Match the absolute end, not `$`, which also accepts a final newline.
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?![\s\S])/,
    "Expected a lowercase instance ID with only ASCII letters, digits, internal dots and hyphens",
  );

export type InstanceIdentity = {
  instanceId: string;
  deepLinkPrefix: string;
};

export const createInstanceIdentity = (
  instanceId: string,
): InstanceIdentity => ({
  instanceId: instanceIdSchema.parse(instanceId),
  deepLinkPrefix: `overmux://${instanceId}`,
});
