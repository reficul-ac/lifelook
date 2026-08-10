#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scenario="${1:?usage: run-recovery-acceptance.sh corrupt-profile|unwritable-profile}"
binary="${LIFELOOK_E2E_BINARY:-$repo_root/src-tauri/target/release/lifelook}"
profile_root="$(mktemp -d)"
cleanup() { chmod -R u+w "$profile_root" 2>/dev/null || true; rm -rf -- "$profile_root"; }
trap cleanup EXIT INT TERM

export XDG_DATA_HOME="$profile_root/data"
export LIFELOOK_E2E_BINARY="$binary"
export LIFELOOK_E2E_SCENARIO="$scenario"
export LIFELOOK_E2E_PROFILE="$XDG_DATA_HOME/com.lifelook.desktop/lifelook.db"
export XDG_DATA_DIRS="${XDG_DATA_DIRS_VSCODE_SNAP_ORIG:-/usr/local/share:/usr/share}"
unset GTK_EXE_PREFIX GTK_PATH GTK_IM_MODULE_FILE GIO_MODULE_DIR
mkdir -p "$(dirname "$LIFELOOK_E2E_PROFILE")" "${LIFELOOK_E2E_ARTIFACT_DIR:-$repo_root/artifacts/native-e2e}"

case "$scenario" in
  corrupt-profile)
    printf 'LifeLook corrupt profile fixture\000\377' > "$LIFELOOK_E2E_PROFILE"
    export LIFELOOK_E2E_CORRUPT_SHA256="$(sha256sum "$LIFELOOK_E2E_PROFILE" | cut -d ' ' -f 1)"
    ;;
  unwritable-profile)
    chmod 0555 "$(dirname "$LIFELOOK_E2E_PROFILE")"
    ;;
  *) echo "Unsupported recovery scenario: $scenario" >&2; exit 2 ;;
esac

cd "$repo_root"
set +e
timeout --signal=INT 30s xvfb-run -a --server-args="-screen 0 1280x820x24" npm run test:e2e:scenario
status=$?
set -e
evidence_dir="${LIFELOOK_E2E_ARTIFACT_DIR:-$repo_root/artifacts/native-e2e}"
evidence_name="07-corrupt-profile-recovery.png"
[[ "$scenario" == unwritable-profile ]] && evidence_name="08-unwritable-profile-repaired.png"
if [[ $status -ne 0 && ! ($status -eq 124 && -f "$evidence_dir/$evidence_name") ]]; then exit "$status"; fi

if [[ "$scenario" == corrupt-profile ]]; then
  test "$(sha256sum "$LIFELOOK_E2E_PROFILE" | cut -d ' ' -f 1)" = "$LIFELOOK_E2E_CORRUPT_SHA256"
else
  test -f "$LIFELOOK_E2E_PROFILE"
fi
