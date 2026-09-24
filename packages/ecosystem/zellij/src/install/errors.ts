// Installation failures are public so callers can present targeted recovery UI.
// Messages include the exact user action whenever reinstalling can resolve the issue.
const installInstruction = "Run:\npnpm exec overmux integration install zellij";

class ZellijError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

class ZellijInstallationError extends ZellijError {
  constructor(message: string) {
    super(`${message}\n\n${installInstruction}`);
  }
}

export class ZellijArtifactMissingError extends ZellijInstallationError {}
export class ZellijArtifactVerificationError extends ZellijInstallationError {}
export class ZellijPermissionError extends ZellijInstallationError {}
export class ZellijProtocolMismatchError extends ZellijInstallationError {}
export class ZellijMalformedOutputError extends ZellijError {}
export class ZellijNoSessionError extends ZellijError {}
export class ZellijPipeExitedError extends ZellijError {}
export class ZellijStartupTimeoutError extends ZellijError {}
export class ZellijReconciliationTimeoutError extends ZellijError {}
