# umux CLI Specification

Command-line interface for umux.

## Design Principles

1. **Non-blocking by default**: `spawn` / `send` return immediately
2. **Explicit blocking**: use `wait` or `--block-until-*` + `--timeout`
3. **Script-friendly**: stable stdout (IDs by default), optional `--json`

---

## Global Options

```bash
umux [--socket <path>] [--tcp] [--host <host>] [--port <port>] [--token <token>] <command>
```

| Option | Env Variable | Default | Description |
|--------|--------------|---------|-------------|
| `-S, --socket <path>` | - | (platform default) | Unix socket path / Windows named pipe |
| `--tcp` | - | - | Use TCP instead of a local socket |
| `--host <host>` | `UMUX_HOST` | `localhost` | Server host (when `--tcp`) |
| `--port <n>` | `UMUX_PORT` | `7070` | Server port (when `--tcp`) |
| `--token <token>` | `UMUX_TOKEN` | - | Auth token (recommended for TCP) |

## Environment Variables

User-settable:
- `UMUX_HOST`: default `--host` (TCP mode)
- `UMUX_PORT`: default `--port` (TCP mode)
- `UMUX_TOKEN`: default `--token` (auth token)
- `UMUX_DEFAULT_TIMEOUT`: default value for `--timeout` (milliseconds)
- `UMUX_LOG_DIR`: enable JSONL I/O logging (see below)
- `UMUX_LOG_INPUT=0`: disable input logging
- `UMUX_SERVER_START_TIMEOUT`: auto-start server wait (milliseconds, advanced; default: 15000)

---

## Server

umux auto-starts a background server on first use (local socket by default).

For debugging/container use, you can run the server in the foreground:

```bash
umux server [--socket <path>] [--tcp --host <host> --port <port>] [--token <token>] [--log-dir <dir>]
```

Notes:
- TCP on a non-loopback host requires `--token`.
- The CLI refuses to auto-start a TCP server for non-loopback hosts; use an SSH tunnel or start the server manually.

### Persistent I/O logs (JSONL)

If `UMUX_LOG_DIR` is set (or `umux server --log-dir <dir>`), each session appends JSONL (input + output) to:

```
<UMUX_LOG_DIR>/YYYY-MM-DD_sess-XXXXXXXX.log.jsonl
```

Notes:
- Logs may contain sensitive data.
- To disable input logging, set `UMUX_LOG_INPUT=0`.
  - Default is to log input; set `UMUX_LOG_INPUT=0` (or `false`/`no`/`off`) to disable.

---

## Docs & Examples

### `umux guide`

Show bundled docs and examples (useful when installed globally / in CI).

```bash
umux guide [topic] [--json]
```

Topics:
- `readme`: print `README.md`
- `cli`: print `docs/cli.md`
- `examples`: list files in `examples/`

`--json` prints the detected file locations (paths) for scripting.

### Remote usage (SSH tunnel)

Recommended approach: bind the server to loopback on the remote machine and access it via an SSH local port-forward (no public TCP bind).

```bash
# local: create a token
TOKEN=$(openssl rand -hex 16)

# local: start remote server (binds to 127.0.0.1 on the remote)
ssh ubuntu@machine "UMUX_TOKEN=$TOKEN nohup umux server --tcp --host 127.0.0.1 --port 7070 >/tmp/umux.log 2>&1 &"

# local: forward localhost:7070 -> remote localhost:7070
ssh -N -L 7070:127.0.0.1:7070 ubuntu@machine

# local: talk to the remote server through the tunnel
UMUX_TOKEN=$TOKEN umux --tcp --host 127.0.0.1 --port 7070 ls
```

---

## Commands

### `umux ls`

List sessions.

```bash
umux ls [--all] [--exited] [--limit <n>] [--json]
```

### `umux spawn`

Spawn an interactive session (shell, REPL, or other program).

```bash
umux spawn [program] [options]
```

Options:
- `-n, --name <name>`: session name
- `-d, --cwd <dir>`: working directory
- `--env <KEY=VALUE>`: environment variable (repeatable)
- `--cols <n>` / `--rows <n>`: terminal size
- `--block-until-*` + `--timeout <ms>`: block until condition is met (see below)
- `--json`: output JSON (`{ id, pid, wait? }`)

### `umux send`

Send text/keys to a session.

```bash
umux send [session-id] [text] [options]
```

Options:
- `--id <session-id>` / `--name <name>`: select a session (overrides positional)
- `--key <key>` / `--keys <keys>`: send special keys
- `--enter`: append Enter after text
- `--block-until-*` + `--timeout <ms>`: block until condition is met (see below)
- `--json`: output JSON when blocking

### Key Specification

Accepted by `umux send --key` / `--keys`:

- Special keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`
- Arrows: `Up`, `Down`, `Left`, `Right`
- Navigation: `Home`, `End`, `PageUp`, `PageDown`, `Insert`
- Function keys: `F1` .. `F12`
- Modifiers: `Ctrl-*`, `Alt-*`, `Shift-*`, `Meta-*` (e.g. `Ctrl-C`, `Alt-F`, `Shift-Tab`)

### `umux wait`

Wait for a condition on a session.

```bash
umux wait [session-id] [options]
```

Options:
- `--id <session-id>` / `--name <name>`: select a session
- `--block-until-*` + `--timeout <ms>`: wait for a condition (see below)
- `--until-*`: accepted as aliases for `--block-until-*`
- `--json`: output JSON

### Block Conditions

These flags are supported by `spawn`, `send`, and `wait`:

- `--block-until-ready`
- `--block-until-match <pattern>` (regex)
- `--block-until-screen-match <pattern>` (regex, matches current screen buffer)
- `--block-until-idle <ms>`
- `--block-until-exit`

`--timeout <ms>` is required unless `UMUX_DEFAULT_TIMEOUT` is set.

### `umux logs`

View session history (output by default).

```bash
umux logs [session-id] [--tail <n> | --head <n> | --all] [--search <pattern>] [--send-only]
```

Notes:
- Default output is the last 100 lines (`--tail 100`) to avoid dumping huge output to stdout in scripts and CI.
- `--send-only` shows only input sent to the session (if enabled).

### `umux capture`

Capture the current screen buffer.

```bash
umux capture [session-id] [--format text|ansi] [--json]
```

### `umux status`

Get session status.

```bash
umux status [session-id] [--is-ready] [--is-idle <ms>] [--json]
```

### `umux rm`

Remove a session (kills it first if alive).

```bash
umux rm [session-id] [--all|--exited]
```

### `umux kill`

Kill a session process.

```bash
umux kill [session-id] [--all] [--signal <signal>]
```

### `umux resize`

Resize a session terminal.

```bash
umux resize [session-id] --cols <n> --rows <n>
```

---

## Hooks

Hooks run local shell commands when events happen.

```bash
umux hook ls [--json]
umux hook add [session-id] --run <command> [--on-match <regex>] [--on-ready] [--on-exit] [--once]
umux hook rm <hook-id>
```

---

## Exit Codes

- `0`: success
- `1`: general error (including block-until timeout/rejection)
- `4`: not found (some commands)

---

## Examples

```bash
# Spawn, then wait for startup to settle
sid=$(umux spawn -n app "npm run dev")
umux wait --id "$sid" --block-until-idle 1000 --timeout 30000

# TUI: send a key, then capture screen
umux send --id "$sid" --key Tab --block-until-idle 200 --timeout 3000
umux capture --id "$sid" --format ansi

# Persist logs to disk (JSONL)
UMUX_LOG_DIR=/tmp/umux-logs umux spawn -n test bash
```
