import { z } from "zod";

import {
  tmuxPaneIdSchema,
  tmuxSessionIdSchema,
  tmuxWindowIdSchema,
} from "./tmux-values";

export const tmuxStateSchema = z
  .object({
    backend: z.object({ id: z.string().min(1) }).strict(),
    connected: z.boolean(),
    hierarchy: z
      .object({
        sessions: z.array(
          z
            .object({
              activeWindowId: tmuxWindowIdSchema,
              id: tmuxSessionIdSchema,
              name: z.string(),
              windows: z.array(
                z
                  .object({
                    activePaneId: tmuxPaneIdSchema,
                    id: tmuxWindowIdSchema,
                    index: z.number().int().nonnegative(),
                    name: z.string(),
                    panes: z.array(
                      z
                        .object({
                          currentCommand: z.string(),
                          id: tmuxPaneIdSchema,
                          inCopyMode: z.boolean(),
                          index: z.number().int().nonnegative(),
                          path: z.string(),
                          title: z.string(),
                        })
                        .strict(),
                    ),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type TmuxState = z.infer<typeof tmuxStateSchema>;
export type TmuxSession = TmuxState["hierarchy"]["sessions"][number];
export type TmuxWindow = TmuxSession["windows"][number];
export type TmuxPane = TmuxWindow["panes"][number];
