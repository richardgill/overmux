import { makeViteSource } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Vite.js";
import type { ViteOptions } from "../node_modules/alchemy/lib/Cloudflare/Workers/Worker.js";
import * as Effect from "effect/Effect";

const make = (options: ViteOptions) => Effect.succeed(makeViteSource(options));

export default { make };
