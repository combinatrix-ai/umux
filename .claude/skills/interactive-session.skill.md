---
name: interactive-session
description: Manage interactive terminal sessions for REPLs, shells, and programs that require user input.
---

# Interactive Session Management

Use this skill for programs that require ongoing interaction:
- Python/Node/Ruby REPLs
- Database CLIs (psql, mysql, redis-cli)
- SSH sessions
- Interactive installers
- Programs with prompts

## MCP Tools Required

- `umux_spawn` - Create session
- `umux_send` - Send text input
- `umux_send_key` - Send special keys (Enter, Ctrl-C, Tab, etc.)
- `umux_wait` - Wait for prompts
- `umux_capture` - View current screen
- `umux_history` - Review past output
- `umux_kill` - Send signals (Ctrl-C equivalent)

## Common Workflows

### Python REPL

1. Start Python:
   ```
   umux_spawn(command: "python3", name: "python-repl")
   umux_wait(session: "python-repl", pattern: ">>>", timeout: 5000)
   ```

2. Execute code:
   ```
   umux_send(session: "python-repl", text: "print('hello')", newline: true)
   umux_wait(session: "python-repl", pattern: ">>>", timeout: 5000)
   umux_capture(session: "python-repl")
   ```

3. Exit:
   ```
   umux_send(session: "python-repl", text: "exit()", newline: true)
   ```

### Database CLI

1. Connect to PostgreSQL:
   ```
   umux_spawn(command: "psql -U postgres", name: "psql")
   umux_wait(session: "psql", pattern: "postgres[=#]", timeout: 10000)
   ```

2. Run queries:
   ```
   umux_send(session: "psql", text: "SELECT * FROM users LIMIT 5;", newline: true)
   umux_wait(session: "psql", pattern: "postgres[=#]", timeout: 5000)
   umux_capture(session: "psql")
   ```

### Handling Prompts

For confirmation prompts (y/n):
```
umux_wait(session: <id>, pattern: "\\[y/n\\]|\\(yes/no\\)", timeout: 30000)
umux_send(session: <id>, text: "y", newline: true)
```

For password prompts:
```
umux_wait(session: <id>, pattern: "password:", timeout: 10000)
umux_send(session: <id>, text: "<password>", newline: true)
```

### Sending Special Keys

Interrupt a running process (Ctrl-C):
```
umux_send_key(session: <id>, key: "c", ctrl: true)
```

Tab completion:
```
umux_send_key(session: <id>, key: "Tab")
umux_wait(session: <id>, idle: 500)
umux_capture(session: <id>)
```

Navigate with arrows:
```
umux_send_key(session: <id>, key: "Up")
```

Exit programs (Ctrl-D):
```
umux_send_key(session: <id>, key: "d", ctrl: true)
```

Clear screen (Ctrl-L):
```
umux_send_key(session: <id>, key: "l", ctrl: true)
```

## Tips

- Use `pattern` waits with regex for flexible prompt matching
- Use `idle` waits when output timing is unpredictable
- Use `umux_history(tail: 100)` to see recent output if capture misses it
- Keep sessions alive for multi-step interactions
- Use meaningful names like "psql-dev" or "node-debug"
- Always clean up with `umux_destroy` when done
