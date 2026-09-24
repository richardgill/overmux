// Fits background notification payloads within the Web Push provider limit.
// Input is validated by the notification service before this internal boundary.
import type { Notification } from "../../../public/index";

const maxPayloadBytes = 3_800;

const payloadBytes = (payload: unknown) =>
  new TextEncoder().encode(JSON.stringify(payload)).byteLength;

const largestFittingPrefix = (
  characters: string[],
  accepts: (prefix: string) => boolean,
  low = 0,
  high = characters.length,
): string => {
  if (low >= high) {
    return characters.slice(0, low).join("");
  }
  const middle = Math.ceil((low + high) / 2);
  return accepts(characters.slice(0, middle).join(""))
    ? largestFittingPrefix(characters, accepts, middle, high)
    : largestFittingPrefix(characters, accepts, low, middle - 1);
};

const notificationPayload = (notification: Notification) => ({
  notification,
  type: "notification" as const,
});

export const createBackgroundNotificationPayload = (
  notification: Notification,
) => {
  const original = notificationPayload(notification);
  if (payloadBytes(original) <= maxPayloadBytes) {
    return JSON.stringify(original);
  }

  const withoutBody = { ...notification, body: undefined };
  const body = largestFittingPrefix(
    [...(notification.body ?? "")],
    (prefix) =>
      payloadBytes(
        notificationPayload({
          ...withoutBody,
          ...(prefix ? { body: prefix } : {}),
        }),
      ) <= maxPayloadBytes,
  );
  const bodyTruncated = notificationPayload({
    ...withoutBody,
    ...(body ? { body } : {}),
  });
  if (payloadBytes(bodyTruncated) <= maxPayloadBytes) {
    return JSON.stringify(bodyTruncated);
  }

  const title = largestFittingPrefix(
    [...notification.title],
    (prefix) =>
      Boolean(prefix) &&
      payloadBytes(notificationPayload({ ...withoutBody, title: prefix })) <=
        maxPayloadBytes,
  );
  if (title) {
    return JSON.stringify(notificationPayload({ ...withoutBody, title }));
  }
  const safeTitle = largestFittingPrefix(
    [...notification.title],
    (prefix) =>
      Boolean(prefix) &&
      payloadBytes(notificationPayload({ title: prefix })) <= maxPayloadBytes,
  );
  return JSON.stringify(notificationPayload({ title: safeTitle || "Overmux" }));
};
