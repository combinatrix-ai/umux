# umux Server API Specification

HTTP server for remote umux access.

---

## Configuration

```typescript
interface ServerConfig {
  /** Unix socket path */
  socketPath?: string;

  /** Port to listen on (default: 7070) */
  port?: number;

  /** Host to bind to (default: localhost) */
  host?: string;

  /** Authentication */
  auth?: {
    type: 'token' | 'none';
    token?: string;
  };

  /** Registered hooks */
  hooks?: HookConfig[];
}
```

---

## REST API

### Sessions

#### `GET /sessions`
List all sessions.

#### `POST /sessions`
Spawn a new session.
Request: { "command": "bash", "name": "my-session", "cwd": "/path", "env": {} }

#### `GET /sessions/:id`
Get session details.

#### `DELETE /sessions/:id`
Destroy a session.

#### `POST /sessions/:id/send`
Send text to a session.
Request: { "data": "ls\n" }

#### `POST /sessions/:id/send-key`
Send a key.
Request: { "key": "Enter", "ctrl": false, ... }

#### `POST /sessions/:id/wait`
Wait for condition.
Request: { "condition": { "ready": true, "screenPattern": "Login", "timeout": 5000 } }

#### `GET /sessions/:id/history`
Get history.
Query: `?tail=20`, `?search=pattern`

#### `GET /sessions/:id/capture`
Capture current screen buffer.
Query: `?format=text` or `?format=ansi`

---

### Hooks

#### `GET /hooks`
List all registered hooks.

#### `POST /hooks`
Register a new hook.
Request:
```json
{
  "sessionId": "sess-abc123",
  "run": "notify-send 'Done'",
  "onReady": true,
  "once": true
}
```

#### `DELETE /hooks/:id`
Remove a hook.

---

## SSE Streaming

Endpoint: `GET /sessions/:id/stream`
Events: `output`, `exit`

```
GET /sessions/pane-xyz789/stream
Accept: text/event-stream
Authorization: Bearer <token>
```

Response:
```
event: output
data: {"paneId":"pane-xyz789","data":"line 1\n"}

event: output
data: {"paneId":"pane-xyz789","data":"line 2\n"}

event: exit
data: {"paneId":"pane-xyz789","exitCode":0}
```
