import { spawn } from "node-pty";

export type PtyDisposable = { dispose: () => void };

export type PtyExit = {
  exitCode: number;
  signal?: number;
};

export type PtyProcess = {
  pid: number;
  kill: (signal?: string) => void;
  onData: (listener: (data: string) => void) => PtyDisposable;
  onExit: (listener: (exit: PtyExit) => void) => PtyDisposable;
  pause: () => void;
  resize: (cols: number, rows: number) => void;
  resume: () => void;
  write: (data: string | Buffer) => void;
};

export type PtySpawnOptions = {
  args: readonly string[];
  cols: number;
  command: string;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  rows: number;
};

export type PtyFactory = (options: PtySpawnOptions) => PtyProcess;

const processEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

export const spawnPty: PtyFactory = ({ args, cols, command, cwd, env, rows }) =>
  spawn(command, [...args], {
    cols,
    cwd,
    env: { ...processEnvironment(), ...env },
    name: env?.TERM ?? "xterm-256color",
    rows,
  });
