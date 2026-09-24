import { buildCommand } from "@stricli/core";

import {
  discoverInstance,
  sendControlRequest,
} from "../../server/auth/instance-control";
import { createInstanceIdentity } from "../../shared/index";
import { parsePort } from "../parse-port";

type InstanceFlags = { json?: boolean; port?: string };

// Read the already-resolved identity through the private same-user control socket.
// Config may have changed since startup, and re-evaluating it can repeat side effects.
// The running server resolved its identity once using the actual bound port.
const runInstance = async (
  flags: InstanceFlags,
  output: Pick<NodeJS.WriteStream, "write">,
) => {
  const port = flags.port === undefined ? undefined : parsePort(flags.port);
  if (port instanceof Error) {
    throw port;
  }
  const instance = await discoverInstance(port);
  const response = await sendControlRequest(instance, {
    type: "get-instance",
  });
  const identity = createInstanceIdentity(response.instanceId);
  output.write(
    flags.json
      ? `${JSON.stringify(identity)}\n`
      : `Instance ID: ${identity.instanceId}\nDeep-link prefix: ${identity.deepLinkPrefix}\n`,
  );
};

export const createInstanceCommand = (
  output: Pick<NodeJS.WriteStream, "write">,
) =>
  buildCommand({
    func: (flags: InstanceFlags) => runInstance(flags, output),
    parameters: {
      aliases: { p: "port" },
      flags: {
        json: {
          brief: "Print machine-readable JSON",
          kind: "boolean",
          optional: true,
        },
        port: {
          brief: "Running local server port",
          kind: "parsed",
          optional: true,
          parse: String,
        },
      },
      positional: { kind: "tuple", parameters: [] },
    },
    docs: { brief: "Print the identity of a running Overmux server" },
  });
