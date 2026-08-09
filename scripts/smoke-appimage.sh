#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mapfile -t appimages < <(find "$repo_root/src-tauri/target/release/bundle/appimage" -maxdepth 1 -type f -name '*.AppImage' -print)
[[ ${#appimages[@]} -eq 1 ]] || { echo "Expected exactly one AppImage" >&2; exit 1; }

profile_root="$(mktemp -d)"
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf -- "$profile_root"
}
trap cleanup EXIT INT TERM
export XDG_DATA_HOME="$profile_root/data"
export APPIMAGE_EXTRACT_AND_RUN=1
mkdir -p "$XDG_DATA_HOME" "$repo_root/artifacts/appimage-smoke"
app_log="$profile_root/app.log"

"${appimages[0]}" >"$app_log" 2>&1 &
app_pid=$!
window_id=""
for _ in $(seq 1 30); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "AppImage exited before showing its window" >&2
    cat "$app_log" >&2
    exit 1
  fi
  window_id="$(xdotool search --onlyvisible --name '^LifeLook$' 2>/dev/null | head -n 1 || true)"
  [[ -n "$window_id" ]] && break
  sleep 1
done
[[ -n "$window_id" ]] || { echo "No visible LifeLook window appeared" >&2; exit 1; }
sleep 2
import -window "$window_id" "$repo_root/artifacts/appimage-smoke/visible-window.png"
[[ -s "$repo_root/artifacts/appimage-smoke/visible-window.png" ]]

xdotool key --window "$window_id" alt+F4
for _ in $(seq 1 10); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    set +e
    wait "$app_pid"
    exit_status=$?
    set -e
    app_pid=""
    [[ $exit_status -eq 0 ]] || { echo "AppImage exited with status $exit_status" >&2; exit "$exit_status"; }
    exit 0
  fi
  sleep 1
done
echo "AppImage did not close normally" >&2
exit 1
