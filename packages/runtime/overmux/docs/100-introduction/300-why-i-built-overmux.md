---
title: Why I Built Overmux
---

As AI coding agents have improved my time has shifted from:

- Writing code in an IDE
- Running commands manually

To:

- Talking to agents
- Reviewing code produced by agents
- Trying to "orient" myself in codebases and keep in touch with how things work
- Spawning and keeping track of agents
- Coding on my phone

I lived in a customized tmux setup. But kept noticing that that the terminal, for all it's glory, might not be the best place to build the experiences needed, especially for code review and mobile.

[Herdr](https://github.com/herdrdev/herdr) (a TUI) and [Orca](https://github.com/stablyai/orca) (web based) offer a decent default experience. But they lack the customizability I love with the terminal and neovim. They use their own muxer implementations and dictate workflows.

This future didn't _spark joy_ for me, so I built Overmux to embed my terminal in a Desktop webapp and build my own experience with a mix of tmux terminals + custom web uis.
