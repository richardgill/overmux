import { buildCommand, buildRouteMap } from "@stricli/core";

import {
  discoverInstance,
  sendControlRequest,
} from "../../server/auth/instance-control";
import type { CliCommandContext } from "../environment";
import { issueLoginGrant, printLoginGrant } from "../login";
import { parsePort } from "../parse-port";

type InstanceFlags = { port?: string };
type JsonInstanceFlags = InstanceFlags & { json?: boolean };
type LoginFlags = JsonInstanceFlags & { code?: boolean; url?: boolean };
type RevokeFlags = JsonInstanceFlags & { all?: boolean };

const selectedPort = (portValue?: string) => {
  const port = portValue === undefined ? undefined : parsePort(portValue);
  if (port instanceof Error) {
    throw port;
  }
  return port;
};

const selectedInstance = (portValue?: string) =>
  discoverInstance(selectedPort(portValue));

const printJson = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);

const runLogin = async (flags: LoginFlags, process: NodeJS.Process) => {
  const formats = [flags.code, flags.url, flags.json].filter(Boolean).length;
  if (formats > 1) {
    throw new Error("Only set one of: --code, --url, and --json");
  }
  const issued = await issueLoginGrant(selectedPort(flags.port));
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(issued.login)}\n`);
    return;
  }
  if (flags.code) {
    process.stdout.write(`${issued.login.code}\n`);
    return;
  }
  if (flags.url) {
    process.stdout.write(`${issued.login.urls[0]}\n`);
    return;
  }
  printLoginGrant({ ...issued, output: process });
};

function runLoginCommand(this: CliCommandContext, flags: LoginFlags) {
  return runLogin(flags, this.process);
}

const instanceFlags = {
  port: {
    brief: "Running local server port",
    kind: "parsed" as const,
    optional: true as const,
    parse: String,
  },
};

export const authLoginCommand = buildCommand({
  func: runLoginCommand,
  parameters: {
    flags: {
      code: {
        brief: "Print only the login code",
        kind: "boolean",
        optional: true,
      },
      json: {
        brief: "Print machine-readable JSON",
        kind: "boolean",
        optional: true,
      },
      ...instanceFlags,
      url: {
        brief: "Print only the login URL",
        kind: "boolean",
        optional: true,
      },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  docs: { brief: "Create a single-use browser login grant" },
});

const runList = async (flags: JsonInstanceFlags) => {
  const instance = await selectedInstance(flags.port);
  const response = await sendControlRequest(instance, {
    type: "list-sessions",
  });
  if (flags.json) {
    printJson({ sessions: response.sessions });
    return;
  }
  if (response.sessions.length === 0) {
    process.stdout.write("No active sessions.\n");
    return;
  }
  process.stdout.write("ID\tORIGIN\tCREATED\tLAST SEEN\tEXPIRES\n");
  response.sessions.forEach((session) => {
    process.stdout.write(
      `${session.id}\t${session.origin ?? "unknown"}\t${session.createdAt}\t${session.lastSeenAt}\t${session.expiresAt ?? "never"}\n`,
    );
  });
};

export const authListCommand = buildCommand({
  func: runList,
  parameters: {
    flags: {
      json: {
        brief: "Print machine-readable JSON",
        kind: "boolean",
        optional: true,
      },
      ...instanceFlags,
    },
    positional: { kind: "tuple", parameters: [] },
  },
  docs: { brief: "List active browser sessions" },
});

const runRevoke = async (flags: RevokeFlags, id?: string) => {
  if (Boolean(id) === Boolean(flags.all)) {
    throw new Error("Specify exactly one session ID or --all");
  }
  const instance = await selectedInstance(flags.port);
  if (id) {
    const response = await sendControlRequest(instance, {
      id,
      type: "revoke-session",
    });
    if (!response.revoked) {
      throw new Error(`Session not found: ${id}`);
    }
    if (flags.json) {
      printJson({ revoked: 1 });
      return;
    }
    process.stdout.write(`Revoked session ${id}.\n`);
    return;
  }
  const response = await sendControlRequest(instance, { type: "revoke-all" });
  if (flags.json) {
    printJson({ revoked: response.count });
    return;
  }
  process.stdout.write(
    `Revoked ${response.count} session${response.count === 1 ? "" : "s"}.\n`,
  );
};

export const authRevokeCommand = buildCommand({
  func: runRevoke,
  parameters: {
    flags: {
      all: {
        brief: "Revoke every active session",
        kind: "boolean",
        optional: true,
      },
      json: {
        brief: "Print machine-readable JSON",
        kind: "boolean",
        optional: true,
      },
      ...instanceFlags,
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Session ID",
          optional: true,
          parse: String,
          placeholder: "id",
        },
      ],
    },
  },
  docs: { brief: "Revoke browser authentication sessions" },
});

export const authRoute = buildRouteMap({
  docs: { brief: "Manage CLI-issued browser authentication" },
  routes: {
    list: authListCommand,
    login: authLoginCommand,
    revoke: authRevokeCommand,
  },
});
