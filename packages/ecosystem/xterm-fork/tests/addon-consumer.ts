import { Terminal, type IInputTransformEvent } from "@overmux/xterm-fork";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from "@xterm/addon-web-links";

const terminal = new Terminal({ allowProposedApi: true });
const addons = [
  new FitAddon(),
  new Unicode11Addon(),
  new WebglAddon(),
  new ClipboardAddon(),
  new WebLinksAddon(),
];

addons.forEach((addon) => terminal.loadAddon(addon));
const attachment = terminal.attachInputTransform(
  (event: IInputTransformEvent) => event.data,
);
terminal.cancelPendingInput();
attachment.dispose();
