---
name: watch-process
description: Monitor background processes, development servers, and long-running tasks.
---

# Watch Background Processes

Use this skill for monitoring:
- Development servers (npm run dev, cargo watch)
- Log watchers (tail -f)
- Build processes
- Test watchers
- Background services

## MCP Tools Required

- `umux_spawn` - Start process
- `umux_wait` - Wait for events
- `umux_capture` - Check current state
- `umux_history` - Review logs
- `umux_list` - See all sessions
- `umux_kill` - Stop processes
- `umux_destroy` - Clean up

## Workflows

### Start a Development Server

1. Spawn the server:
   ```
   umux_spawn(command: "npm run dev", name: "dev-server", cwd: "/path/to/project")
   ```

2. Wait for it to be ready:
   ```
   umux_wait(session: "dev-server", pattern: "ready|listening|started", timeout: 60000)
   ```

3. Check for errors during startup:
   ```
   umux_wait(session: "dev-server", pattern: "ready|error", timeout: 30000)
   ```
   Then check the result's `reason` and `match` to determine success.

### Monitor Server Logs

Periodically check the screen:
```
umux_capture(session: "dev-server")
```

Or search history for errors:
```
umux_history(session: "dev-server", search: "error|exception|failed")
```

Get recent output:
```
umux_history(session: "dev-server", tail: 50)
```

### Run Build in Background

1. Start build:
   ```
   umux_spawn(command: "npm run build", name: "build")
   ```

2. Do other work, then check status:
   ```
   umux_list()
   ```
   Check if the build session's `isAlive` is false and `exitCode`.

3. Get build output:
   ```
   umux_history(session: "build", tail: 100)
   ```

### Watch for Specific Events

Wait for a pattern with rejection:
```
umux_wait(
  session: "dev-server",
  pattern: "ready",
  not: "error|failed",
  timeout: 30000
)
```

If `reason: "rejected"`, the error pattern matched first.

### Multiple Concurrent Processes

1. Start multiple sessions:
   ```
   umux_spawn(command: "npm run dev", name: "frontend")
   umux_spawn(command: "npm run api", name: "backend")
   umux_spawn(command: "docker compose up", name: "services")
   ```

2. List all sessions:
   ```
   umux_list()
   ```

3. Monitor specific ones:
   ```
   umux_capture(session: "frontend")
   umux_capture(session: "backend")
   ```

### Stop Processes

Graceful stop (SIGTERM):
```
umux_kill(session: "dev-server")
```

Force stop (SIGKILL):
```
umux_kill(session: "dev-server", signal: "SIGKILL")
```

Interrupt (like Ctrl-C):
```
umux_send_key(session: "dev-server", key: "c", ctrl: true)
```

### Clean Up

Remove a single session:
```
umux_destroy(session: "dev-server")
```

Clean up all sessions:
```
umux_list()
# Then destroy each one
umux_destroy(session: "frontend")
umux_destroy(session: "backend")
```

## Tips

- Always name your sessions for easy reference
- Use `not` patterns to detect failures early
- Check `isAlive` and `exitCode` to determine process state
- Use `history` for logs, `capture` for current screen
- Set reasonable timeouts based on expected behavior
- Clean up sessions when they're no longer needed
- Use `idle` waits for processes with sporadic output
