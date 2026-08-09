#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle_dir="$repo_root/src-tauri/target/release/bundle/appimage"
mapfile -t appimages < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -print)

if [[ ${#appimages[@]} -ne 1 ]]; then
  echo "Expected exactly one AppImage, found ${#appimages[@]}" >&2
  exit 1
fi
appimage="${appimages[0]}"
[[ -s "$appimage" ]] || { echo "AppImage is empty: $appimage" >&2; exit 1; }
[[ -x "$appimage" ]] || { echo "AppImage is not executable: $appimage" >&2; exit 1; }

extract_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$extract_root"
}
trap cleanup EXIT INT TERM
(
  cd "$extract_root"
  "$appimage" --appimage-extract >/dev/null
)
desktop_file="$(find "$extract_root/squashfs-root" -type f -name '*.desktop' -print -quit)"
[[ -n "$desktop_file" ]] || { echo "AppImage has no desktop file" >&2; exit 1; }
grep -Eq '^Name=LifeLook$' "$desktop_file"
grep -Eq '^Icon=lifelook$' "$desktop_file"
find "$extract_root/squashfs-root/usr/share/icons" -type f -name '*.png' -size +0c -print -quit | grep -q .

echo "Validated AppImage: $appimage"
