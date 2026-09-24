// Defines the versioned NDJSON boundary between the TypeScript host and this plugin.
// Keeps wire parsing and serialization independent of Zellij internals so protocol failures are explicit.
// All messages carry the connection ID to prevent one pipe instance from accepting another's work.

use serde::{Deserialize, Serialize};

use crate::snapshot::WireSession;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum InputMessage {
    Init {
        protocol_version: u8,
        connection_id: String,
        purpose: Purpose,
    },
    Shutdown {
        protocol_version: u8,
        connection_id: String,
    },
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
    Install,
    Runtime,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum OutputMessage<'a> {
    Hello {
        protocol_version: u8,
        connection_id: &'a str,
        plugin_id: u32,
        plugin_version: &'a str,
    },
    InstallOk {
        protocol_version: u8,
        connection_id: &'a str,
    },
    Snapshot {
        protocol_version: u8,
        connection_id: &'a str,
        sequence: u64,
        sessions: &'a [WireSession],
        resurrectable_sessions: &'a [(String, std::time::Duration)],
    },
    Fatal {
        protocol_version: u8,
        connection_id: &'a str,
        code: &'a str,
        message: &'a str,
    },
    Bye {
        protocol_version: u8,
        connection_id: &'a str,
    },
}

pub fn parse_input(line: &str) -> Result<InputMessage, String> {
    serde_json::from_str(line).map_err(|error| format!("invalid protocol input: {error}"))
}

pub fn encode_output(message: OutputMessage<'_>) -> Result<String, String> {
    serde_json::to_string(&message)
        .map(|line| format!("{line}\n"))
        .map_err(|error| format!("failed to encode protocol output: {error}"))
}
