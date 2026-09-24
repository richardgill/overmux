---
title: Authentication and Security
---

Overmux includes authentication by default to make sure your terminals and agents are protected.

Overmux requires authentication to access its server APIs and your application's client bundle. Only the login page and its assets, authentication endpoints, and health check are accessible before login.

## Log in

Run `overmux serve` and open your server's URL in your browser. You'll be asked to enter a code.

On the server machine, as the same OS user running Overmux, run:

```sh
overmux auth login
```

Enter the code or open one of the printed login links.

- Codes and links expire after 10 minutes.
- Each code and its links share one login: using any one invalidates the others.
- Each browser, device, or origin (scheme, hostname, and port) needs its own login.

Your browser remembers your session across server restarts. Sessions have no server-side expiry by default; you can change this with [`auth.sessionLifetime`](./200-configuration.md#auth).

Use [`overmux auth`](./700-cli/200-auth.md) to list sessions or revoke access.

## How access is secured

Overmux trusts your OS account. Login creation and session administration use a local Unix socket protected by owner-only filesystem permissions, not a public HTTP endpoint. Stored authentication data is also owner-only, and credentials are stored as hashes.

Any process running as your OS user, or root, can administer access. Authentication does not protect against malicious software already running as your user.

Browser sessions use protected cookies. There are no separate accounts, roles, or read-only permissions: logging in grants access to everything your setup exposes. Keep login codes and links secret.

Remote browser access requires HTTPS and a configured allowed origin. Follow [Secure with HTTPS](../200-getting-started/400-secure-with-https/100-choose-an-https-setup.md).
