#!/usr/bin/env bash
set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing dependency: $1" >&2
    exit 2
  }
}

require umux
require jq
require rg

cols=140
rows=45

run_tag="ai-cli-compat-${$}-$(date +%s%N)"
session_ids=()

cleanup() {
  for id in "${session_ids[@]:-}"; do
    umux rm --id "$id" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*" >&2; return 1; }

best_effort_idle() {
  local id="$1"
  local ms="${2:-500}"
  local timeout="${3:-8000}"
  umux wait --id "$id" --block-until-idle "$ms" --timeout "$timeout" >/dev/null 2>&1 || true
}

best_effort_exit() {
  local id="$1"
  local timeout="${2:-15000}"
  umux wait --id "$id" --block-until-exit --timeout "$timeout" >/dev/null 2>&1 || true
}

spawn_id() {
  local name="$1"
  local cmd="$2"
  local id
  id="$(umux spawn -n "${run_tag}-${name}" "$cmd" --cols "$cols" --rows "$rows" --json --block-until-idle 800 --timeout 30000 | jq -r .id)"
  session_ids+=("$id")
  echo "$id"
}

assert_screen_contains() {
  local id="$1"
  local pattern="$2"
  local screen
  screen="$(umux capture --id "$id" --format text)"
  if ! printf '%s\n' "$screen" | rg -n --quiet "$pattern"; then
    echo "expected pattern not found: $pattern" >&2
    echo "---- screen (head) ----" >&2
    printf '%s\n' "$screen" | sed -n '1,200p' >&2
    return 1
  fi
}

codex_set_full_access() {
  local id="$1"

  # Open slash suggestions: type "/" (no Enter) then Down+Enter to select /permissions.
  umux send --id "$id" "/" >/dev/null
  best_effort_idle "$id" 300 5000
  umux send --id "$id" --key Down >/dev/null
  umux send --id "$id" --key Enter >/dev/null
  best_effort_idle "$id" 600 8000

  # Choose "2" (Full Access) then Enter.
  umux send --id "$id" "2" >/dev/null
  umux send --id "$id" --key Enter >/dev/null
  best_effort_idle "$id" 600 8000

  # Leave any modal.
  umux send --id "$id" --key Escape >/dev/null 2>&1 || true
  best_effort_idle "$id" 300 5000
}

test_codex() {
  require codex

  local id
  id="$(spawn_id "codex" "codex")"

  # Optional but makes network/tool gating less likely to block replies.
  codex_set_full_access "$id"

  # NOTE: codex is sensitive to timing; sending "text --enter" can fail to submit.
  umux send --id "$id" "Reply with reverse of YZZYX only." >/dev/null
  umux wait --id "$id" --block-until-idle 200 --timeout 3000 >/dev/null || true
  umux send --id "$id" --key Enter >/dev/null

  # Best-effort wait; then assert from screen capture (more stable than hard wait).
  umux wait --id "$id" --block-until-screen-match "XYZZY" --timeout 240000 >/dev/null 2>&1 || true
  best_effort_idle "$id" 1500 240000
  assert_screen_contains "$id" "XYZZY" || return 1

  # Exit Codex
  umux send --id "$id" --key Ctrl-D >/dev/null 2>&1 || true
  best_effort_exit "$id"
  if [[ "$(umux status --id "$id" --json | jq -r .isAlive)" = "true" ]]; then
    umux send --id "$id" --key Ctrl-C >/dev/null 2>&1 || true
    umux send --id "$id" --key Ctrl-C >/dev/null 2>&1 || true
    best_effort_exit "$id"
  fi

  if [[ "$(umux status --id "$id" --json | jq -r .isAlive)" = "true" ]]; then
    fail "codex: did not exit cleanly"
    return 1
  fi

  pass "codex (chat + exit)"
}

test_claude() {
  require claude

  local id
  id="$(spawn_id "claude" "claude")"

  umux send --id "$id" "Reply with reverse of YZZYX only." --enter >/dev/null
  umux wait --id "$id" --block-until-screen-match "XYZZY" --timeout 240000 >/dev/null 2>&1 || true
  best_effort_idle "$id" 1500 240000
  assert_screen_contains "$id" "XYZZY" || return 1

  umux send --id "$id" "/exit" --enter >/dev/null
  umux wait --id "$id" --block-until-exit --timeout 15000 >/dev/null || true

  if [[ "$(umux status --id "$id" --json | jq -r .isAlive)" = "true" ]]; then
    fail "claude: did not exit with /exit"
    return 1
  fi

  pass "claude (chat + /exit)"
}

test_gemini() {
  require gemini

  # Use prompt-interactive mode for a deterministic 1st response, then exit.
  local id
  id="$(umux spawn -n "${run_tag}-gemini-shell" bash --cols "$cols" --rows "$rows" --json --block-until-ready --timeout 20000 | jq -r .id)"
  session_ids+=("$id")

  umux send --id "$id" "gemini -i \"Reply with reverse of YZZYX only.\"" --enter >/dev/null
  umux wait --id "$id" --block-until-screen-match "XYZZY" --timeout 240000 >/dev/null 2>&1 || true
  best_effort_idle "$id" 1500 240000
  assert_screen_contains "$id" "XYZZY" || return 1

  umux send --id "$id" "/exit" --enter >/dev/null 2>&1 || true
  umux wait --id "$id" --block-until-ready --timeout 15000 >/dev/null 2>&1 || true

  umux send --id "$id" exit --enter >/dev/null 2>&1 || true
  best_effort_exit "$id"

  if [[ "$(umux status --id "$id" --json | jq -r .isAlive)" = "true" ]]; then
    fail "gemini: did not exit cleanly"
    return 1
  fi

  pass "gemini (chat + exit)"
}

main() {
  test_codex
  test_claude
  test_gemini
}

main "$@"
