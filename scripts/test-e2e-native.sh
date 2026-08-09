#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$profile_root"
}
trap cleanup EXIT INT TERM

export XDG_DATA_HOME="$profile_root/data"
export LIFELOOK_E2E_BINARY="${LIFELOOK_E2E_BINARY:-$repo_root/src-tauri/target/release/lifelook}"
export XDG_DATA_DIRS="${XDG_DATA_DIRS_VSCODE_SNAP_ORIG:-/usr/local/share:/usr/share}"
unset GTK_EXE_PREFIX GTK_PATH GTK_IM_MODULE_FILE GIO_MODULE_DIR
mkdir -p "$XDG_DATA_HOME"

if [[ ! -x "$LIFELOOK_E2E_BINARY" ]]; then
  echo "Native release binary is missing or not executable: $LIFELOOK_E2E_BINARY" >&2
  exit 1
fi

cd "$repo_root"
xvfb-run -a --server-args="-screen 0 1280x820x24" npm exec wdio run ./wdio.conf.js
