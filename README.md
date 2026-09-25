> [!NOTE]
> **Experimental beta.** Come tinker! Expect rough edges and things to change.

# Overmux

Build your own development environment for you and your agents.

Extend your existing terminal setup with custom rich web interfaces for reviewing code, coordinating agents, and working from your phone.

Main features:

- Terminals with Tmux + xterm.js
- Desktop application
- Mobile PWA
- Git: `git status` + `git diff` information
- Plugins: npm package ecosystem

## Demo: My Overmux

## Why I Built Overmux

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

Herdr (a TUI) and Orca (web based) offer a decent default experience. But they lack the customizability I love with the terminal and neovim. They use their own muxer implementations and dictate workflows.

This future doesn't _spark joy_ for me, so I built Overmux to embed my terminal in a Desktop webapp and build my own experience with a mix of tmux terminals + custom web uis.


## Inspiration

Overmux was inspired by a few 

## License

[MIT](./LICENSE)
