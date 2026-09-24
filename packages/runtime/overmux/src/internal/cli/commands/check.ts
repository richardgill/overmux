import { buildCommand } from "@stricli/core";
import { checkOvermux, type CheckResult } from "../../server/index";
import { getDefaultConfigPath } from "../../server/paths";
type CheckFlags = {
  config: string;
};

const printCheck = (result: CheckResult) => {
  result.diagnostics.forEach((diagnostic) => {
    const location = diagnostic.file
      ? `${diagnostic.file}:${diagnostic.line ?? 1}:${diagnostic.column ?? 1}`
      : (diagnostic.path ?? diagnostic.phase);
    const code = diagnostic.code ? ` ${diagnostic.code}` : "";
    console.error(`error${code} ${location}\n  ${diagnostic.message}`);
  });
  if (!result.ok) {
    console.error(`check failed: ${result.diagnostics.length} errors`);
    return;
  }
  console.log(`✓ config: ${result.config}`);
  if (result.operations !== undefined) {
    console.log(`✓ operations: ${result.operations} definitions`);
  }
  console.log(`✓ types: ${result.files} reachable files`);
};

const runCheck = async (flags: CheckFlags) => {
  const result = await checkOvermux({ configPath: flags.config });
  printCheck(result);
  process.exitCode = result.ok ? 0 : 1;
};

export const checkCommand = buildCommand({
  func: runCheck,
  parameters: {
    aliases: { c: "config" },
    flags: {
      config: {
        brief: "Configuration file",
        default: getDefaultConfigPath(),
        kind: "parsed",
        parse: String,
        placeholder: "path",
      },
    },
  },
  docs: { brief: "Validate an Overmux configuration" },
});
