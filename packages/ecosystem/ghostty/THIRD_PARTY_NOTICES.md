# Third-party notices

`@overmux/ghostty` wraps [ghostty-web](https://github.com/coder/ghostty-web),
maintained by Coder and its contributors, and the
[Ghostty](https://github.com/ghostty-org/ghostty) terminal engine.
The `ghostty-web` JavaScript and WASM implementation is installed as a separate
npm dependency, not copied into this package. Its upstream license and notices
remain with that dependency.

The wrapper's isolated WASM lifecycle and immediate echo rendering workarounds
reference upstream ghostty-web issues [#141](https://github.com/coder/ghostty-web/issues/141)
and [#161](https://github.com/coder/ghostty-web/issues/161) in the source.
