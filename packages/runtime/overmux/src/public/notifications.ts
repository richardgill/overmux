// Defines notifications shared by operation handlers and delivery transports.
// Keeping validation here gives every delivery path one public contract.
import type { Notification } from "@overmux/shared";

export { notificationLinkSchema, notificationSchema } from "@overmux/shared";
export type { Notification } from "@overmux/shared";

export type Notifications = {
  send: (notification: Notification) => Promise<void>;
};
