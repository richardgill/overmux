import { pathToFileURL } from "node:url";

const escape = "\u001B";
const synchronizedOutputOn = `${escape}[?2026h`;
const synchronizedOutputOff = `${escape}[?2026l`;

type TerminalSize = { cols?: number; rows?: number };

export type FixtureOptions = {
  cols: number;
  label: string;
  rows: number;
  seed: string;
};

const defaultSize = { cols: 80, rows: 24 };
const segmentsPerRow = 2;

const parseDimension = (value: string | undefined, name: string) => {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
};

const parseValue = (
  argument: string,
  args: readonly string[],
  index: number,
) => {
  const [, inline] = argument.split("=", 2);
  const value = inline ?? args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument.split("=", 1)[0]} requires a value`);
  }
  return value;
};

export const parseFixtureOptions = (
  args: readonly string[],
  terminal: TerminalSize = defaultSize,
): FixtureOptions & { report: boolean } => {
  const values = { label: "pi-stress", report: false, seed: "pi-stress" };
  let cols = terminal.cols ?? defaultSize.cols;
  let rows = terminal.rows ?? defaultSize.rows;

  for (const [index, argument] of args.entries()) {
    if (argument === "--report") {
      values.report = true;
    } else if (argument === "--cols" || argument.startsWith("--cols=")) {
      cols = parseDimension(parseValue(argument, args, index), "--cols");
    } else if (argument === "--rows" || argument.startsWith("--rows=")) {
      rows = parseDimension(parseValue(argument, args, index), "--rows");
    } else if (argument === "--label" || argument.startsWith("--label=")) {
      values.label = parseValue(argument, args, index) ?? "";
    } else if (argument === "--seed" || argument.startsWith("--seed=")) {
      values.seed = parseValue(argument, args, index) ?? "";
    } else if (
      !argument.startsWith("--") &&
      ["--cols", "--rows", "--label", "--seed"].includes(args[index - 1] ?? "")
    ) {
      continue;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (!/^[\x20-\x7e]+$/.test(values.label)) {
    throw new Error("--label must contain printable ASCII text");
  }
  if (!values.seed) {
    throw new Error("--seed must not be empty");
  }
  return { cols, rows, ...values };
};

const hash = (value: string) =>
  [...value].reduce(
    (state, character) =>
      Math.imul(state ^ character.charCodeAt(0), 16_777_619),
    2_166_136_261,
  ) >>> 0;

const random = (state: number) =>
  (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

const text = " .:-=+*#%@abcdefghijklmnopqrstuvwxyz0123456789[]{}<>/\\|";

const labelText = (options: FixtureOptions) =>
  ` ${options.label} | ${options.seed} | ${options.cols}x${options.rows} `;

const styledSegment = (state: number, width: number, prefix: string) => {
  const next = random(state);
  const foreground = [next & 255, (next >>> 8) & 255, (next >>> 16) & 255];
  const background = [
    (next >>> 4) & 127,
    (next >>> 12) & 127,
    (next >>> 20) & 127,
  ];
  const content = Array.from(
    { length: width },
    (_, index) =>
      prefix[index] ?? text[(random(next + index) >>> 8) % text.length],
  ).join("");
  const style = `${escape}[${next % 2 ? "1;3;" : "2;4;"}38;2;${foreground.join(";")};48;2;${background.join(";")}m`;
  return `${style}${content}${escape}[0m`;
};

const createRow = (options: FixtureOptions, row: number) => {
  const header = row === 0 ? labelText(options).slice(0, options.cols) : "";
  const state = hash(`${options.seed}:${options.label}:${row}`);
  const segmentWidth = Math.ceil(options.cols / segmentsPerRow);
  return Array.from({ length: segmentsPerRow }, (_, index) => {
    const start = index * segmentWidth;
    return styledSegment(
      random(state + index),
      Math.min(segmentWidth, options.cols - start),
      header.slice(start, start + segmentWidth),
    );
  }).join("");
};

export const createSynchronizedFrame = (options: FixtureOptions) =>
  `${synchronizedOutputOn}${escape}[2J${escape}[H${Array.from(
    { length: options.rows },
    (_, row) => createRow(options, row),
  ).join("\r\n")}${synchronizedOutputOff}`;

export const createInitialOutput = (options: FixtureOptions) =>
  `${escape}[?1049h${escape}[?25l${createSynchronizedFrame(options)}`;

type FixtureRuntime = {
  keepAlive: () => void;
  onExit: (handler: () => void) => void;
  write: (output: string) => void;
};

export const emitFixture = (
  options: FixtureOptions & { report: boolean },
  runtime: FixtureRuntime,
) => {
  if (options.report) {
    runtime.write(`${Buffer.byteLength(createSynchronizedFrame(options))}\n`);
    return;
  }
  runtime.write(createInitialOutput(options));
  runtime.keepAlive();
  runtime.onExit(() => runtime.write(`${escape}[?25h${escape}[?1049l`));
};

export const terminalSizeFromStream = (stream: {
  columns?: number;
  rows?: number;
}): TerminalSize => ({ cols: stream.columns, rows: stream.rows });

export const runFixture = (args: readonly string[], terminal: TerminalSize) =>
  emitFixture(parseFixtureOptions(args, terminal), {
    keepAlive: () => process.stdin.resume(),
    onExit: (handler) => {
      ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
        process.once(signal, () => {
          handler();
          process.exit(0);
        });
      });
    },
    write: (output) => process.stdout.write(output),
  });

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runFixture(process.argv.slice(2), terminalSizeFromStream(process.stdout));
}
