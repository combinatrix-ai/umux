# umux

**Stateful shell sessions with an API — tmux, but for agents.**

- Every blocking operation requires a timeout — no hanging forever
- No polling loops or fragile timing hacks — describe what you're waiting for
- No unbounded stdout — won't fill your context unexpectedly
- No interference between human and agent — work separately

**Example: Getting Claude Usage from TUI** 43% shorter, 16% faster — actually written by an agent
<table>
<tr>
<th>❌ tmux: poll + sleep + guess</th>
<th>✅ umux: declarative wait</th>
</tr>
<tr>
<td>

```bash
# Wait for startup - polling loop
for i in {1..30}; do
    sleep 1
    if tmux capture-pane -p | grep -q "Ready"; then
        break
    fi
done
sleep 2  # extra settle time (magic number)

# Send command with autocomplete workaround
tmux send-keys "/status"
sleep 0.3
tmux send-keys Escape  # close autocomplete menu
sleep 0.2
tmux send-keys Enter

# Wait for UI - more polling
for i in {1..20}; do
    sleep 0.3
    if tmux capture-pane -p | grep -q "Settings:"; then
        break
    fi
done

# After key presses, wait for UI to settle
# (magic number)
tmux send-keys Tab
sleep 0.5
```

</td>
<td>

```bash
# Wait for startup - one flag
umux spawn -n claude claude \
  --block-until-screen-match "Welcome" \
  --timeout 30000

# Send command + wait for UI - one line
umux send "/status" --enter \
  --block-until-screen-match "Settings:" \
  --timeout 10000

# After key presses, wait for UI to settle
# (fast, deterministic)
umux send --key Tab \
  --block-until-idle 200 \
  --timeout 3000
```

</td>
</tr>
<tr>
<td><strong>61 lines</strong></td>
<td><strong>35 lines</strong></td>
</tr>
<tr>
<td><strong>6.68s</strong> median runtime</td>
<td><strong>5.58s</strong> median runtime</td>
</tr>
</table>

→ [Full comparison](./examples/claude-usage/)

## Testimonials

> "When I wrote a script to automate Claude CLI with tmux, I spent most of my time fighting timing issues — polling loops, fixed sleeps, autocomplete menu workarounds. The same script with umux was **35 lines** vs **61 lines** with tmux, and about **16% faster** (median of 10 runs). The `--block-until-screen-match` and `--block-until-idle` options let me express *what* I want to wait for, not *how* to poll for it."
>
> — Claude, after writing the code above

---

## The problem

### The problem with exec()

When agents run shell commands, raw `exec()` has issues:
- **Can hang forever** — no timeout, blocks indefinitely
- **Output can explode** — stdout fills memory
- **No interactivity** — can't handle prompts, TUIs, REPLs

### The problem with tmux

So agents use tmux. But tmux is built for humans:
- **Keyboard capture** — `Ctrl-b` taken, input gets intercepted
- **Shared UI state** — panes, windows, scroll position conflict with human
- **Scrollback limits** — history truncated, designed for human eyes
- **Poll to wait** — no "wait until done" API, must poll + sleep + guess

We humans love tmux but it seems difficult for agents to work smoothly with tmux

### umux: shell sessions for agents

umux is a command execution environment designed for agents from the ground up:
- **No keybindings** — all input goes straight to the shell
- **No shared state** — observe sessions without interfering
- **Queryable history** — searchable in-memory history + optional JSONL disk logs
- **Declarative waiting** — `wait --block-until-*`, not poll loops
- **Mandatory timeouts** — never hang forever


### tmux vs umux

tmux is a great TUI for humans. But Agents need an API.

| | tmux | umux |
|---|------|------|
| **Interface** | TUI + keyboard shortcuts | CLI / API only |
| **Complexity** | Panes, windows, layouts | 1 session = 1 shell |
| **State** | Shared UI state (focus, scroll position) | Stateless observation |
| **Keybindings** | `Ctrl-b` prefix captured | None — all input goes to shell |
| **Waiting** | Poll `capture-pane` + sleep | `wait --block-until-ready`, `--block-until-match` |
| **History access** | Poll `capture-pane` | `logs` API (search, tail, head) |
| **Persistence** | None by default | Optional JSONL logs |
| **Timeouts** | Can block forever | Always required |

Plus: umux uses libghostty-vt (WASM) for terminal state and capture. In practice this is often faster than tmux, especially for long-running sessions and huge logs. See `scripts/bench/cat-throughput.mjs`.

---

## FAQ

### Why not just use screen/expect/pexpect?

**The problem with `exec()` (or expect)**

When agents run shell commands, raw `exec()` has issues:
- **Can hang forever** — no timeout, blocks indefinitely
- **Output can explode** — stdout fills memory
- **No interactivity** — can't handle prompts, TUIs, REPLs

Tools like `expect` and `pexpect` help with interactivity, but still require manual timeout handling and don't provide persistent sessions.

**The problem with tmux (or screen)**

So agents use tmux. But tmux is built for humans:
- **Keyboard capture** — `Ctrl-b` taken, input gets intercepted
- **Shared UI state** — panes, windows, scroll position conflict with human
- **Scrollback limits** — history truncated, designed for human eyes
- **Poll to wait** — no "wait until done" API, must poll + sleep + guess

We humans love tmux, but it's difficult for agents to work smoothly with it.

