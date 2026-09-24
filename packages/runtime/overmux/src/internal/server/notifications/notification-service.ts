// Orchestrates operation notifications across live and background delivery.
// Provider-specific details stay behind the background-notification service.
import {
  notificationSchema,
  type Notification,
  type Notifications,
} from "../../../public/index";

import { errorDetails, type ServerLogger } from "../server-logger";
import type { BackgroundNotificationService } from "./background-notification-service";

type NotificationService = Notifications & {
  attachLiveDelivery: (deliver: (notification: Notification) => void) => void;
};

const deliverSafely = async ({
  deliver,
  event,
  logger,
}: {
  deliver: () => void | Promise<void>;
  event: string;
  logger?: ServerLogger;
}) => {
  try {
    await deliver();
  } catch (cause) {
    logger?.log({
      details: errorDetails(cause),
      event,
      level: "error",
    });
  }
};

export const createNotificationService = ({
  backgroundNotifications,
  logger,
}: {
  backgroundNotifications: BackgroundNotificationService;
  logger?: ServerLogger;
}): NotificationService => {
  let liveDeliveryAttached = false;
  let deliverLive: (notification: Notification) => void = () => undefined;

  return {
    send: async (input) => {
      const notification = notificationSchema.parse(input);
      await Promise.all([
        deliverSafely({
          deliver: () => deliverLive(notification),
          event: "live-notification-dispatch-failure",
          logger,
        }),
        deliverSafely({
          deliver: () => backgroundNotifications.send(notification),
          event: "background-notification-dispatch-failure",
          logger,
        }),
      ]);
    },
    attachLiveDelivery: (deliver) => {
      if (liveDeliveryAttached) {
        throw new Error("Live delivery is already attached");
      }
      liveDeliveryAttached = true;
      deliverLive = deliver;
    },
  };
};
