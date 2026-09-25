> [!NOTE]
> **Experimental beta.** Come tinker! Expect rough edges and things to change.

# Overmux

Build your own development environment for you and your agents.

Extend your existing terminal setup with custom rich web interfaces for reviewing code, coordinating agents, and working from your phone.

Main features:

- Terminals with tmux + xterm.js plugins
- Desktop application + mobile PWA
- Git plugin: `git status` + `git diff` information
- Plugins: npm package ecosystem

## Demo: My Overmux

## Get started

[Get started with Overmux](https://overmux.com/docs/getting-started/install-and-run-overmux), then make it your own.

To understand how the pieces fit together, read [How Overmux works](https://overmux.com/docs/introduction/how-overmux-works). Explore the [documentation](https://overmux.com/docs) for more.

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

[Herdr](https://github.com/herdrdev/herdr) (a TUI) and [Orca](https://github.com/stablyai/orca) (web based) offer a decent default experience. But they lack the customizability I love with the terminal and neovim. They use their own muxer implementations and dictate workflows.

This future didn't _spark joy_ for me, so I built Overmux to embed my terminal in a Desktop webapp and build my own experience with a mix of tmux terminals + custom web uis.


## Inspiration / Credits

Overmux was inspired by a few projects I like:

- [nvim](https://neovim.io/): configuration via code + plugins
- [pi](https://pi.dev/): plugins as TypeScript npm modules
- [vite](https://vite.dev/) + [tanstack](https://tanstack.com/) + [zod](https://zod.dev/) ❤️

## License

[MIT](./LICENSE)
