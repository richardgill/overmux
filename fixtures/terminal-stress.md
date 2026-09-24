# Terminal stress fixture

Run `node fixtures/terminal-stress.ts --label left --seed left` in a tmux pane. It uses the terminal's current columns and rows, enters the alternate screen, writes one dense synchronized truecolor frame, then accepts input without producing more output.

Use a repeatable viewport with `--cols 243 --rows 59`. At that size, the default frame is intentionally Pi-like at about 16-30 KiB. Choose distinct `--label` or `--seed` values for distinct deterministic frames. `--report` prints the synchronized frame byte count without entering the alternate screen or emitting the measured frame:

```sh
node fixtures/terminal-stress.ts --cols 243 --rows 59 --label left --seed left --report
```

Use `Ctrl-C` to restore the normal screen.
