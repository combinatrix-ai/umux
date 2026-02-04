---
name: run-command
description: Execute a command and capture its output. Better than Bash for long-running commands or commands that produce streaming output.
---

# Run Command with umux

Use this skill to run commands through umux when you need:
- Long-running processes (builds, tests, servers)
- Commands with streaming output
- Commands that may hang and need Ctrl-C
- Multiple commands in sequence with state preservation

## MCP Tools Required

- `umux_spawn` - Create a terminal session
- `umux_send` - Send commands
- `umux_wait` - Wait for completion
- `umux_capture` - Get screen output
- `umux_destroy` - Clean up session

## Steps

### 1. Create a session

```
umux_spawn()
```

Returns: `{ id, name, pid, cwd }`

### 2. Wait for shell to be ready

```
umux_wait(session: <id>, ready: true, timeout: 5000)
```

### 3. Send the command

```
umux_send(session: <id>, text: "<command>", newline: true)
```

### 4. Wait for command completion

For commands that return to shell prompt:
```
umux_wait(session: <id>, ready: true, timeout: 30000)
```

For commands that produce specific output:
```
umux_wait(session: <id>, pattern: "Done|Success|Error", timeout: 30000)
```

### 5. Capture the result

```
umux_capture(session: <id>)
```

Returns the current screen buffer with the command output.

### 6. Clean up (optional)

```
umux_destroy(session: <id>)
```

## Example: Running Tests

1. `umux_spawn(name: "tests")`
2. `umux_wait(session: "tests", ready: true)`
3. `umux_send(session: "tests", text: "npm test", newline: true)`
4. `umux_wait(session: "tests", ready: true, timeout: 120000)`
5. `umux_capture(session: "tests")`

## Tips

- Use meaningful session names for easy reference
- Set appropriate timeouts based on expected command duration
- Use `ready: true` for commands that return to shell prompt
- Use `pattern` for commands that don't return to prompt
- Use `idle` for commands that may produce output in bursts
- Check `umux_list()` to see all active sessions
