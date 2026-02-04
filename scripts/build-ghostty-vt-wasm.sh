#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ZIG_PROJ_DIR="$ROOT_DIR/zig"
GHOSTTY_DIR="$ROOT_DIR/vendor/ghostty"
ASSET_OUT="$ROOT_DIR/assets/umux-ghostty-vt.wasm"

if [[ ! -d "$ZIG_PROJ_DIR" ]]; then
  echo "Missing zig project dir: $ZIG_PROJ_DIR" >&2
  exit 1
fi

if [[ ! -d "$GHOSTTY_DIR" ]]; then
  echo "ghostty submodule missing at: $GHOSTTY_DIR" >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

required_zig_version="$(
  grep -E 'minimum_zig_version[[:space:]]*=[[:space:]]*\"[^\"]+\"' "$ZIG_PROJ_DIR/build.zig.zon" \
    | head -n 1 \
    | sed -E 's/.*minimum_zig_version[[:space:]]*=[[:space:]]*\"([^\"]+)\".*/\1/'
)"

if [[ -z "${required_zig_version:-}" ]]; then
  echo "Failed to detect minimum Zig version from $GHOSTTY_DIR/build.zig.zon" >&2
  exit 1
fi

ZIG_DIR="${ZIG_DIR:-$ROOT_DIR/.zig}"
ZIG_BIN="${ZIG_BIN:-$ZIG_DIR/$required_zig_version/zig}"

ensure_zig() {
  if [[ -x "$ZIG_BIN" ]]; then
    return 0
  fi

  mkdir -p "$ZIG_DIR/$required_zig_version"

  arch="$(uname -m)"
  case "$arch" in
    x86_64)
      platform="x86_64-linux"
      ;;
    aarch64 | arm64)
      platform="aarch64-linux"
      ;;
    *)
      echo "Unsupported architecture for Zig downloads: $arch" >&2
      exit 1
      ;;
  esac

  tarball="zig-$platform-$required_zig_version.tar.xz"
  url="https://ziglang.org/download/$required_zig_version/$tarball"

  echo "Downloading Zig $required_zig_version from $url" >&2
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/$tarball"

  tar -xf "$tmp/$tarball" -C "$tmp"
  extracted_dir="$(find "$tmp" -maxdepth 1 -type d -name "zig-$platform-$required_zig_version" | head -n 1)"
  if [[ -z "${extracted_dir:-}" ]]; then
    echo "Failed to extract Zig toolchain" >&2
    exit 1
  fi

  rm -rf "$ZIG_DIR/$required_zig_version"
  mv "$extracted_dir" "$ZIG_DIR/$required_zig_version"
  rm -rf "$tmp"
}

ensure_zig

PATCH_DIR="$ZIG_PROJ_DIR/patches"
applied_patches=()

cleanup_patches() {
  if [[ "${#applied_patches[@]}" -eq 0 ]]; then
    return 0
  fi
  for patch in "${applied_patches[@]}"; do
    # Best-effort revert; ignore failures.
    git -C "$GHOSTTY_DIR" apply --reverse "$patch" >/dev/null 2>&1 || true
  done
}
trap cleanup_patches EXIT

if [[ -d "$PATCH_DIR" ]]; then
  for patch in "$PATCH_DIR"/*.patch; do
    [[ -f "$patch" ]] || continue
    if git -C "$GHOSTTY_DIR" apply --reverse --check "$patch" >/dev/null 2>&1; then
      echo "Ghostty patch already applied: $(basename "$patch")" >&2
      continue
    fi
    if git -C "$GHOSTTY_DIR" apply --check "$patch" >/dev/null 2>&1; then
      echo "Applying Ghostty patch: $(basename "$patch")" >&2
      git -C "$GHOSTTY_DIR" apply "$patch"
      applied_patches+=("$patch")
      continue
    fi
    echo "Ghostty patch does not apply cleanly: $patch" >&2
    echo "Update the patch set or pin a compatible ghostty submodule commit." >&2
    exit 1
  done
fi

echo "Using Zig: $($ZIG_BIN version)" >&2

(
  cd "$ZIG_PROJ_DIR"
  "$ZIG_BIN" build wasm -Dtarget=wasm32-wasi -Doptimize=ReleaseSmall
)

candidate_a="$ZIG_PROJ_DIR/zig-out/bin/umux-ghostty-vt.wasm"
candidate_b="$ZIG_PROJ_DIR/zig-out/bin/umux-ghostty-vt"

if [[ -f "$candidate_a" ]]; then
  cp -f "$candidate_a" "$ASSET_OUT"
elif [[ -f "$candidate_b" ]]; then
  cp -f "$candidate_b" "$ASSET_OUT"
else
  echo "Expected wasm output not found. Checked:" >&2
  echo "  - $candidate_a" >&2
  echo "  - $candidate_b" >&2
  exit 1
fi

chmod 0644 "$ASSET_OUT"
echo "Wrote: $ASSET_OUT" >&2
