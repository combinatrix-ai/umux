#!/bin/bash
# get-claude-usage-tmux.sh (examples/claude-usage/)
# Script to extract model usage from the Claude TUI using tmux
# Usage: ./get-claude-usage-tmux.sh

# Generate a unique session name
SESSION_NAME="claude-usage-$$-$(date +%s)"

# Remove the session when the script exits
cleanup() {
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# Create a session and start claude
tmux new-session -d -s "$SESSION_NAME" "claude"

# Wait for Claude to start (poll until output looks ready)
for i in {1..30}; do
    sleep 1
    if tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | grep -q "Welcome"; then
        break
    fi
done
sleep 2  # extra settle time

# Send /status (press Escape to close the autocomplete menu, then Enter)
tmux send-keys -t "$SESSION_NAME" "/status"
sleep 0.3
tmux send-keys -t "$SESSION_NAME" Escape
sleep 0.2
tmux send-keys -t "$SESSION_NAME" Enter

# Wait for the Settings dialog to appear
for i in {1..20}; do
    sleep 0.3
    if tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | grep -q "Settings:"; then
        break
    fi
done
sleep 0.5

# Check whether usage info is visible; if not, press Tab to navigate
for i in 1 2 3; do
    if tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | grep -q "Current session"; then
        break
    fi
    tmux send-keys -t "$SESSION_NAME" Tab
    sleep 0.5
done

# Wait until usage info is visible
for i in {1..10}; do
    sleep 0.3
    if tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | grep -q "Current session"; then
        break
    fi
done

# Capture the final screen
tmux capture-pane -t "$SESSION_NAME" -p
