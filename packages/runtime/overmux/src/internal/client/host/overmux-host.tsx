// This file is the overmux owned part of the client

import {
  runtimeManifestSchema,
  type RuntimeManifest,
} from "../../shared/index";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Component,
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { overmuxLogoutPath, overmuxSettingsPath } from "@overmux/shared";
import { OvermuxThemeScope } from "../theme-scope";
import { createOvermuxServerApi } from "../browser-api";
import { installBrowserLogForwarding } from "./browser-log-forwarding";
import { installNotificationForwarding } from "./notification-forwarding";
import { installInstanceForwarding } from "./instance-forwarding";
import { installDeepLinkNavigation } from "./deep-link-navigation";
import type { ClientAppDefinition } from "../client-definition";
import { type RegisteredCommand, RuntimeContext } from "../commands";
import { ShortcutHost } from "../shortcuts";
import { createClientTransport, TransportContext } from "../transport";
import { HostedLogoutPage } from "./hosted-pages/logout-page";
import { HostedSettingsPage } from "./hosted-pages/settings-page";
import { RecoveryScreen } from "./recovery-screen";
import { UpdatePopover } from "./update-popover";
import { installEnvironmentSelectors } from "./environment";

// Userland owns createRoot. Initialize on import, before any React tree mounts.
const disposeEnvironment =
  typeof window === "undefined" ? undefined : installEnvironmentSelectors();
import.meta.hot?.dispose(() => disposeEnvironment?.());

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
};

type ErrorBoundaryState = { error?: Error };

class RootErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}

class AuthenticationRequiredError extends Error {}

const redirectToLogin = () => location.replace("/login?reason=session-expired");

const loadRuntimeManifest = async () => {
  const response = await fetch("/api/runtime-manifest", { cache: "no-store" });
  if (response.status === 401) {
    throw new AuthenticationRequiredError("Authentication required");
  }
  if (!response.ok) {
    throw new Error(`Runtime manifest request failed: ${response.status}`);
  }
  return runtimeManifestSchema.parse(await response.json());
};

const OvermuxRuntime = ({
  definition,
}: {
  definition: ClientAppDefinition;
}) => {
  const safeMode = new URLSearchParams(location.search).get("safe") === "1";
  const transport = useMemo(createClientTransport, []);
  const queryClient = useMemo(() => new QueryClient(), []);
  const logForwardingDisposer = useRef<(() => void) | undefined>(undefined);
  const [manifest, setManifest] = useState<RuntimeManifest>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void loadRuntimeManifest()
      .then((next) => {
        if (!active) {
          return;
        }
        setManifest(next);
        transport.activate();
      })
      .catch((cause: unknown) => {
        if (cause instanceof AuthenticationRequiredError) {
          redirectToLogin();
          return;
        }
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [transport]);
  const registrations = useMemo(() => new Set<RegisteredCommand>(), []);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  useEffect(() => {
    if (manifest?.debug && !logForwardingDisposer.current) {
      logForwardingDisposer.current = installBrowserLogForwarding(
        transport.reportDiagnostic,
      );
    }
  }, [manifest?.debug, transport]);
  useEffect(
    () =>
      transport.subscribeStatus((status) => {
        if (status === "authentication-required") {
          redirectToLogin();
        }
      }),
    [transport],
  );
  useEffect(
    () => () => {
      logForwardingDisposer.current?.();
      transport.dispose();
    },
    [transport],
  );
  useEffect(() => installNotificationForwarding(transport), [transport]);
  useEffect(() => installInstanceForwarding(transport), [transport]);
  useEffect(
    () =>
      installDeepLinkNavigation({
        getInstance: transport.getInstance,
        navigate: definition.navigate,
      }),
    [transport, definition.navigate],
  );
  const refreshCommands = useCallback(
    () => setRegistrationRevision((revision) => revision + 1),
    [],
  );
  const registerCommand = useCallback(
    (registration: RegisteredCommand) => {
      registrations.add(registration);
      refreshCommands();
      return () => {
        registrations.delete(registration);
        refreshCommands();
      };
    },
    [refreshCommands, registrations],
  );
  const overmuxServerApi = useMemo(
    () =>
      manifest ? createOvermuxServerApi({ manifest, transport }) : undefined,
    [manifest, transport],
  );
  if (safeMode || !manifest || !overmuxServerApi) {
    return <RecoveryScreen error={error} />;
  }

  const App = definition.component;
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeContext.Provider
        value={{
          manifest,
          overmuxServerApi,
          refreshCommands,
          registerCommand,
        }}
      >
        <TransportContext.Provider value={transport}>
          <ShortcutHost
            definition={definition}
            registrations={registrations}
            registrationRevision={registrationRevision}
          >
            <RootErrorBoundary
              fallback={(cause) => <RecoveryScreen error={cause.message} />}
            >
              {createElement(App)}
            </RootErrorBoundary>
            <UpdatePopover transport={transport} />
          </ShortcutHost>
        </TransportContext.Provider>
      </RuntimeContext.Provider>
    </QueryClientProvider>
  );
};

export const OvermuxHost = ({
  definition,
}: {
  definition: ClientAppDefinition;
}) => (
  <OvermuxThemeScope {...definition.appearance}>
    {location.pathname === overmuxSettingsPath ? (
      <HostedSettingsPage />
    ) : location.pathname === overmuxLogoutPath ? (
      <HostedLogoutPage />
    ) : (
      <OvermuxRuntime definition={definition} />
    )}
  </OvermuxThemeScope>
);
