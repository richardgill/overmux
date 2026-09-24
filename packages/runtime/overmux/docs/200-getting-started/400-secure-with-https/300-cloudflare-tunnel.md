---
title: Cloudflare Tunnel
---

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) publishes Overmux through a Cloudflare-managed hostname without opening an inbound port on your network. You need a domain managed by Cloudflare.

## Create the tunnel

[Install `cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/), authenticate it, and create a tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create overmux
cloudflared tunnel route dns overmux overmux.example.com
```

Create `~/.cloudflared/config.yml` using the tunnel ID and credentials path printed by `cloudflared tunnel create`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: overmux.example.com
    service: http://127.0.0.1:4242
  - service: http_status:404
```

## Configure Overmux

Use the public HTTPS hostname as the authentication origin and trust only the local tunnel process:

```ts
export default defineOvermuxConfig({
  auth: {
    mode: "cli-login",
    origins: ["https://overmux.example.com"],
    trustedProxyPeer: "127.0.0.1",
  },
  host: "127.0.0.1",
  port: 4242,
  // ...
});
```

## Start Overmux and the tunnel

Start both processes:

```bash
overmux serve
cloudflared tunnel run overmux
```

Open `https://overmux.example.com`. Run `overmux auth login` to create a login link if authentication is enabled.

The hostname is publicly reachable unless you restrict it. Use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/) when you want an additional identity check before requests reach Overmux.

See Cloudflare's [tunnel setup guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/) for service installation and production operation.
