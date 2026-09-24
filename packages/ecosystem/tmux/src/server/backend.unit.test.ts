import { describe, expect, it } from "vitest";

import { tmuxSocketArguments } from "./backend";

describe("tmux backend", () => {
  it("uses named and absolute sockets", () => {
    expect(tmuxSocketArguments("default")).toStrictEqual(["-L", "default"]);
    expect(tmuxSocketArguments("/tmp/tmux.sock")).toStrictEqual([
      "-S",
      "/tmp/tmux.sock",
    ]);
  });
});
