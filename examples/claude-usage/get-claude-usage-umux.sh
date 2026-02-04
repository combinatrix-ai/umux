#!/bin/bash
# get-claude-usage-umux.sh (examples/claude-usage/)
# Script to extract model usage from the Claude TUI using umux
# Usage: ./get-claude-usage-umux.sh [timeout-ms]

# Generate a unique session name (safe for concurrent runs)
SESSION_NAME="claude-usage-$$-$(date +%s)"
TIMEOUT="${1:-10000}"

# Create session (wait until the Claude TUI is visible)
umux spawn claude -n "$SESSION_NAME" --block-until-screen-match "Welcome" --timeout 30000 >/dev/null

# Remove the session when the script exits
cleanup() {
    umux rm --name "$SESSION_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Send /status and wait for the Settings dialog to appear
umux send --name "$SESSION_NAME" "/status" --enter --block-until-screen-match "Settings:" --timeout "$TIMEOUT" >/dev/null 2>&1

# Check whether usage info is visible; if not, press Tab to navigate
if ! umux capture --name "$SESSION_NAME" 2>/dev/null | grep -q "Current session"; then
    for i in 1 2 3; do
        # Keep this fast: after Tab, just wait for the screen to settle briefly, then re-check.
        # A long screen-match timeout can add seconds of "waiting" if the target text isn't on this tab.
        umux send --name "$SESSION_NAME" --key Tab --block-until-idle 200 --timeout 3000 >/dev/null 2>&1
        if umux capture --name "$SESSION_NAME" 2>/dev/null | grep -q "Current session"; then
            break
        fi
    done
fi

# Capture the screen and print usage info
umux capture --name "$SESSION_NAME"
