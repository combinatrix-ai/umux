# umux TODO

## Open Questions

- [ ] CLI key specification syntax (`--key Ctrl-C` vs `--key ctrl+c` vs `--key C-c`)

## Implementation

- [ ] Set up package structure (monorepo with @umux/core, @umux/server, @umux/cli, @umux/client)
- [ ] Implement @umux/core
  - [ ] Session/Pane management
  - [ ] PTY spawning (node-pty)
  - [ ] History management
  - [ ] Event system
  - [ ] Key encoding
  - [ ] WaitFor / Watch
- [ ] Implement @umux/server
  - [ ] REST API
  - [ ] WebSocket API
  - [ ] SSE streaming
  - [ ] Hook system (Webhooks)
  - [ ] Authentication
- [ ] Implement @umux/cli
  - [ ] spawn, send, wait, logs, attach
  - [ ] hook management (add, ls, rm, test)
  - [ ] Remote connection (--host, --port, --token)
- [ ] Implement @umux/client
  - [ ] HTTP client
  - [ ] WebSocket client

## Documentation

- [x] API specification (docs/api.md)
- [x] CLI specification (docs/cli.md)
- [x] Server API specification (docs/server.md)
- [ ] README with quick start guide
- [ ] Architecture overview

## Future Ideas

- [ ] Plugin system
- [ ] Session persistence / restore
- [ ] Log rotation
- [ ] Metrics / observability
- [ ] tmux compatibility layer
