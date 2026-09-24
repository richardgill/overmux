# Changelog

## 6.0.0-overmux.2

- Handle Android non-composition text edits through input events only, preventing Gboard corrections from replaying stale textarea contents. Translate observed trailing deletions into terminal backspaces before inserting the correction.

- Document trusted-publisher verification for future releases and automatic npm provenance from public source repositories.

## 6.0.0-overmux.1

- Initial prepared Overmux build based on xterm.js 6.0.0. Adds input transformation for keyboard, text and paste, wheel magnitude handling, and OSC 8 underline behavior.
