import { Terminal, type IInputTransformEvent } from "@overmux/xterm-fork";

const terminal = new Terminal();
terminal
  .attachInputTransform((event: IInputTransformEvent) => event.data)
  .dispose();
