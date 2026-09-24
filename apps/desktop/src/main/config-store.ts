import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { savedConfigSchema, type SavedConfig } from "../shared/contracts.js";

export class ConfigStore {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<SavedConfig | undefined> {
    await this.#writeQueue;
    try {
      const source = await readFile(this.#path, "utf8");
      const parsed: unknown = JSON.parse(source);
      return savedConfigSchema.parse(parsed);
    } catch {
      return undefined;
    }
  }

  save(config: SavedConfig) {
    const validated = savedConfigSchema.parse(config);
    return this.#enqueue(() => this.#write(validated));
  }

  clear() {
    return this.#enqueue(async () => {
      await rm(this.#path, { force: true });
      await rm(`${this.#path}.tmp`, { force: true });
    });
  }

  #enqueue(write: () => Promise<void>) {
    // Serialize snapshots and removals, including their shared temporary file.
    // A failed write rejects its caller without blocking subsequent operations.
    const pending = this.#writeQueue.then(write);
    this.#writeQueue = pending.catch(() => undefined);
    return pending;
  }

  async #write(validated: SavedConfig) {
    const temporaryPath = `${this.#path}.tmp`;
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.#path);
  }
}
