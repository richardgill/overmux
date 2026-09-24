import { tmuxStateSchema } from "@overmux/tmux/shared";
import { z } from "zod";

export const piPaneSessionsSchema = z.array(
  z.object({ agentId: z.string().min(1), paneId: z.string().min(1) }).strict(),
);

export const workspaceStateSchema = z
  .object({
    agentByPaneId: z.record(
      z.string(),
      z.object({ agentId: z.string().min(1) }).strict(),
    ),
    tmux: tmuxStateSchema,
  })
  .strict();
