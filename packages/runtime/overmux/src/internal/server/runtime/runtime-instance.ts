import { hostname } from "node:os";
import type { RuntimeConfigDefinition } from "@overmux/shared/node";
import {
  createInstanceIdentity,
  type InstanceIdentity,
} from "../../shared/index";
import type { InstanceContext } from "../../../public/config";

export const defaultInstanceId = ({ port }: { port: number }) =>
  `${hostname()}-${port}`;

// The scope exists during preparation, but identity is immutable once the listener
// binds. No handler or connection may observe it before establishment.
export const createRuntimeInstance = (
  configured: NonNullable<RuntimeConfigDefinition["instanceId"]>,
) => {
  let identity: InstanceIdentity | undefined;
  const get = () => {
    if (!identity) {
      throw new Error("Overmux instance identity is not ready");
    }
    return identity;
  };
  const context: InstanceContext = {
    getInstanceId: () => get().instanceId,
    getDeepLinkPrefix: () => get().deepLinkPrefix,
  };
  return {
    context,
    establish: (port: number) => {
      if (identity) {
        throw new Error("Overmux instance identity is already established");
      }
      try {
        identity = createInstanceIdentity(
          typeof configured === "function" ? configured({ port }) : configured,
        );
      } catch (cause) {
        throw new Error(
          "Invalid Overmux instance ID; configure instanceId with a canonical lowercase ID",
          { cause },
        );
      }
      return identity;
    },
  };
};
