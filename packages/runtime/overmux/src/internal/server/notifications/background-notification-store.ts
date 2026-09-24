// Defines replaceable persistence for background-notification keys and subscriptions.
// The file implementation owns the required XDG data location and atomic updates.
import {
  backgroundNotificationSubscriptionSchema,
  type BackgroundNotificationSubscription,
} from "../../shared/index";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { getOvermuxPaths } from "../paths";
import {
  createPrivateJsonExclusively,
  readPrivateJson,
  replacePrivateJsonAtomically,
} from "./private-json-file";

const vapidKeysSchema = z
  .object({ privateKey: z.string().min(1), publicKey: z.string().min(1) })
  .strict();
const storedSubscriptionSchema = z.object({
  sessionId: z.string(),
  subscription: backgroundNotificationSubscriptionSchema,
});
const subscriptionsSchema = z.array(storedSubscriptionSchema);

type VapidKeys = z.infer<typeof vapidKeysSchema>;
export type StoredBackgroundNotificationSubscription = z.infer<
  typeof storedSubscriptionSchema
>;

export type BackgroundNotificationStore = {
  getOrCreateKeys: (generate: () => VapidKeys) => Promise<VapidKeys>;
  listSubscriptions: () => Promise<
    readonly StoredBackgroundNotificationSubscription[]
  >;
  removeSessionSubscriptions: (
    sessionIds: ReadonlySet<string>,
  ) => Promise<void>;
  removeSubscription: (endpoint: string) => Promise<void>;
  upsertSubscription: (
    sessionId: string,
    subscription: BackgroundNotificationSubscription,
  ) => Promise<void>;
};

const backgroundNotificationDataDirectory = ({
  environment,
  homeDirectory,
}: {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
}) =>
  join(
    getOvermuxPaths({ environment, homeDir: homeDirectory }).dataDir,
    "background-notifications",
  );

export const createFileBackgroundNotificationStore = ({
  environment = process.env,
  homeDirectory = homedir(),
}: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): BackgroundNotificationStore => {
  const directory = backgroundNotificationDataDirectory({
    environment,
    homeDirectory,
  });
  const keysPath = join(directory, "vapid.json");
  const subscriptionsPath = join(directory, "subscriptions.json");
  let pendingSubscriptionWrite = Promise.resolve();

  const readSubscriptions = async () =>
    (await readPrivateJson(subscriptionsPath, subscriptionsSchema)) ?? [];

  const updateSubscriptions = (
    update: (
      subscriptions: StoredBackgroundNotificationSubscription[],
    ) => StoredBackgroundNotificationSubscription[] | undefined,
  ) => {
    const operation = pendingSubscriptionWrite.then(async () => {
      const subscriptions = await readSubscriptions();
      const updated = update(subscriptions);
      if (updated) {
        await replacePrivateJsonAtomically(subscriptionsPath, updated);
      }
    });
    pendingSubscriptionWrite = operation.catch(() => undefined);
    return operation;
  };

  return {
    getOrCreateKeys: async (generate) => {
      const existing = await readPrivateJson(keysPath, vapidKeysSchema);
      if (existing) {
        return existing;
      }
      const generated = vapidKeysSchema.parse(generate());
      try {
        await createPrivateJsonExclusively(keysPath, generated);
        return generated;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
          throw cause;
        }
        const concurrentlyCreated = await readPrivateJson(
          keysPath,
          vapidKeysSchema,
        );
        if (!concurrentlyCreated) {
          throw cause;
        }
        return concurrentlyCreated;
      }
    },
    listSubscriptions: async () => {
      await pendingSubscriptionWrite;
      return readSubscriptions();
    },
    removeSubscription: (endpoint) =>
      updateSubscriptions((subscriptions) => {
        if (
          !subscriptions.some(
            (entry) => entry.subscription.endpoint === endpoint,
          )
        ) {
          return undefined;
        }
        return subscriptions.filter(
          (entry) => entry.subscription.endpoint !== endpoint,
        );
      }),
    removeSessionSubscriptions: (sessionIds) =>
      updateSubscriptions((subscriptions) => {
        const updated = subscriptions.filter(
          (entry) => !sessionIds.has(entry.sessionId),
        );
        return updated.length === subscriptions.length ? undefined : updated;
      }),
    upsertSubscription: (sessionId, subscription) => {
      const parsed =
        backgroundNotificationSubscriptionSchema.parse(subscription);
      return updateSubscriptions((subscriptions) => {
        const entry = { sessionId, subscription: parsed };
        const existing = subscriptions.find(
          (candidate) => candidate.subscription.endpoint === parsed.endpoint,
        );
        if (isDeepStrictEqual(existing, entry)) {
          return undefined;
        }
        return [
          ...subscriptions.filter(
            (candidate) => candidate.subscription.endpoint !== parsed.endpoint,
          ),
          entry,
        ];
      });
    },
  };
};
