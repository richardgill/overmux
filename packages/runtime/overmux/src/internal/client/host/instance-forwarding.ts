import type { ClientTransport } from "../transport";
import type {} from "./desktop-host";

export const installInstanceForwarding = (transport: ClientTransport) => {
  const report = () => {
    const identity = transport.getInstance();
    const bridge = window.overmuxHost?.instance;
    if (!identity || bridge?.version !== 1) {
      return;
    }
    try {
      bridge.report({ instanceId: identity.instanceId });
    } catch (cause) {
      // A host integration failure must not interrupt browser discovery or traffic.
      console.error("Overmux host instance reporting failed", cause);
    }
  };
  const unsubscribe = transport.subscribeInstance(report);
  report();
  return unsubscribe;
};
