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
export LIFELOOK_E2E_BACKUP="$profile_root/round-trip.lifelook"
export LIFELOOK_E2E_ACTIVITY_EXPORT="$profile_root/activity-export.csv"
export LIFELOOK_E2E_CSV="$profile_root/mixed.csv"
fixture_date="$(date +%Y)-02-15"
printf 'Date,Description,Amount\n%s,Imported pay,500.00\nnot-a-date,Invalid row,-5.00\n%s,Imported pay,500.00\n%s,Imported meal,-20.00\n' "$fixture_date" "$fixture_date" "$fixture_date" > "$LIFELOOK_E2E_CSV"

if [[ ! -x "$LIFELOOK_E2E_BINARY" ]]; then
  echo "Native release binary is missing or not executable: $LIFELOOK_E2E_BINARY" >&2
  exit 1
fi

cd "$repo_root"

run_scenario() {
  LIFELOOK_E2E_SCENARIO="$1" xvfb-run -a --server-args="-screen 0 1280x820x24" npm run test:e2e:scenario
}

reset_profile() {
  rm -rf -- "$XDG_DATA_HOME"
  mkdir -p "$XDG_DATA_HOME"
}

# The acceptance session deliberately relaunches against one isolated profile.
run_scenario acceptance

rm -rf -- "$XDG_DATA_HOME"
mkdir -p "$XDG_DATA_HOME"
run_scenario financial-records

rm -rf -- "$XDG_DATA_HOME"
mkdir -p "$XDG_DATA_HOME"
run_scenario ledger-deletion-import

# Keep onboarding behavior variants independent so interruption/relaunch state
# cannot hide failures in add/remove, Back, calendar, or typed-account behavior.
reset_profile
run_scenario onboarding-variants

# Scenario mutation uses its own profile and relaunches it to prove aggregate
# event/allocation persistence without coupling to the general acceptance flow.
reset_profile
run_scenario scenario-planning

reset_profile
LIFELOOK_E2E_SCENARIO=system-theme dbus-run-session -- xvfb-run -a --server-args="-screen 0 1280x820x24" npm run test:e2e:scenario

reset_profile
export LIFELOOK_E2E_PROFILE="$XDG_DATA_HOME/com.lifelook.desktop/lifelook.db"
run_scenario member-save-failure

# Bubblewrap creates a network namespace containing only loopback. The driver and
# application share it, while no host/external network interface is available.
reset_profile
export LIFELOOK_E2E_STRICT_OFFLINE=1
LIFELOOK_E2E_SCENARIO=offline-onboarding bwrap --unshare-net --bind / / \
  --dev-bind /dev /dev --proc /proc \
  xvfb-run -a --server-args="-screen 0 1280x820x24" npm run test:e2e:scenario
unset LIFELOOK_E2E_STRICT_OFFLINE

LIFELOOK_E2E_ARTIFACT_DIR="${LIFELOOK_E2E_ARTIFACT_DIR:-$repo_root/artifacts/native-e2e}" LIFELOOK_E2E_BINARY="$LIFELOOK_E2E_BINARY" bash scripts/run-recovery-acceptance.sh corrupt-profile
LIFELOOK_E2E_ARTIFACT_DIR="${LIFELOOK_E2E_ARTIFACT_DIR:-$repo_root/artifacts/native-e2e}" LIFELOOK_E2E_BINARY="$LIFELOOK_E2E_BINARY" bash scripts/run-recovery-acceptance.sh unwritable-profile
