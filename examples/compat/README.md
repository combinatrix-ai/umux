# Compatibility Smoke Tests

These scripts are **examples** (not CI) that exercise `umux` with common interactive programs.

## Running

```bash
# Common TUIs (htop/btop/glances/ncdu/ranger/mc/nnn/vifm/lazygit/tig)
./examples/compat/tui-compat-smoke.sh

# AI CLIs (codex/claude/gemini): spawn -> 1 round-trip -> exit
./examples/compat/ai-cli-compat-smoke.sh
```

