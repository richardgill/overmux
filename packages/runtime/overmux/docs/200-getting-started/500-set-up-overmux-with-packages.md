---
title: Set Up with Packages
---

To understand how Overmux works and how to configure your Overmux, start with the [reference docs](/docs/reference/project-structure). They cover your project structure, configuration, server, and browser UI.

To get the most out of Overmux you'll want to use some packages.

## What are packages?

Packages are building blocks for your Overmux. They can provide server functionality, UI components, or both.

Overmux packages are just standard npm packages you install and use in your Overmux project.

## Packages to start with

### Terminals with xterm and tmux

Use these two packages together to add interactive terminals backed by persistent tmux sessions.

- **[tmux](/docs/packages/tmux)** connects your Overmux to your machine's tmux sessions, windows, and panes. It provides live state, terminal streaming, and operations for controlling tmux, along with React components and hooks for your UI.
- **[xterm](/docs/packages/xterm)** renders an [xterm.js](https://xtermjs.org/) terminal in your browser. It handles terminal display and input, but doesn't start a shell or manage sessions.

Together, they let you interact with your terminals through Overmux UI while tmux keeps your sessions running when you disconnect.

Follow the package docs for installation and wiring examples.

### Source control with git

The **[git package](/docs/packages/git)** adds repository changes and diffs to your Overmux, with ready-made UI components for browsing them.

You choose which repository paths your server can access. You can also enable actions such as staging, unstaging, and discarding changes; write permissions are off by default.

## Explore more packages

Depending on your setup, you might also want:

- **[Zellij](/docs/packages/zellij)** for a Zellij-backed terminal setup instead of tmux. Experimental; compatibility is not guaranteed.
- **[Pi](/docs/packages/pi)** for viewing AI agent conversations and interacting with running agents. Experimental; compatibility is not guaranteed.
- **[JSONL store](/docs/packages/jsonl-store)** for storing schema-validated records in a local file.

Start with the pieces you need. Each package's documentation explains what it provides and how to connect it to your Overmux.
