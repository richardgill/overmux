import { notificationLinkSchema } from "@overmux/shared";
import { notificationEventSchema } from "../shared/protocol";
import {
  pushNotificationBadgePath,
  pushNotificationIconPath,
} from "../shared/routes";

// Only the worker APIs this push-only entry uses. No fetch handler or offline shell.
type WorkerClient = {
  url: string;
  focus: () => Promise<WorkerClient>;
  navigate: (url: string) => Promise<WorkerClient | null>;
};
type LifetimeEvent = { waitUntil: (work: Promise<unknown>) => void };
type WorkerEvents = {
  install: LifetimeEvent;
  push: LifetimeEvent & { data?: { json: () => unknown } };
  notificationclick: LifetimeEvent & {
    notification: { close: () => void; data?: { link?: unknown } };
  };
};
const worker = globalThis as unknown as {
  addEventListener: <Type extends keyof WorkerEvents>(
    type: Type,
    listener: (event: WorkerEvents[Type]) => void,
  ) => void;
  clients: {
    matchAll: (options: {
      includeUncontrolled: boolean;
      type: "window";
    }) => Promise<WorkerClient[]>;
    openWindow: (url: string) => Promise<WorkerClient | null>;
  };
  location: Location;
  registration: {
    showNotification: (
      title: string,
      options: NotificationOptions,
    ) => Promise<void>;
  };
  skipWaiting: () => Promise<void>;
};

const notificationDestination = (link: unknown) => {
  const parsed = notificationLinkSchema.safeParse(link);
  if (!parsed.success) {
    return undefined;
  }
  const destination = new URL(parsed.data, worker.location.origin);
  // Notification links support relative paths and HTTP URLs, but background clicks
  // must never send an authenticated PWA window to another origin.
  return destination.origin === worker.location.origin
    ? destination.href
    : undefined;
};

const focusOrOpen = async (link: unknown) => {
  const destination = notificationDestination(link);
  const clients = await worker.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  const client =
    clients.find((candidate) => candidate.url === destination) ??
    clients.find(
      (candidate) => new URL(candidate.url).origin === worker.location.origin,
    );
  if (!client) {
    await worker.clients.openWindow(
      destination ?? new URL("/", worker.location.origin).href,
    );
    return;
  }
  // Without a safe link, preserve the user's current route. A disappearing client
  // can return null from navigate; open a fresh window rather than lose the click.
  const navigated =
    destination && client.url !== destination
      ? await client.navigate(destination)
      : client;
  if (navigated) {
    await navigated.focus();
  } else {
    await worker.clients.openWindow(destination!);
  }
};

worker.addEventListener("install", (event) => {
  // This worker owns no caches or page traffic, so replacing it need not wait for tabs.
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("push", (event) => {
  let input: unknown;
  try {
    input = event.data?.json();
  } catch {
    return;
  }
  const payload = notificationEventSchema.safeParse(input);
  if (!payload.success) {
    return;
  }
  const { notification } = payload.data;
  event.waitUntil(
    worker.registration.showNotification(notification.title, {
      body: notification.body,
      // Bypass cached transparent icons after adding the light background.
      icon: `${pushNotificationIconPath}?v=2`,
      badge: pushNotificationBadgePath,
      data: { link: notification.open?.link },
    }),
  );
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpen(event.notification.data?.link));
});
