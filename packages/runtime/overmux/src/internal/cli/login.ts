import type { LoginGrant } from "../server/auth/auth-service";
import {
  discoverInstance,
  sendControlRequest,
} from "../server/auth/instance-control";

type CliOutput = Pick<NodeJS.Process, "stderr" | "stdout">;

export const issueLoginGrant = async (port?: number) => {
  const instance = await discoverInstance(port);
  const response = await sendControlRequest(instance, { type: "create-login" });
  return { login: response.login, port: instance.port };
};

export const printLoginFallback = (port: number, { stdout }: CliOutput) => {
  stdout.write(`Login with \`overmux auth login --port ${port}\`\n`);
};

export const printLoginGrant = ({
  login,
  output,
}: {
  login: LoginGrant;
  output: CliOutput;
}) => {
  const expiresIn = Math.max(
    0,
    Math.ceil((Date.parse(login.expiresAt) - Date.now()) / 60_000),
  );
  output.stdout.write(
    [
      `Code: ${login.code} (enter on the login page)`,
      "",
      ...(login.urls.length === 1
        ? [`Login URL: ${login.urls[0]}`]
        : ["Login URLs:", ...login.urls.map((url) => `  ${url}`)]),
      "",
      `Expiry in ${expiresIn} minutes (at ${login.expiresAt}).`,
      "",
      "",
    ].join("\n"),
  );
  output.stderr.write(
    `Keep the code and link${login.urls.length === 1 ? "" : "s"} private.\n`,
  );
};
