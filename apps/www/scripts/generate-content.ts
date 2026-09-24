import { createBuilder } from "@content-collections/core";
import { fileURLToPath } from "node:url";
import { stageWebsiteDocumentation } from "./stage-package-docs.ts";

await stageWebsiteDocumentation();

const configPath = fileURLToPath(
  new URL("../content-collections.ts", import.meta.url),
);
const builder = await createBuilder(configPath);
await builder.build();
