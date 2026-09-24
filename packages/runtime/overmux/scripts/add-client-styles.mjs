import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../dist/exports/client.js", import.meta.url);
const source = await readFile(path, "utf8");
await writeFile(path, `import "./style.css";\n${source}`);
