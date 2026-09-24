// Delivers background notifications through the browser Web Push standard.
// Provider payload, VAPID signing, and expired endpoints remain inside this boundary.
import type { BackgroundNotificationSubscription } from "../../shared/index";
import type { Notification } from "../../../public/index";
import webPush from "web-push";

import { errorDetails, type ServerLogger } from "../server-logger";
import type { BackgroundNotificationStore } from "./background-notification-store";
import { createBackgroundNotificationPayload } from "./background-notification-payload";

const vapidSubject = "https://github.com/richardgill/overmux";

const webPushStatus = (cause: unknown) => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "statusCode" in cause &&
    typeof cause.statusCode === "number"
  ) {
    return cause.statusCode;
  }
  return undefined;
};

const deliverToSubscription = async ({
  keys,
  logger,
  payload,
  sendWebPush,
  store,
  subscription,
}: {
  keys: Awaited<ReturnType<BackgroundNotificationStore["getOrCreateKeys"]>>;
  logger?: ServerLogger;
  payload: string;
  sendWebPush: typeof webPush.sendNotification;
  store: BackgroundNotificationStore;
  subscription: BackgroundNotificationSubscription;
}) => {
  try {
    await sendWebPush(subscription, payload, {
      TTL: 60,
      vapidDetails: {
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        subject: vapidSubject,
      },
    });
  } catch (cause) {
    const status = webPushStatus(cause);
    if (status === 404 || status === 410) {
      await store.removeSubscription(subscription.endpoint);
    }
    logger?.log({
      details: {
        ...errorDetails(cause),
        ...(status ? { status } : {}),
      },
      event: "background-notification-delivery-failure",
      level: "warn",
    });
  }
};

export type BackgroundNotificationService = {
  disable: (endpoint: string) => Promise<void>;
  disableSessions: (sessionIds: ReadonlySet<string>) => Promise<void>;
  enable: (
    sessionId: string,
    subscription: BackgroundNotificationSubscription,
  ) => Promise<void>;
  publicKey: () => Promise<string>;
  send: (notification: Notification) => Promise<void>;
};

export const createBackgroundNotificationService = ({
  isSessionActive = async () => true,
  logger,
  sendWebPush = webPush.sendNotification,
  store,
}: {
  isSessionActive?: (sessionId: string) => Promise<boolean>;
  logger?: ServerLogger;
  sendWebPush?: typeof webPush.sendNotification;
  store: BackgroundNotificationStore;
}): BackgroundNotificationService => {
  let keysPromise:
    | ReturnType<BackgroundNotificationStore["getOrCreateKeys"]>
    | undefined;
  const getKeys = () => {
    if (!keysPromise) {
      keysPromise = store
        .getOrCreateKeys(webPush.generateVAPIDKeys)
        .catch((cause: unknown) => {
          keysPromise = undefined;
          throw cause;
        });
    }
    return keysPromise;
  };

  return {
    disable: (endpoint) => store.removeSubscription(endpoint),
    disableSessions: (sessionIds) =>
      store.removeSessionSubscriptions(sessionIds),
    enable: (sessionId, subscription) =>
      store.upsertSubscription(sessionId, subscription),
    publicKey: async () => (await getKeys()).publicKey,
    send: async (notification) => {
      const storedSubscriptions = await store.listSubscriptions();
      const active = await Promise.all(
        storedSubscriptions.map(async (entry) => ({
          active: await isSessionActive(entry.sessionId),
          entry,
        })),
      );
      const subscriptions = active.flatMap(
        ({ active: sessionActive, entry }) => (sessionActive ? [entry] : []),
      );
      if (!subscriptions.length) {
        return;
      }
      const keys = await getKeys();
      const payload = createBackgroundNotificationPayload(notification);
      await Promise.all(
        subscriptions.map((entry) =>
          deliverToSubscription({
            keys,
            logger,
            payload,
            sendWebPush,
            store,
            subscription: entry.subscription,
          }),
        ),
      );
    },
  };
};
