// Zellij plugin implementing Overmux's retained CLI-pipe protocol v1.
// Runtime is headless; installation briefly hosts the permission UI in a floating pane.
// Connection-specific pipe IDs isolate instances and keep shutdown cooperative.

mod protocol;
mod snapshot;

use protocol::{
    encode_output, parse_input, InputMessage, OutputMessage, Purpose, PROTOCOL_VERSION,
};
use snapshot::{from_session_list, from_session_update, Snapshot};
use zellij_tile::prelude::*;

const INITIALIZATION_TIMEOUT_SECONDS: f64 = 30.0;
const PLUGIN_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
struct OvermuxPlugin {
    bootstrap_install: bool,
    connection: Option<Connection>,
    permissions_granted: bool,
    // A fatal or shutdown message makes every later line and event inert, even within the same chunk.
    terminal: bool,
}

struct Connection {
    pipe_id: String,
    connection_id: String,
    purpose: Purpose,
    approved: bool,
    sequence: u64,
}

impl OvermuxPlugin {
    fn start(&mut self, pipe_id: String, connection_id: String, purpose: Purpose) {
        if purpose == Purpose::Runtime {
            // Pipe-launched plugins are floating panes in Zellij 0.45.1. Suppression is
            // permission-free and keeps the runtime representation out of the visible UI.
            hide_self();
        }
        self.connection = Some(Connection {
            pipe_id,
            connection_id,
            purpose,
            approved: false,
            sequence: 0,
        });
        set_timeout(INITIALIZATION_TIMEOUT_SECONDS);
        if self.permissions_granted {
            self.initialize();
        }
    }

    fn initialize(&mut self) {
        if self.terminal {
            return;
        }
        let Some(connection) = self.connection.as_mut() else {
            return;
        };
        if connection.approved {
            return;
        }
        block_cli_pipe_input(&connection.pipe_id);
        connection.approved = true;
        Self::send(
            connection,
            OutputMessage::Hello {
                protocol_version: PROTOCOL_VERSION,
                connection_id: &connection.connection_id,
                plugin_id: get_plugin_ids().plugin_id,
                plugin_version: PLUGIN_VERSION,
            },
        );
        if connection.purpose == Purpose::Install {
            Self::send(
                connection,
                OutputMessage::InstallOk {
                    protocol_version: PROTOCOL_VERSION,
                    connection_id: &connection.connection_id,
                },
            );
            unblock_cli_pipe_input(&connection.pipe_id);
            return;
        }
        match get_session_list() {
            Ok(session_list) => self.send_snapshot(from_session_list(session_list)),
            Err(error) => self.fatal("initial_snapshot_failed", &error),
        }
    }

    fn send_snapshot(&mut self, (sessions, resurrectable_sessions): Snapshot) {
        if self.terminal {
            return;
        }
        let Some(connection) = self.connection.as_mut() else {
            return;
        };
        if !connection.approved || connection.purpose != Purpose::Runtime {
            return;
        }
        connection.sequence += 1;
        Self::send(
            connection,
            OutputMessage::Snapshot {
                protocol_version: PROTOCOL_VERSION,
                connection_id: &connection.connection_id,
                sequence: connection.sequence,
                sessions: &sessions,
                resurrectable_sessions: &resurrectable_sessions,
            },
        );
    }

    fn shutdown(&mut self) {
        self.terminal = true;
        let Some(connection) = self.connection.as_ref() else {
            close_self();
            return;
        };
        Self::send(
            connection,
            OutputMessage::Bye {
                protocol_version: PROTOCOL_VERSION,
                connection_id: &connection.connection_id,
            },
        );
        unblock_cli_pipe_input(&connection.pipe_id);
        close_self();
    }

    fn fatal(&mut self, code: &str, message: &str) {
        self.terminal = true;
        if let Some(connection) = self.connection.as_ref() {
            Self::send(
                connection,
                OutputMessage::Fatal {
                    protocol_version: PROTOCOL_VERSION,
                    connection_id: &connection.connection_id,
                    code,
                    message,
                },
            );
            unblock_cli_pipe_input(&connection.pipe_id);
        }
        close_self();
    }

