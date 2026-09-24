import { describe, expect, it, vi } from "vitest";

import type { TerminalDataMessage } from "../shared/contracts";
import { createTerminalOutputFlow } from "./output-flow";

const setup = ({
  emit = vi.fn(),
  outputChunkSize = 3,
  pauseThreshold,
  resumeThreshold,
}: {
  emit?: (message: TerminalDataMessage) => void;
  outputChunkSize?: number;
  pauseThreshold?: number;
  resumeThreshold?: number;
} = {}) => {
  const fail = vi.fn();
  const pauseOutput = vi.fn();
  const resumeOutput = vi.fn();
  const flow = createTerminalOutputFlow({
    emit,
    fail,
    outputChunkSize,
    pauseOutput,
    pauseThreshold,
    resumeOutput,
    resumeThreshold,
    terminalId: "terminal-1",
  });
  return { emit, fail, flow, pauseOutput, resumeOutput };
};

const rendered = (sequence: number, terminalId = "terminal-1") => ({
  sequence,
  terminalId,
  type: "rendered" as const,
});

describe("terminal output flow", () => {
  it("emits byte chunks with one terminal identity and ordered sequences", () => {
    const { emit, flow } = setup();

    flow.emitOutput("abcdefg");

    expect(vi.mocked(emit).mock.calls.map(([message]) => message)).toEqual([
      {
        bytes: Uint8Array.from([97, 98, 99]),
        sequence: 0,
        terminalId: "terminal-1",
        type: "data",
      },
      {
        bytes: Uint8Array.from([100, 101, 102]),
        sequence: 1,
        terminalId: "terminal-1",
        type: "data",
      },
      {
        bytes: Uint8Array.from([103]),
        sequence: 2,
        terminalId: "terminal-1",
        type: "data",
      },
    ]);
  });

  it("requires ordered acknowledgements and ignores stale generations", () => {
    const { flow } = setup({ outputChunkSize: 1 });
    flow.emitOutput("ab");

    flow.acknowledgeOutput(rendered(0, "stale-terminal"));
    expect(() => flow.acknowledgeOutput(rendered(1))).toThrow(
      "Terminal rendered acknowledgement was out of order",
    );
    expect(() => flow.acknowledgeOutput(rendered(0))).not.toThrow();
    expect(() => flow.acknowledgeOutput(rendered(1))).not.toThrow();
  });

  it("propagates output delivery failures and stops the current emission", () => {
    const deliveryFailure = new Error("connection failed");
    const emit = vi
      .fn<(message: TerminalDataMessage) => void>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw deliveryFailure;
      });
    const { fail, flow } = setup({ emit, outputChunkSize: 1 });

    flow.emitOutput("abc");

    expect(emit).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith(deliveryFailure);
  });

  it("pauses at the default byte limit and resumes at its low watermark", () => {
    const chunkSize = 64 * 1_024;
    const { flow, pauseOutput, resumeOutput } = setup({
      outputChunkSize: chunkSize,
    });

    flow.emitOutput("x".repeat(4 * chunkSize));
    expect(pauseOutput).toHaveBeenCalledOnce();
    flow.acknowledgeOutput(rendered(0));
    expect(resumeOutput).not.toHaveBeenCalled();

    flow.acknowledgeOutput(rendered(1));
    expect(resumeOutput).toHaveBeenCalledOnce();
  });
});
