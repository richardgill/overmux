import { buildCommand } from "@stricli/core";

import {
  discoverInstance,
  sendControlRequest,
  type InstanceRegistration,
} from "../../server/auth/instance-control";
import { parsePort } from "../parse-port";

type Fetch = (input: URL, init: RequestInit) => Promise<Response>;

type CallFlags = {
  input?: string;
  port?: string;
};

const localCredential = async (port?: number) => {
  const instance = await discoverInstance(port);
  const response = await sendControlRequest(instance, {
    type: "issue-bearer",
  });
  return { instance, token: response.bearer.token };
};

const getErrorMessage = async (response: Response) => {
  const body = await response.text();
  if (!body) {
    return `Operation request failed: ${response.status} ${response.statusText}`;
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = parsed.error ?? parsed.message;
    if (typeof message === "string") {
      return `Operation request failed: ${message}`;
    }
  } catch {}
  return `Operation request failed: ${body}`;
};

export const executeCallCommand = async ({
  input,
  operationName,
  fetch = globalThis.fetch,
  getLocalCredential = localCredential,
  port,
}: {
  input?: string;
  operationName: string;
  fetch?: Fetch;
  getLocalCredential?: (port?: number) => Promise<{
    instance: InstanceRegistration;
    token: string;
  }>;
  port?: number;
}): Promise<unknown> => {
  let parsedInput: unknown;
  if (input !== undefined) {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      throw new Error("Operation input must be valid JSON");
    }
  }
  const credential = await getLocalCredential(port);
  const url = new URL(
    `/api/operations/${encodeURIComponent(operationName)}`,
    credential.instance.apiUrl,
  );
  const response = await fetch(url, {
    body: input === undefined ? undefined : JSON.stringify(parsedInput),
    headers: {
      authorization: `Bearer ${credential.token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return response.status === 204 ? undefined : response.json();
};

const runCall = async (flags: CallFlags, operationName: string) => {
  const port = flags.port === undefined ? undefined : parsePort(flags.port);
  if (port instanceof Error) {
    return port;
  }
  const output = await executeCallCommand({
    input: flags.input,
    operationName,
    port,
  });
  if (output !== undefined) {
    console.log(JSON.stringify(output));
  }
};

export const callCommand = buildCommand({
  func: runCall,
  parameters: {
    aliases: { i: "input", p: "port" },
    flags: {
      input: {
        brief: "Operation input as JSON",
        kind: "parsed",
        optional: true,
        parse: String,
      },
      port: {
        brief: "Running local server port",
        kind: "parsed",
        optional: true,
        parse: String,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Operation name",
          parse: String,
          placeholder: "operation-name",
        },
      ],
    },
  },
  docs: { brief: "Invoke an operation on a running Overmux server" },
});
