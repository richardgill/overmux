import { loadConfigOrDefault } from "@richardgill/pi-config";

import { OvermuxPiConfigSchema } from "./config.js";
import { overmuxPi } from "./extension.js";

export * from "./extension.js";

const config = loadConfigOrDefault({
  filename: "overmux-pi.jsonc",
  schema: OvermuxPiConfigSchema,
});

export default (pi: Parameters<typeof overmuxPi>[0]): void =>
  overmuxPi(pi, config);
