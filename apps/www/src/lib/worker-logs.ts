import {
  getErrorHttpStatus,
  getRequestId,
  getRequestTelemetry,
} from "./request-telemetry";
import type { WorkerEnv } from "./worker-env";

const safeHeaderNames = [
  "accept",
  "accept-encoding",
  "accept-language",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "content-type",
  "host",
  "priority",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
  "x-forwarded-proto",
];

export type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

type LogOutcome = "ok" | "exception";
type CfProperties = Record<string, unknown>;
type WaitUntil = (promise: Promise<unknown>) => void;

export type InvocationLogInput = {
  request: Request;
  start: number;
  routePath: string;
  httpStatus?: number;
  error?: unknown;
  severity?: LogSeverity;
  outcome?: LogOutcome;
  properties?: Record<string, unknown>;
};

export type CreateInvocationLoggerInput = {
  env: WorkerEnv;
  name: string;
  scopeName?: string;
  properties?: Record<string, unknown>;
  waitUntil?: WaitUntil;
};

type OtelValue =
  | { stringValue: string }
  | { intValue: number }
  | { boolValue: boolean };
type OtelAttribute = { key: string; value: OtelValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const compactObject = (
  object: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) => {
      if (
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
        return [];
      }
      if (!isRecord(value)) {
        return [[key, value]];
      }
      const compactValue = compactObject(value);
      return Object.keys(compactValue).length === 0
        ? []
        : [[key, compactValue]];
    }),
  );

const getObjectValue = (object: CfProperties | undefined, key: string) => {
  const value = object?.[key];
  return isRecord(value) ? value : undefined;
};

export const getSafeCfProperties = (cf: CfProperties | undefined) => {
  const botManagement = getObjectValue(cf, "botManagement");
  const edgeL4 = getObjectValue(cf, "edgeL4");

  return compactObject({
    isEUCountry: cf?.isEUCountry,
    httpProtocol: cf?.httpProtocol,
    requestPriority: cf?.requestPriority,
    colo: cf?.colo,
    country: cf?.country,
    continent: cf?.continent,
    regionCode: cf?.regionCode,
    timezone: cf?.timezone,
    tlsVersion: cf?.tlsVersion,
    tlsCipher: cf?.tlsCipher,
    verifiedBotCategory: cf?.verifiedBotCategory,
    edgeRequestKeepAliveStatus: cf?.edgeRequestKeepAliveStatus,
    clientTcpRtt: cf?.clientTcpRtt,
    clientQuicRtt: cf?.clientQuicRtt,
    asn: cf?.asn,
    edgeL4: { deliveryRate: edgeL4?.deliveryRate },
    botManagement: {
      corporateProxy: botManagement?.corporateProxy,
      verifiedBot: botManagement?.verifiedBot,
      staticResource: botManagement?.staticResource,
      score: botManagement?.score,
    },
  });
};

export const getSafeHeaders = (headers: Headers) =>
  Object.fromEntries(
    safeHeaderNames.flatMap((name) => {
      const value = headers.get(name);
      return value ? [[name, value]] : [];
    }),
  );

const severityRanks: Record<LogSeverity, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

export const getHttpStatusSeverity = (
  status: number | undefined,
): LogSeverity => {
  if (status === undefined) {
    return "INFO";
  }
  if (status >= 500) {
    return "ERROR";
  }
  return [408, 429, 499].includes(status) ? "WARN" : "INFO";
};

export const resolveSeverity = ({
  severity,
  httpStatus,
}: Pick<InvocationLogInput, "severity" | "httpStatus">): LogSeverity => {
  const statusSeverity = getHttpStatusSeverity(httpStatus);
  if (!severity || severityRanks[severity] < severityRanks[statusSeverity]) {
    return statusSeverity;
  }
  return severity;
};

const getOtelAttribute = (
  key: string,
  value: string | number | boolean,
): OtelAttribute => ({
  key,
  value:
    typeof value === "number"
      ? { intValue: value }
      : typeof value === "boolean"
        ? { boolValue: value }
        : { stringValue: value },
});

