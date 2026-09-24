// Validates the committed Zellij plugin inputs before packaging the integration.
// This fast check catches missing, corrupted, or accidentally unpublished WASM artifacts.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const [artifact, manifestContents, packageContents] = await Promise.all([
  readFile(resolve(packageDirectory, "overmux.wasm")),
  readFile(resolve(packageDirectory, "overmux-plugin.json"), "utf8"),
  readFile(resolve(packageDirectory, "package.json"), "utf8"),
]);
const manifest = JSON.parse(manifestContents) as {
  protocolVersion?: unknown;
  sha256?: unknown;
  supportedZellijVersion?: unknown;
};
const packageJson = JSON.parse(packageContents) as { files?: unknown };
const checksum = createHash("sha256").update(artifact).digest("hex");
const files = Array.isArray(packageJson.files) ? packageJson.files : [];

if (artifact.subarray(0, 4).toString("hex") !== "0061736d") {
  throw new Error("packages/ecosystem/zellij/overmux.wasm is not WASM");
}
const wasmModule = await WebAssembly.compile(artifact);
const wasmExports = WebAssembly.Module.exports(wasmModule).map(
  (entry) => entry.name,
);
for (const requiredExport of ["_start", "load", "update", "pipe"]) {
  if (!wasmExports.includes(requiredExport)) {
    throw new Error(`overmux.wasm omits Zellij ABI export ${requiredExport}`);
  }
}
if (
  manifest.sha256 !== checksum ||
  manifest.protocolVersion !== 1 ||
  manifest.supportedZellijVersion !== "0.45.1"
) {
  throw new Error("overmux-plugin.json does not describe overmux.wasm");
}
for (const requiredFile of ["overmux.wasm", "overmux-plugin.json"]) {
  if (!files.includes(requiredFile)) {
    throw new Error(`@overmux/zellij package files omit ${requiredFile}`);
  }
}
console.log(`Validated packaged overmux.wasm (${checksum})`);
