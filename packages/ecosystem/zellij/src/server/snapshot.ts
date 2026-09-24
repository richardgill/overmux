// Converts an already validated plugin snapshot into the retained public Zellij state.
// Cross-field checks keep corrupt pane-to-tab joins from becoming authoritative backend state.
// This pure boundary is shared by initial and repeated SessionUpdate messages.

import type { PluginMessage } from "../shared/plugin-protocol";
import { zellijStateSchema, type ZellijState } from "../shared/state-contract";
import { ZellijMalformedOutputError } from "../install/errors";

type SnapshotMessage = Extract<PluginMessage, { type: "snapshot" }>;

export const stateFromSnapshot = (
  id: string,
  snapshot: SnapshotMessage,
): ZellijState => {
  snapshot.sessions.forEach((session) =>
    session.tabs.forEach((tab) => {
      if (
        tab.panes.some(
          (pane) =>
            pane.tab_id !== tab.info.tab_id ||
            pane.tab_position !== tab.info.position ||
            pane.tab_name !== tab.info.name,
        )
      ) {
        throw new ZellijMalformedOutputError(
          `Zellij plugin returned a pane joined to the wrong tab in session ${session.name}.`,
        );
      }
    }),
  );
  return zellijStateSchema.parse({
    backend: { id },
    connected: true,
    sessions: snapshot.sessions,
  });
};