export const getOtelLogBody = ({
  env,
  logRecord,
  scopeName,
  severity,
}: {
  env: WorkerEnv;
  logRecord: Record<string, unknown>;
  scopeName: string;
  severity: LogSeverity;
}) => ({
  resourceLogs: [
    {
      resource: {
        attributes: [
          getOtelAttribute("service.name", env.SERVICE_NAME),
          getOtelAttribute("deployment.environment.name", env.ENVIRONMENT),
          getOtelAttribute("cloud.provider", "cloudflare"),
          getOtelAttribute("cloud.platform", "cloudflare.workers"),
          getOtelAttribute("cloudflare.script_name", env.SERVICE_NAME),
          ...(env.VERSION_METADATA?.id
            ? [
                getOtelAttribute(
                  "cloudflare.script_version.id",
                  env.VERSION_METADATA.id,
                ),
              ]
            : []),
        ],
      },
      scopeLogs: [
        {
          scope: { name: scopeName },
          logRecords: [
            {
              timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
              severityText: severity,
              body: { stringValue: JSON.stringify(logRecord) },
              attributes: [getOtelAttribute("name", "log")],
            },
          ],
        },
      ],
    },
  ],
});

const getSendFailureLogName = (name: string) =>
  `${name.replace(/_v\d+$/, "")}_posthog_send_failed`;

const sendPostHogLog = async ({
  env,
  logRecord,
  name,
  scopeName,
  severity,
}: {
  env: WorkerEnv;
  logRecord: Record<string, unknown>;
  name: string;
  scopeName: string;
  severity: LogSeverity;
}) => {
  const response = await fetch(env.POSTHOG_LOGS_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.PUBLIC_POSTHOG_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      getOtelLogBody({ env, logRecord, scopeName, severity }),
    ),
  });

  if (!response.ok) {
    console.error(getSendFailureLogName(name), { status: response.status });
  }
};

const logToConsole = ({
  logRecord,
  name,
  severity,
}: {
  logRecord: Record<string, unknown>;
  name: string;
  severity: LogSeverity;
}) => {
  const logger =
    severity === "DEBUG"
      ? console.debug
      : severity === "WARN"
        ? console.warn
        : severity === "ERROR" || severity === "FATAL"
          ? console.error
          : console.log;
  logger(name, logRecord);
};

const getInvocationLogRecord = ({
  env,
  input,
  httpStatus,
  name,
}: {
  env: WorkerEnv;
  input: InvocationLogInput;
  httpStatus: number;
  name: string;
}) => {
  const url = new URL(input.request.url);
  const requestId = getRequestId(input.request, crypto.randomUUID());
  return compactObject({
    type: name,
    ...getRequestTelemetry({
      env,
      httpStatus,
      request: input.request,
      requestId,
      routePath: input.routePath,
    }),
    outcome:
      input.outcome ?? (input.error || httpStatus >= 500 ? "exception" : "ok"),
    hasQuery: Boolean(url.search),
    wallTimeMs: Date.now() - input.start,
    ...input.properties,
    cf: getSafeCfProperties(
      (input.request as Request & { cf?: CfProperties }).cf,
    ),
    headers: getSafeHeaders(input.request.headers),
  });
};

export const createInvocationLogger = ({
  env,
  name,
  properties,
  scopeName = name,
  waitUntil,
}: CreateInvocationLoggerInput) => ({
  log: async (input: InvocationLogInput) => {
    const httpStatus =
      input.httpStatus ?? (input.error ? getErrorHttpStatus(input.error) : 200);
    const severity = resolveSeverity({ severity: input.severity, httpStatus });
    const logRecord = getInvocationLogRecord({
      env,
      input: { ...input, properties: { ...properties, ...input.properties } },
      httpStatus,
      name,
    });
    logToConsole({ logRecord, name, severity });

    const sendPromise = sendPostHogLog({
      env,
      logRecord,
      name,
      scopeName,
      severity,
    }).catch((error: unknown) => {
      console.error(getSendFailureLogName(name), {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    if (waitUntil) {
      waitUntil(sendPromise);
      return;
    }
    await sendPromise;
  },
});
