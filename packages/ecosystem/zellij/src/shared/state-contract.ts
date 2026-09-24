import { z } from "zod";

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const clientIdSchema = z.number().int().nonnegative();

export const zellijTabInfoSchema = z
  .object({
    active: z.boolean(),
    active_swap_layout_name: z.string().nullable(),
    are_floating_panes_visible: z.boolean(),
    display_area_columns: nonnegativeIntegerSchema,
    display_area_rows: nonnegativeIntegerSchema,
    has_bell_notification: z.boolean(),
    is_flashing_bell: z.boolean(),
    is_fullscreen_active: z.boolean(),
    is_swap_layout_dirty: z.boolean(),
    is_sync_panes_active: z.boolean(),
    name: z.string(),
    other_focused_clients: z.array(clientIdSchema),
    panes_to_hide: nonnegativeIntegerSchema,
    position: nonnegativeIntegerSchema,
    selectable_floating_panes_count: nonnegativeIntegerSchema,
    selectable_tiled_panes_count: nonnegativeIntegerSchema,
    tab_id: nonnegativeIntegerSchema,
    viewport_columns: nonnegativeIntegerSchema,
    viewport_rows: nonnegativeIntegerSchema,
  })
  .strict();

const paneInfoFields = {
  cursor_coordinates_in_pane: z
    .tuple([nonnegativeIntegerSchema, nonnegativeIntegerSchema])
    .nullable(),
  default_bg: z.string().nullable(),
  default_fg: z.string().nullable(),
  exit_status: z.number().int().nullable(),
  exited: z.boolean(),
  id: nonnegativeIntegerSchema,
  index_in_pane_group: z.record(
    z.string().regex(/^\d+$/),
    nonnegativeIntegerSchema,
  ),
  is_floating: z.boolean(),
  is_focused: z.boolean(),
  is_fullscreen: z.boolean(),
  is_held: z.boolean(),
  is_selectable: z.boolean(),
  is_suppressed: z.boolean(),
  pane_columns: nonnegativeIntegerSchema,
  pane_content_columns: nonnegativeIntegerSchema,
  pane_content_rows: nonnegativeIntegerSchema,
  pane_content_x: nonnegativeIntegerSchema,
  pane_content_y: nonnegativeIntegerSchema,
  pane_rows: nonnegativeIntegerSchema,
  pane_x: nonnegativeIntegerSchema,
  pane_y: nonnegativeIntegerSchema,
  tab_id: nonnegativeIntegerSchema,
  tab_name: z.string(),
  tab_position: nonnegativeIntegerSchema,
  terminal_command: z.string().nullable(),
  title: z.string(),
};

const pluginPaneSchema = z
  .object({
    ...paneInfoFields,
    is_plugin: z.literal(true),
    plugin_url: z.string().nullable(),
  })
  .strict();
const terminalPaneSchema = z
  .object({
    ...paneInfoFields,
    is_plugin: z.literal(false),
    pane_command: z.string().optional(),
    pane_cwd: z.string().optional(),
    plugin_url: z.null(),
  })
  .strict();

export const zellijPaneInfoSchema = z.discriminatedUnion("is_plugin", [
  pluginPaneSchema,
  terminalPaneSchema,
]);

export const zellijStateSchema = z
  .object({
    backend: z.object({ id: z.string().min(1) }).strict(),
    connected: z.boolean(),
    sessions: z.array(
      z
        .object({
          name: z.string().min(1),
          tabs: z.array(
            z
              .object({
                info: zellijTabInfoSchema,
                panes: z.array(zellijPaneInfoSchema),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type ZellijTabInfo = z.infer<typeof zellijTabInfoSchema>;
export type ZellijPaneInfo = z.infer<typeof zellijPaneInfoSchema>;
export type ZellijState = z.infer<typeof zellijStateSchema>;
export type ZellijSession = ZellijState["sessions"][number];
export type ZellijTab = ZellijSession["tabs"][number];