**umux** provides the best of both worlds: persistent interactive sessions (like tmux) with a declarative API (unlike tmux).

---

## Installation

Requirements
- Node.js 20+
- Linux, macOS, or Windows with WSL

```bash
npm install -g @combinatrix-ai/umux
```

Then, ask your agent to "use `umux` instead of tmux."

---

## Quick Start

```bash
# Spawn a shell
umux spawn bash

# Run commands (state is preserved)
umux send "cd /project && export FOO=bar" --enter
umux wait --block-until-ready --timeout 5000

umux send "npm install" --enter
umux wait --block-until-ready --timeout 60000

umux send "npm test" --enter
umux wait --block-until-ready --timeout 60000

# Check output
umux logs --tail 20

# Clean up
umux rm
```

---

## Key Features

### Simple Model

No panes. No windows. No layouts. Just sessions.

```bash
umux spawn bash      # Create a session
umux send "ls" --enter
umux logs            # See output
umux rm              # Done
```

### Persistent Shell State

Unlike one-shot `exec()`, shell state is preserved across commands:

```bash
umux send "cd /project" --enter
umux send "export TOKEN=secret" --enter
umux send "source .env" --enter
# cwd, env vars, aliases — all preserved
```

### Declarative Waiting

Say *what* you're waiting for, not *how* to poll for it:

```bash
umux wait --block-until-ready --timeout 60000           # Wait for shell prompt
umux wait --block-until-match "Success" --timeout 5000  # Wait for output pattern
umux wait --block-until-screen-match ">" --timeout 5000 # Wait for TUI state
umux wait --block-until-idle 500 --timeout 5000         # Wait for output to settle
```

All waits require `--timeout` (or set via `UMUX_DEFAULT_TIMEOUT`). No infinite hangs.

### Queryable History

Query history anytime. For long sessions, enable disk persistence via `UMUX_LOG_DIR`.

```bash
umux logs                    # Last 100 lines (default)
umux logs --tail 50          # Last 50 lines
umux logs --all              # All retained history
umux logs --search "error"   # Search
umux logs --send-only        # Audit what agent sent
```

Note: `umux logs` defaults to the last 100 lines to avoid accidentally dumping huge output to stdout in scripts and CI.

#### Optional: Persist I/O logs (JSONL)

If you want durable logs on disk, set `UMUX_LOG_DIR`. Each session appends JSONL (input + output) to:

```
YYYY-MM-DD_sess-XXXXXXXX.log.jsonl
```

Note: logs may contain sensitive data. Control input logging with `UMUX_LOG_INPUT=0`.

### Screen Capture

Snapshot the visible terminal (useful for TUIs):

```bash
umux capture                 # Plain text
umux capture --format ansi   # With colors
```

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `spawn [program]` | Start a session (default: `$SHELL`) |
| `send [text]` | Send text/keys to session |
| `wait` | Wait for a condition |
| `guide` | Print bundled docs/examples |
| `status` | Get session status |
| `logs` | View output history |
| `capture` | Snapshot current screen |
| `ls` | List sessions |
| `rm` | Remove session |
| `kill` | Kill session process |
| `resize` | Resize terminal |
| `hook` | Manage event hooks |
| `server` | Start the umux server (internal) |

See `umux <command> --help` for details, or [full CLI docs](./docs/cli.md).

---

## As a Library

```typescript
import { Umux } from '@combinatrix-ai/umux';
import { createGhosttyTerminalEngine } from '@combinatrix-ai/umux';

const umux = new Umux();
const session = await umux.spawn('python3');

await umux.waitFor(session.id, { pattern: />>>/, timeout: 5000 });

umux.send(session.id, 'x = 42\n');
await umux.waitFor(session.id, { ready: true, timeout: 5000 });

umux.send(session.id, 'print(x * 2)\n');
await umux.waitFor(session.id, { ready: true, timeout: 5000 });

console.log(session.history.tail(5));

umux.destroy();
```

### Using Ghostty VT (built-in)

umux uses Ghostty VT by default for fast `capture --format ansi` and robust screen state for TUIs.

To change engines:
- `UMUX_TERMINAL_ENGINE=xterm` (force legacy xterm engine)
- `UMUX_TERMINAL_ENGINE=ghostty` (default: Ghostty with xterm fallback)
- `UMUX_TERMINAL_ENGINE=ghostty-strict` (force Ghostty; fail instead of falling back)

```ts
import { Umux, createGhosttyTerminalEngine } from '@combinatrix-ai/umux';

const umux = new Umux({ terminalEngine: createGhosttyTerminalEngine });
```

#### Updating the bundled Wasm

- Ghostty source is vendored as a pinned git submodule at `vendor/ghostty` (run `git submodule update --init --recursive` after cloning).
- Rebuild the bundled Wasm with `npm run build:ghostty-vt-wasm` (writes `assets/umux-ghostty-vt.wasm`).

### WaitCondition Options

| Option | Type | Description |
|--------|------|-------------|
| `pattern` | `RegExp \| string` | Wait for output matching pattern |
| `screenPattern` | `RegExp \| string` | Wait for screen buffer matching pattern |
| `idle` | `number` | Wait for N ms of no output |
| `exit` | `boolean` | Wait for process exit |
| `ready` | `boolean` | Wait for shell to be ready |
| `timeout` | `number` | Timeout in milliseconds |
| `not` | `RegExp \| string` | Fail immediately if this pattern appears |


---

## License

MIT
