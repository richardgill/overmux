// Removes bundler source-region markers that reveal private implementation paths.
// Public declarations retain their API while staying independent of the source layout.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const declarationFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? declarationFiles(path)
          : Promise.resolve(path.endsWith(".d.ts") ? [path] : []);
      }),
    )
  ).flat();
};

const cleanDeclaration = async (path: string) => {
  const source = await readFile(path, "utf8");
  const clean = source.replace(/^\/\/#(?:end)?region.*\n/gmu, "");
  await writeFile(path, clean);
};

const files = await declarationFiles(resolve(import.meta.dirname, "../dist"));
await Promise.all(files.map(cleanDeclaration));
