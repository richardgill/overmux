---
title: Runtime library
---

# Runtime library

`@overmux/lib` contains small dependency-free helpers shared by Overmux runtime packages. It is private and not published to npm; its helpers are bundled into the runtime rather than exposed as an application integration API.

## Installation

`@overmux/lib` is private and bundled into the Overmux runtime. It is not installed directly.

## Delay

`delay` resolves after the requested number of milliseconds:

```ts
import { delay } from "@overmux/lib";

await delay(250);
```
