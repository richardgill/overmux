---
title: Self-hosted Reverse Proxy
---

Use this option when you already operate a domain, TLS certificates, and a reverse proxy such as Caddy, Nginx, or HAProxy.

Configure the proxy to:

- Terminate HTTPS for your public hostname.
- Forward HTTP and WebSocket requests to an Overmux loopback listener.
- Preserve the request host and send single-valued `X-Forwarded-Host` and `X-Forwarded-Proto: https` headers.

Configure Overmux with the exact public origin, loopback listener, and immediate proxy peer:

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

Do not expose the loopback backend directly or configure a non-loopback address as `trustedProxyPeer`.

For complete proxy-specific walkthroughs and example configurations, see Open WebUI's [HTTPS and reverse proxy guide](https://docs.openwebui.com/reference/https/). Adapt the upstream address and port to `http://127.0.0.1:4242`, and retain Overmux's origin and trusted-proxy configuration above.

You can also consult the official documentation for [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy), [Nginx](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/), or [HAProxy](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/proxying-essentials/).
