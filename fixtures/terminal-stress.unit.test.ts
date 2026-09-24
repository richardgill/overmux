import { describe, expect, it, vi } from "vitest";

import {
  createInitialOutput,
  createSynchronizedFrame,
  emitFixture,
  parseFixtureOptions,
  terminalSizeFromStream,
} from "./terminal-stress";

const escape = String.fromCharCode(27);
const options = { cols: 12, label: "left", rows: 3, seed: "one" };
const stripAnsi = (value: string) =>
  value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
const count = (value: string, sequence: string) =>
  value.split(sequence).length - 1;

describe("terminal stress fixture", () => {
  it("creates deterministic, seed-distinct frames at the requested dimensions", () => {
    const frame = createSynchronizedFrame(options);
    const content = stripAnsi(frame).split("\r\n");

    expect(createSynchronizedFrame(options)).toBe(frame);
    expect(createSynchronizedFrame({ ...options, label: "right" })).not.toBe(
      frame,
    );
    expect(createSynchronizedFrame({ ...options, seed: "two" })).not.toBe(
      frame,
    );
    expect(content).toHaveLength(options.rows);
    expect(content.every((row) => row.length === options.cols)).toBe(true);
    expect(content[0]).toContain("left");
  });

  it("keeps a 243x59 frame in the Pi-like byte range", () => {
    const frame = createSynchronizedFrame({
      cols: 243,
      label: "pi-stress",
      rows: 59,
      seed: "pi-stress",
    });

    expect(Buffer.byteLength(frame)).toBeGreaterThanOrEqual(16 * 1024);
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(30 * 1024);
  });

  it("wraps exactly one complete synchronized frame in alternate-screen output", () => {
    const output = createInitialOutput(options);

    expect(output).toContain(`${escape}[?1049h`);
    expect(count(output, `${escape}[?2026h`)).toBe(1);
    expect(count(output, `${escape}[?2026l`)).toBe(1);
    expect(output.indexOf(`${escape}[?2026h`)).toBeLessThan(
      output.indexOf(`${escape}[?2026l`),
    );
  });

  it("emits once and remains idle until terminal cleanup", () => {
    const write = vi.fn();
    const keepAlive = vi.fn();
    let cleanup = () => undefined;

    emitFixture(
      { ...options, report: false },
      {
        keepAlive,
        onExit: (handler) => {
          cleanup = handler;
        },
        write,
      },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(keepAlive).toHaveBeenCalledOnce();
    cleanup();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("validates arguments and uses terminal dimensions by default", () => {
    expect(
      parseFixtureOptions(
        ["--label", "right"],
        terminalSizeFromStream({ columns: 243, rows: 59 }),
      ),
    ).toMatchObject({ cols: 243, label: "right", rows: 59 });
    expect(() => parseFixtureOptions(["--cols", "0"])).toThrow(
      "--cols must be a positive integer",
    );
    expect(() => parseFixtureOptions(["--rows"])).toThrow(
      "--rows requires a value",
    );
    expect(() => parseFixtureOptions(["--label", "two\nlines"])).toThrow(
      "--label must contain printable ASCII text",
    );
    expect(() => parseFixtureOptions(["--unknown"])).toThrow(
      "unknown argument: --unknown",
    );
  });
});
