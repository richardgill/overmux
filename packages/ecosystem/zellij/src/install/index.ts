// This is the narrow public installation API used by projects and the Overmux CLI.
// Runtime remains deliberately unable to install or upgrade the Zellij plugin.
export {
  ZellijArtifactMissingError,
  ZellijArtifactVerificationError,
  ZellijMalformedOutputError,
  ZellijNoSessionError,
  ZellijPermissionError,
  ZellijPipeExitedError,
  ZellijProtocolMismatchError,
  ZellijReconciliationTimeoutError,
  ZellijStartupTimeoutError,
} from "./errors";
export {
  installZellij,
  type InstallZellijOptions,
  type InstallZellijResult,
} from "./install";
