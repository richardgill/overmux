---
title: Tailscale Serve
---

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) gives Overmux a private HTTPS URL available to devices in your tailnet. Tailscale manages the certificate and forwards requests to Overmux over loopback.

## Configure Overmux

Set the first authentication origin to your machine's Tailscale HTTPS URL. Keep the server bound to the same loopback address and port that Tailscale Serve will target:

```ts
export default defineOvermuxConfig({
  auth: {
    mode: "cli-login",
    origins: ["https://your-machine.your-tailnet.ts.net"],
    trustedProxyPeer: "127.0.0.1",
  },
  host: "127.0.0.1",
  port: 4242,
  // ...
});
```

Replace the example origin with the hostname Tailscale assigns to your machine.

## Start Overmux and Tailscale Serve

Start Overmux:

```bash
overmux serve
```

In another terminal, publish its loopback listener through Tailscale Serve:

```bash
tailscale serve --bg http://127.0.0.1:4242
```

Open the HTTPS URL printed by Tailscale on another device in your tailnet. Run `overmux auth login` to create a login link if authentication is enabled.

Do not expose port 4242 directly or change `trustedProxyPeer` to a non-loopback address. Overmux trusts forwarded HTTPS and host information only from this immediate proxy peer.

See Tailscale's [Serve documentation](https://tailscale.com/docs/features/tailscale-serve) for installation, tailnet access controls, and command reference.
