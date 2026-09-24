import {
  createOvermuxHooks,
  defineCommandRegistry,
  defineOvermuxClient,
} from "overmux/client";

type ServerConfig = typeof import("../overmux.server").default;

const { useOperation, useResource } = createOvermuxHooks<ServerConfig>();
const commands = defineCommandRegistry<ServerConfig>()({});

const WorkspaceApp = () => {
  const workspace = useResource({ id: "workspaceState" });
  const reloadTmux = useOperation({ id: "reloadTmuxConfig" });

  if (workspace.status !== "success") {
    return <main>{workspace.error?.message ?? "Loading workspace…"}</main>;
  }

  return (
    <main>
      <button onClick={() => void reloadTmux.mutate()} type="button">
        Reload tmux config
      </button>
      <pre>{JSON.stringify(workspace.data, null, 2)}</pre>
    </main>
  );
};

export default defineOvermuxClient({
  commands,
  component: WorkspaceApp,
});
