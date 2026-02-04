# Claude TUI Usage Monitor (umux vs tmux)

These scripts demonstrate how to automate a TUI application (Claude Code CLI) to extract usage information.

## The Task

1. Spawn Claude CLI
2. Wait for it to be ready
3. Send `/status` command
4. Navigate to the "Usage" tab
5. Capture and display the screen
6. Clean up the session

## umux vs tmux Comparison

| Step | umux | tmux |
|------|------|------|
| Create session | 1 line | 1 line |
| Wait for startup | `spawn --block-until-screen-match` (1 line) | Polling loop (8 lines + sleep) |
| Send /status | 1 line (send + wait combined) | 5 lines (autocomplete menu workaround) |
| Wait for dialog | Included in `--block-until-screen-match` | Polling loop (7 lines) |
| Tab navigation | Loop with `--block-until-idle` | Loop + fixed sleep |
| Wait for Usage | Not needed (capture + loop) | Polling loop (7 lines) |
| Capture screen | `capture` | `capture-pane -p` |
| Delete session | `rm` | `kill-session` |

## Results

| | umux | tmux |
|---|------|------|
| Lines of code | 35 | 61 |
| Execution time (median) | 5.58s | 6.68s |

umux version is ~**43% fewer lines** (35 vs 61) and ~**16% faster** (median).

Timing note: measured on this repo's `examples/claude-usage/get-claude-usage-*.sh` (10 runs, median). Runtime varies with Claude startup and network.

## Running

```bash
# umux version
./examples/claude-usage/get-claude-usage-umux.sh

# tmux version (requires tmux installed)
./examples/claude-usage/get-claude-usage-tmux.sh
```
