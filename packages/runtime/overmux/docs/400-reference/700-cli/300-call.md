---
title: "`overmux call`"
---

Invoke an operation on a running local Overmux server.

The CLI discovers the local instance and obtains a short-lived bearer credential through its private same-user control socket. Use `--port` to select an instance when multiple local servers are running.

## Usage

```text
overmux call [--input value] [--port value] <operation-name>
```

## Arguments

| Argument | Description | Required |
| --- | --- | --- |
| `operation-name` | Operation name | Yes |
## Options

| Flag | Description | Default |
| --- | --- | --- |
| `--input <value>, -i <value>` | Operation input as JSON |  |
| `--port <value>, -p <value>` | Running local server port |  |
