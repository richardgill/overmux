import { afterEach, describe, expect, test as testCases, vi } from "vitest";

import { printLoginFallback, printLoginGrant } from "./login";

const captureOutput = () => {
  let stderr = "";
  let stdout = "";
  return {
    output: {
      stderr: { write: (text: string) => Boolean((stderr += text)) },
      stdout: { write: (text: string) => Boolean((stdout += text)) },
    } as Pick<NodeJS.Process, "stderr" | "stdout">,
    read: () => ({ stderr, stdout }),
  };
};

const primaryUrl = "http://127.0.0.1:4242/login#ticket=secret";
const remoteUrl = "https://machine.example.com/login#ticket=secret";

const loginCases = [
  {
    name: "one origin",
    urls: [primaryUrl],
    links: `Login URL: ${primaryUrl}`,
    warning: "Keep the code and link private.\n",
  },
  {
    name: "multiple origins",
    urls: [primaryUrl, remoteUrl],
    links: `Login URLs:\n  ${primaryUrl}\n  ${remoteUrl}`,
    warning: "Keep the code and links private.\n",
  },
];

afterEach(() => vi.useRealTimers());

describe("CLI login output", () => {
  testCases.each(loginCases)("prints $name", ({ urls, links, warning }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const captured = captureOutput();

    printLoginGrant({
      login: {
        code: "ABCD-2345",
        expiresAt: "2026-01-01T00:10:00.000Z",
        id: "grant-id",
        urls,
      },
      output: captured.output,
    });

    expect(captured.read()).toEqual({
      stdout: `Code: ABCD-2345 (enter on the login page)\n\n${links}\n\nExpiry in 10 minutes (at 2026-01-01T00:10:00.000Z).\n\n`,
      stderr: warning,
    });
  });

  testCases("prints the resolved-port fallback", () => {
    const captured = captureOutput();

    printLoginFallback(5317, captured.output);

    expect(captured.read().stdout).toBe(
      "Login with `overmux auth login --port 5317`\n",
    );
  });
});
