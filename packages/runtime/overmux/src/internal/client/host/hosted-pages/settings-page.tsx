import { overmuxLogoutPath, resolveOvermuxReturnTo } from "@overmux/shared";
import { BrowserNotificationSettings } from "./browser-notification-settings";
import { HostedPage } from "./hosted-page";

const DesktopNotificationSettings = () => (
  <div data-om-desktop-notifications="">
    <h3>Desktop notifications</h3>
    <p>
      Notifications are delivered through the Overmux desktop app and managed by
      the OS. Change notification permissions and preferences in your operating
      system's settings.
    </p>
  </div>
);

export const HostedSettingsPage = () => {
  const returnTo = resolveOvermuxReturnTo(
    new URLSearchParams(location.search).get("returnTo"),
  );
  const desktopNotifications = Boolean(window.overmuxHost?.notifications);

  return (
    <HostedPage>
      <header data-om-hosted-header="">
        <h1>Overmux settings</h1>
        <a href={returnTo}>Back to Overmux</a>
      </header>
      <section data-om-hosted-section="">
        <h2>Notifications</h2>
        {desktopNotifications ? (
          <DesktopNotificationSettings />
        ) : (
          <BrowserNotificationSettings />
        )}
      </section>
      <section data-om-hosted-section="">
        <h2>Session</h2>
        <p>End this Overmux session on this device.</p>
        <a data-om-hosted-button="" href={overmuxLogoutPath}>
          Log out
        </a>
      </section>
    </HostedPage>
  );
};
