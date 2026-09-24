// Provides the browser API and controls for background notifications.
// Browser PushManager details remain inside this delivery boundary.
import {
  backgroundNotificationPublicKeyResponseSchema,
  backgroundNotificationSubscriptionSchema,
} from "../shared/index";

const enabledStorageKey = "overmux.backgroundNotificationsEnabled";

export type BackgroundNotificationStatus =
  | "checking"
  | "denied"
  | "disabled"
  | "enabled"
  | "error"
  | "ios-home-screen"
  | "unsupported";

const isIos = () =>
  /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const supportStatus = (): BackgroundNotificationStatus | undefined => {
  if (window.overmuxHost?.notifications) {
    return "unsupported";
  }
  if (isIos() && !isStandalone()) {
    return "ios-home-screen";
  }
  if (
    !window.isSecureContext ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "unsupported";
  }
  return undefined;
};

const decodeApplicationServerKey = (value: string) => {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Uint8Array.from(
    atob(padded.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );
};

const encodeApplicationServerKey = (value: ArrayBuffer | null) => {
  if (!value) {
    return undefined;
  }
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(
      `Background notification request failed: ${response.status}`,
    );
  }
  return response;
};

const getPublicKey = async () => {
  const response = await request("/api/background-notifications/public-key");
  return backgroundNotificationPublicKeyResponseSchema.parse(
    await response.json(),
  ).publicKey;
};

const serializeSubscription = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  return backgroundNotificationSubscriptionSchema.parse({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: json.keys,
  });
};

const enableSubscription = async (subscription: PushSubscription) => {
  await request("/api/background-notifications/subscription", {
    body: JSON.stringify(serializeSubscription(subscription)),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
};

const disableSubscription = async (subscription: PushSubscription) => {
  await request("/api/background-notifications/subscription", {
    body: JSON.stringify({ endpoint: subscription.endpoint }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });
};

const subscribe = async (
  registration: ServiceWorkerRegistration,
  publicKey: string,
) =>
  registration.pushManager.subscribe({
    applicationServerKey: decodeApplicationServerKey(publicKey),
    userVisibleOnly: true,
  });

const canManageSubscription = () =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

const removeCurrentSubscription = async () => {
  if (!canManageSubscription()) {
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  await disableSubscription(subscription);
  if (!(await subscription.unsubscribe())) {
    throw new Error("The background subscription could not be removed");
  }
};

const reconcileBackgroundNotifications = async () => {
  const registration = await navigator.serviceWorker.ready;
  const publicKey = await getPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  const subscriptionKey = subscription
    ? encodeApplicationServerKey(subscription.options.applicationServerKey)
    : undefined;
  if (subscription && subscriptionKey !== publicKey) {
    await disableSubscription(subscription);
    if (!(await subscription.unsubscribe())) {
      throw new Error("The previous background subscription is still active");
    }
    subscription = null;
  }
  if (!subscription) {
    subscription = await subscribe(registration, publicKey);
  }
  await enableSubscription(subscription);
};

export const enableBackgroundNotifications = async () => {
  if (supportStatus()) {
    localStorage.removeItem(enabledStorageKey);
    return false;
  }
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") {
    localStorage.removeItem(enabledStorageKey);
    return false;
  }
  await reconcileBackgroundNotifications();
  localStorage.setItem(enabledStorageKey, "true");
  return true;
};

export const disableBackgroundNotifications = async () => {
  localStorage.removeItem(enabledStorageKey);
  await removeCurrentSubscription();
};

export const reconciledStatus =
  async (): Promise<BackgroundNotificationStatus> => {
    const unavailable = supportStatus();
    if (unavailable) {
      await disableBackgroundNotifications().catch(() => undefined);
      return unavailable;
    }
    if (Notification.permission !== "granted") {
      await disableBackgroundNotifications().catch(() => undefined);
      return Notification.permission === "denied" ? "denied" : "disabled";
    }
    if (localStorage.getItem(enabledStorageKey) !== "true") {
      await disableBackgroundNotifications();
      return "disabled";
    }
    await reconcileBackgroundNotifications();
    return "enabled";
  };
