import { useCallback, useEffect, useState } from "react";

import {
  disableBackgroundNotifications,
  enableBackgroundNotifications,
  reconciledStatus,
  type BackgroundNotificationStatus,
} from "../../background-notifications";

const statusMessage = (status: BackgroundNotificationStatus) => {
  const messages: Record<BackgroundNotificationStatus, string> = {
    checking: "Checking background notification status…",
    denied:
      "Background notifications are blocked in this browser's site settings.",
    disabled: "Background notifications are disabled for this browser.",
    enabled: "Background notifications are enabled for this browser.",
    error: "Background notification settings could not be updated. Try again.",
    "ios-home-screen":
      "On iPhone or iPad, add Overmux to the Home Screen before enabling background notifications.",
    unsupported: "Background notifications are not supported in this browser.",
  };
  return messages[status];
};

export const BrowserNotificationSettings = () => {
  const [status, setStatus] =
    useState<BackgroundNotificationStatus>("checking");

  useEffect(() => {
    let active = true;
    const reconcile = () => {
      void reconciledStatus()
        .then((next) => {
          if (active) {
            setStatus(next);
          }
        })
        .catch(() => {
          if (active) {
            setStatus("error");
          }
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconcile();
      }
    };
    reconcile();
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker?.addEventListener("controllerchange", reconcile);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        reconcile,
      );
    };
  }, []);

  const enable = useCallback(async () => {
    try {
      setStatus("checking");
      const enabled = await enableBackgroundNotifications();
      setStatus(
        enabled
          ? "enabled"
          : Notification.permission === "denied"
            ? "denied"
            : "disabled",
      );
    } catch {
      setStatus("error");
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      setStatus("checking");
      await disableBackgroundNotifications();
      setStatus("disabled");
    } catch {
      setStatus("error");
    }
  }, []);

  const canEnable = status === "disabled" || status === "error";
  const canDisable = status === "enabled" || status === "error";
  return (
    <div data-om-browser-notifications="">
      <h3>Browser notifications</h3>
      <p aria-live="polite" data-om-background-notifications-status="">
        {statusMessage(status)}
      </p>
      <div data-om-hosted-actions="">
        {canEnable ? (
          <button
            data-om-background-notifications-enable=""
            onClick={enable}
            type="button"
          >
            Enable
          </button>
        ) : null}
        {canDisable ? (
          <button
            data-om-background-notifications-disable=""
            onClick={disable}
            type="button"
          >
            Disable
          </button>
        ) : null}
      </div>
    </div>
  );
};
