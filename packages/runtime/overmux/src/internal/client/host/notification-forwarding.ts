import "./desktop-host";
import { notificationEventSchema } from "../../shared/index";

import type { WebSocketTransport } from "../transport";

// Forwards server notifications to the optional desktop host injected at window.overmuxHost.
export const installNotificationForwarding = (transport: WebSocketTransport) =>
  transport.subscribeNotification((event) => {
    const notification = notificationEventSchema.safeParse(event);
    if (notification.success) {
      window.overmuxHost?.notifications?.show(notification.data);
    }
  });
