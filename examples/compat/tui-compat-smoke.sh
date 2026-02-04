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
require git

cols=140
rows=45

tmp_dir="$(mktemp -d)"
session_ids=()
run_tag="tui-compat-${$}-$(date +%s%N)"

cleanup() {
  for id in "${session_ids[@]:-}"; do
    umux rm --id "$id" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

spawn_json() {
  local name="$1"
  local cmd="$2"
  umux spawn -n "${run_tag}-${name}" "$cmd" \
    --cols "$cols" --rows "$rows" \
    --json \
    --block-until-idle 500 --timeout 30000
}

spawn_id() {
  local name="$1"
  local cmd="$2"
  spawn_json "$name" "$cmd" | jq -r .id
}

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*" >&2; return 1; }

best_effort_idle() {
  local id="$1"
  local ms="${2:-300}"
  local timeout="${3:-5000}"
  umux wait --id "$id" --block-until-idle "$ms" --timeout "$timeout" >/dev/null 2>&1 || true
}

best_effort_exit() {
  local id="$1"
  local timeout="${2:-8000}"
  umux wait --id "$id" --block-until-exit --timeout "$timeout" >/dev/null 2>&1 || true
}

assert_screen_contains() {
  local id="$1"
  local pattern="$2"
  local screen
  screen="$(umux capture --id "$id" --format text)"
  printf '%s\n' "$screen" | rg -n --quiet "$pattern" || {
    printf '%s\n' "$screen" | sed -n '1,40p' >&2
    return 1
  }
}

test_htop() {
  require htop
  local id
  id="$(umux spawn -n "${run_tag}-htop" htop --cols "$cols" --rows "$rows" --json --block-until-screen-match "htop" --timeout 8000 | jq -r .id)"
  session_ids+=("$id")

  umux send --id "$id" --key F1 --block-until-idle 300 --timeout 5000 >/dev/null
  # htop help view is mostly plain text; match a stable line.
  assert_screen_contains "$id" "Press any key to return\\.|F10 q: quit|show this help screen" || return 1

  umux send --id "$id" --key Escape >/dev/null
  umux send --id "$id" --key Down >/dev/null
  best_effort_idle "$id"

  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "htop (F1 help, Down, q quit)"
}

test_btop() {
  require btop
  local id
  id="$(spawn_id "codex-btop" "btop")"
  session_ids+=("$id")

  umux send --id "$id" '?' >/dev/null
  best_effort_idle "$id" 500 10000
  assert_screen_contains "$id" "\\bhelp\\b|Key:" || return 1

  umux send --id "$id" --key Escape >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "btop (? help, Esc, q quit)"
}

test_glances() {
  require glances
  local id
  id="$(spawn_id "codex-glances" "glances")"
  session_ids+=("$id")

  umux send --id "$id" h >/dev/null
  best_effort_idle "$id" 500 10000
  assert_screen_contains "$id" "HELP|Help" || return 1

  umux send --id "$id" q >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "glances (h help, q back, q quit)"
}

test_ncdu() {
  require ncdu
  local base id
  base="$tmp_dir/ncdu"
  mkdir -p "$base/a" "$base/b"
  head -c 1024 </dev/urandom >"$base/a/file1"
  head -c 2048 </dev/urandom >"$base/b/file2"

  id="$(spawn_id "codex-ncdu" "ncdu -x $base")"
  session_ids+=("$id")

  umux send --id "$id" '?' >/dev/null
  best_effort_idle "$id"
  assert_screen_contains "$id" "ncdu help|Use the arrow keys" || return 1

  umux send --id "$id" q >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "ncdu (? help, q back, q quit)"
}

test_ranger() {
  require ranger
  local base id s0 s1
  base="$tmp_dir/ranger"
  mkdir -p "$base"
  touch "$base/aaa" "$base/bbb" "$base/ccc"

  id="$(spawn_id "codex-ranger" "ranger $base")"
  session_ids+=("$id")

  s0="$(umux capture --id "$id" --format text)"
  umux send --id "$id" j >/dev/null
  best_effort_idle "$id"
  s1="$(umux capture --id "$id" --format text)"
  [[ "$s0" != "$s1" ]] || return 1

  umux send --id "$id" '?' >/dev/null
  best_effort_idle "$id"
  assert_screen_contains "$id" "File Type Classification|ranger" || return 1

  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "ranger (j move, ? preview change, q quit)"
}

test_mc() {
  require mc
  local base id
  base="$tmp_dir/mc"
  mkdir -p "$base"
  touch "$base/aaa" "$base/bbb" "$base/ccc"

  id="$(spawn_id "codex-mc" "mc $base")"
  session_ids+=("$id")

  umux send --id "$id" --key F1 >/dev/null
  best_effort_idle "$id"
  assert_screen_contains "$id" "Help|Midnight Commander" || return 1

  umux send --id "$id" --key Escape >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" --key F10 >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" --key Enter >/dev/null || true
  best_effort_exit "$id"
  pass "mc (F1 help, Esc, F10 quit)"
}

test_nnn() {
  require nnn
  local base id s0 s1
  base="$tmp_dir/nnn"
  mkdir -p "$base"
  touch "$base/aaa" "$base/bbb" "$base/ccc"

  id="$(spawn_id "codex-nnn" "nnn $base")"
  session_ids+=("$id")

  s0="$(umux capture --id "$id" --format text)"
  umux send --id "$id" j >/dev/null
  best_effort_idle "$id"
  s1="$(umux capture --id "$id" --format text)"
  [[ "$s0" != "$s1" ]] || return 1

  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "nnn (j move, q quit)"
}

test_vifm() {
  require vifm
  local base id s0 s1
  base="$tmp_dir/vifm"
  mkdir -p "$base"
  touch "$base/aaa" "$base/bbb" "$base/ccc"

  id="$(spawn_id "codex-vifm" "vifm $base")"
  session_ids+=("$id")

  s0="$(umux capture --id "$id" --format text)"
  umux send --id "$id" j >/dev/null
  best_effort_idle "$id"
  s1="$(umux capture --id "$id" --format text)"
  [[ "$s0" != "$s1" ]] || return 1

  umux send --id "$id" ":q" --enter >/dev/null
  best_effort_exit "$id"
  pass "vifm (j move, :q<Enter> quit)"
}

test_lazygit() {
  require lazygit
  local repo id
  repo="$tmp_dir/repo-lazygit"
  mkdir -p "$repo"
  (
    cd "$repo"
    git init -q
    echo hello >README.md
    git add README.md
    git -c user.email=a@b.c -c user.name=test commit -qm "init"
  )

  id="$(spawn_id "codex-lazygit" "lazygit -p $repo")"
  session_ids+=("$id")

  # Close first-run popup if present, then open keybindings.
  umux send --id "$id" --key Enter >/dev/null
  best_effort_idle "$id" 500 10000
  umux send --id "$id" '?' >/dev/null
  best_effort_idle "$id" 500 10000
  assert_screen_contains "$id" "Keybindings" || return 1

  umux send --id "$id" q >/dev/null
  best_effort_exit "$id"
  pass "lazygit (? keybindings, q quit)"
}

test_tig() {
  require tig
  local repo id
  repo="$tmp_dir/repo-tig"
  mkdir -p "$repo"
  (
    cd "$repo"
    git init -q
    echo hello >README.md
    git add README.md
    git -c user.email=a@b.c -c user.name=test commit -qm "init"
  )

  # Avoid umux spawn --cwd here (we saw intermittent chdir failures in long runs).
  id="$(spawn_id "tig-shell" "bash")"
  session_ids+=("$id")

  umux send --id "$id" "cd $repo" --enter >/dev/null
  umux wait --id "$id" --block-until-ready --timeout 10000 >/dev/null

  umux send --id "$id" tig --enter >/dev/null
  best_effort_idle "$id" 800 20000

  umux send --id "$id" h >/dev/null
  best_effort_idle "$id"
  assert_screen_contains "$id" "Quick reference for tig keybindings" || return 1

  # Exit help -> exit tig -> exit shell
  umux send --id "$id" q >/dev/null
  best_effort_idle "$id"
  umux send --id "$id" q >/dev/null
  umux wait --id "$id" --block-until-ready --timeout 10000 >/dev/null || true

  umux send --id "$id" exit --enter >/dev/null
  best_effort_exit "$id"
  pass "tig (h help, q back, q quit)"
}

main() {
  require rg
  local failed=0

  test_htop || failed=1
  test_btop || failed=1
  test_glances || failed=1
  test_ncdu || failed=1
  test_ranger || failed=1
  test_mc || failed=1
  test_nnn || failed=1
  test_vifm || failed=1
  test_lazygit || failed=1
  test_tig || failed=1

  if [[ "$failed" -ne 0 ]]; then
    echo "One or more tests failed." >&2
    exit 1
  fi
}

main "$@"
