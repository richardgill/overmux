// Exposes browser controls for enabling and disabling background notifications.
// Subscription details pass directly to the background-delivery boundary.
import {
  backgroundNotificationDisableRequestSchema,
  backgroundNotificationSubscriptionSchema,
} from "../../shared/index";
import type { Handler } from "hono";
import type { z } from "zod";

import type { AuthEnvironment } from "../auth/auth-http";
import type { BackgroundNotificationService } from "../notifications/background-notification-service";

const requestLimit = 16_384;

const parseJson = async <TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema> | undefined> => {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  ) {
    return undefined;
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > requestLimit) {
    return undefined;
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > requestLimit) {
      return undefined;
    }
    const parsed = schema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const createBackgroundNotificationHandlers = ({
  backgroundNotifications,
}: {
  backgroundNotifications: BackgroundNotificationService;
}): {
  disable: Handler<AuthEnvironment>;
  enable: Handler<AuthEnvironment>;
  publicKey: Handler<AuthEnvironment>;
} => ({
  publicKey: async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({
      publicKey: await backgroundNotifications.publicKey(),
    });
  },
  enable: async (context) => {
    const subscription = await parseJson(
      context.req.raw,
      backgroundNotificationSubscriptionSchema,
    );
    if (!subscription) {
      return context.json({ error: "Invalid background subscription" }, 400);
    }
    await backgroundNotifications.enable(
      context.get("session").id,
      subscription,
    );
    return context.json({ ok: true });
  },
  disable: async (context) => {
    const input = await parseJson(
      context.req.raw,
      backgroundNotificationDisableRequestSchema,
    );
    if (!input) {
      return context.json({ error: "Invalid background subscription" }, 400);
    }
    await backgroundNotifications.disable(input.endpoint);
    return context.json({ ok: true });
  },
});