    fn send(connection: &Connection, message: OutputMessage<'_>) {
        match encode_output(message) {
            Ok(output) => cli_pipe_output(&connection.pipe_id, &output),
            Err(_) => {
                unblock_cli_pipe_input(&connection.pipe_id);
                close_self();
            }
        }
    }

    fn receive(&mut self, pipe_id: String, line: &str) -> bool {
        let input = match parse_input(line) {
            Ok(input) => input,
            Err(error) => {
                self.terminal = true;
                if self.connection.is_some() {
                    self.fatal("malformed_input", &error);
                } else {
                    unblock_cli_pipe_input(&pipe_id);
                    close_self();
                }
                return false;
            }
        };
        match input {
            InputMessage::Init {
                protocol_version,
                connection_id,
                purpose,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    self.start(pipe_id, connection_id, purpose);
                    self.fatal("protocol_mismatch", "unsupported protocol version");
                    return false;
                }
                if self.connection.is_some() {
                    self.fatal("duplicate_init", "connection is already initialized");
                    return false;
                }
                self.start(pipe_id, connection_id, purpose);
            }
            InputMessage::Shutdown {
                protocol_version,
                connection_id,
            } => {
                let Some(connection) = self.connection.as_ref() else {
                    return true;
                };
                if protocol_version != PROTOCOL_VERSION || connection.connection_id != connection_id
                {
                    self.fatal(
                        "protocol_mismatch",
                        "shutdown does not match this connection",
                    );
                } else {
                    self.shutdown();
                }
                return false;
            }
        }
        true
    }
}

impl ZellijPlugin for OvermuxPlugin {
    fn load(&mut self, configuration: std::collections::BTreeMap<String, String>) {
        // The installer opens this distinct pane only to host Zellij's approval UI. It must not
        // become a runtime connection or remain visible once Zellij reports the decision.
        self.bootstrap_install = configuration
            .get("purpose")
            .is_some_and(|purpose| purpose == "install");
        subscribe(&[
            EventType::PermissionRequestResult,
            EventType::SessionUpdate,
            EventType::Timer,
        ]);
        if self.bootstrap_install {
            set_timeout(INITIALIZATION_TIMEOUT_SECONDS);
        }
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::ReadCliPipes,
        ]);
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::PermissionRequestResult(PermissionStatus::Granted) => {
                self.permissions_granted = true;
                if self.bootstrap_install {
                    close_self();
                } else {
                    self.initialize();
                }
            }
            Event::PermissionRequestResult(PermissionStatus::Denied) => self.fatal(
                "permission_denied",
                "Zellij denied the required plugin permissions",
            ),
            Event::SessionUpdate(sessions, resurrectable_sessions) => {
                self.send_snapshot(from_session_update(sessions, resurrectable_sessions))
            }
            Event::Timer(_) => {
                if self.bootstrap_install {
                    close_self();
                } else if self
                    .connection
                    .as_ref()
                    .is_some_and(|connection| !connection.approved)
                {
                    self.fatal(
                        "initialization_timeout",
                        "permission approval did not arrive before timeout",
                    )
                }
            }
            _ => {}
        }
        false
    }

    fn pipe(&mut self, pipe_message: PipeMessage) -> bool {
        let PipeSource::Cli(pipe_id) = pipe_message.source else {
            return false;
        };
        if self.terminal {
            unblock_cli_pipe_input(&pipe_id);
            return false;
        }
        // Installation has already cached ReadCliPipes, so retain the opening event before stdin arrives.
        block_cli_pipe_input(&pipe_id);
        let Some(payload) = pipe_message.payload else {
            if self
                .connection
                .as_ref()
                .is_some_and(|connection| connection.pipe_id == pipe_id)
            {
                self.shutdown();
            }
            return false;
        };
        for line in payload.lines().filter(|line| !line.trim().is_empty()) {
            if !self.receive(pipe_id.clone(), line) {
                return false;
            }
        }
        false
    }
}

register_plugin!(OvermuxPlugin);
