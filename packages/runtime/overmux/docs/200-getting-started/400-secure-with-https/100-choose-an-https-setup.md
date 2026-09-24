---
title: Choose an HTTPS Setup
---

Your Overmux could expose sensitive information or access to your system. If you're exposing overmux anywhere other than localhost, it's a good idea to configure it with HTTPS. HTTPS protects login credentials and session traffic, and browsers require it to install Overmux as a PWA.

Choose a setup that matches how you want to access Overmux:

| Setup | How it works |
| --- | --- |
| [Tailscale Serve](./200-tailscale-serve.md) | Connect through a private Tailscale VPN so only devices connected to the VPN can access Overmux. |
| [Cloudflare Tunnel](./300-cloudflare-tunnel.md) | Connect through a public Cloudflare hostname, optionally protected by Cloudflare Access login. |
| [Self-hosted reverse proxy](./400-self-hosted-reverse-proxy.md) | Run your own reverse proxy and TLS certificates to securely forward requests to Overmux. |

