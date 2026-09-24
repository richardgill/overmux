// Validates browser subscription data exchanged by background-notification delivery.
// Browser-standard key and endpoint details stay behind this internal boundary.
import { z } from "zod";

const deliveryKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[\w-]+$/u);

export const backgroundNotificationSubscriptionSchema = z
  .object({
    endpoint: z
      .url()
      .max(4_096)
      .refine((endpoint) => {
        const url = new URL(endpoint);
        return url.protocol === "https:" && !url.username && !url.password;
      }),
    expirationTime: z.number().int().nonnegative().nullable(),
    keys: z
      .object({ auth: deliveryKeySchema, p256dh: deliveryKeySchema })
      .strict(),
  })
  .strict();

export const backgroundNotificationPublicKeyResponseSchema = z
  .object({ publicKey: deliveryKeySchema })
  .strict();

export const backgroundNotificationDisableRequestSchema = z
  .object({ endpoint: backgroundNotificationSubscriptionSchema.shape.endpoint })
  .strict();

export type BackgroundNotificationSubscription = z.infer<
  typeof backgroundNotificationSubscriptionSchema
>;
