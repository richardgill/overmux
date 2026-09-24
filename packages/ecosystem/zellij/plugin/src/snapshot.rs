// Converts Zellij's documented SessionUpdate payload into Overmux's stable state shape.
// The plugin emits only state consumers need, avoiding a wire dependency on unrelated Zellij fields.
// Tab metadata is joined to panes here because Zellij indexes its pane manifest by tab position.

use serde::Serialize;
use zellij_tile::prelude::{PaneInfo, SessionInfo, SessionListSnapshot, TabInfo};

#[derive(Serialize)]
pub struct WireSession {
    name: String,
    tabs: Vec<WireTab>,
}

#[derive(Serialize)]
struct WireTab {
    info: TabInfo,
    panes: Vec<WirePane>,
}

#[derive(Serialize)]
struct WirePane {
    #[serde(flatten)]
    info: PaneInfo,
    tab_id: usize,
    tab_position: usize,
    tab_name: String,
}

pub type Snapshot = (Vec<WireSession>, Vec<(String, std::time::Duration)>);

fn wire_sessions(sessions: Vec<SessionInfo>) -> Vec<WireSession> {
    sessions
        .into_iter()
        .map(|session| {
            let mut pane_manifest = session.panes.panes;
            let tabs = session
                .tabs
                .into_iter()
                .map(|info| {
                    let panes = pane_manifest
                        .remove(&info.position)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|pane| WirePane {
                            info: pane,
                            tab_id: info.tab_id,
                            tab_position: info.position,
                            tab_name: info.name.clone(),
                        })
                        .collect();
                    WireTab { info, panes }
                })
                .collect();
            WireSession {
                name: session.name,
                tabs,
            }
        })
        .collect()
}

pub fn from_session_list(snapshot: SessionListSnapshot) -> Snapshot {
    (
        wire_sessions(snapshot.live_sessions),
        snapshot.resurrectable_sessions,
    )
}

pub fn from_session_update(
    sessions: Vec<SessionInfo>,
    resurrectable_sessions: Vec<(String, std::time::Duration)>,
) -> Snapshot {
    (wire_sessions(sessions), resurrectable_sessions)
}
