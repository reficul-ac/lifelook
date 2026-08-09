# CI and packaging audit

- Commit: `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71`
- Local host: Ubuntu 24.04, Linux 6.17; Node 22.22.2; npm 11.15.0; rustc 1.97.1; cargo 1.97.1.
- Actions: run `31287128922`, Ubuntu 22.04 / Node 20 / Rust stable, failed at AppImage packaging: https://github.com/reficul-ac/lifelook/actions/runs/31287128922
- Initial worktree: pre-existing untracked `CLAUDE.md`; no tracked modifications.

## Gate dispositions

| Command/gate | Result | Evidence |
|---|---|---|
| `npm ci` | Pass; reports 5 dev-dependency advisories | `npm-ci.log` |
| `npm test` | Pass: 2 files, 12 tests | `npm-test.log` |
| `npm run build` | Pass | `npm-build.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: 3 tests | `cargo-test.log` |
| `npm run appimage` | Fail, exit 134 after release executable builds | `npm-appimage.log` |
| release binary smoke under isolated `XDG_DATA_HOME` + Xvfb | Process remained alive for 10 seconds (timeout 124) and created SQLite/WebKit state | terminal result; AppImage behavior remains blocked |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Fail | `cargo-fmt.log` |
| strict Clippy (`--all-targets --all-features -- -D warnings`) | Fail: 2 `manual_repeat_n` errors | `cargo-clippy.log` |
| `npm audit --omit=dev` | Pass: 0 vulnerabilities | `npm-audit-production.log` |
| `npm audit` | Fail: 5 dev-tree advisories (3 moderate, 1 high, 1 critical), rooted in Vitest/Vite's esbuild tree | `npm-audit-full.log` |
| Rust dependency audit | Blocked: `cargo-audit` is not installed and CI does not install/run it | `cargo-audit.log` (empty due unavailable command; terminal captured `no such command: audit`) |
| AppImage launch and artifact upload | Blocked by packaging; workflow skips both after failure | `github-actions-failed.log` |

## Findings

### CI-PKG-1 — AppImage cannot be produced (P1)

`npm run appimage` and Actions both abort with `couldn't find a square icon to use as AppImage icon`, even though square PNG assets exist. `src-tauri/tauri.conf.json:8` omits `bundle.icon`, so the bundler receives no configured icon candidates. This blocks the documented AppImage command, packaged launch, and artifact upload.

Fix: declare explicit bundle icon paths (including a square PNG appropriate for Linux) in `bundle.icon`, then build on Ubuntu 22.04. Acceptance: `npm run appimage` exits 0; exactly one executable AppImage exists; its desktop metadata/icon are valid; the workflow smoke and artifact steps execute and upload a nonempty artifact.

### CI-PKG-2 — CI omits formatting and strict lint gates (P2)

The current tree fails `cargo fmt --check` in `src-tauri/build.rs:1` and `src-tauri/src/main.rs:1`, and strict Clippy at `src-tauri/src/lib.rs:261` and `:286`. Workflow lines 15–19 only test/build/package, so these regressions are green until packaging.

Fix: format the two entrypoints, replace/justify the two repeat/take expressions, and add explicit format and strict Clippy steps before the expensive release build. Acceptance: both commands above exit 0 locally and in Actions.

### CI-PKG-3 — CI has no dependency-advisory policy (P2)

Production npm dependencies currently audit clean, but the full lockfile reports five advisories through Vitest's nested Vite/esbuild versions. Rust auditing is absent and could not be locally evaluated because `cargo-audit` is not provisioned.

Fix: upgrade the test toolchain to patched compatible versions, add `npm audit --omit=dev` as a blocking production gate, define a reviewed policy for dev advisories, install pinned `cargo-audit` (or use a pinned audit action), and audit `src-tauri/Cargo.lock`. Acceptance: production audit and Rust audit pass; any dev advisory exception is explicit, scoped, and expiring.

### CI-PKG-4 — Packaged smoke is only a liveness timeout (P2)

Workflow line 21 treats a 20-second timeout as success. It does not prove that a window rendered, onboarding/persistence worked, export worked, or relaunch succeeded, despite `PLAN.md:65-66`. The upload step also lacks `if-no-files-found: error` and explicit uniqueness/nonempty validation.

Fix: drive the packaged AppImage under Xvfb with a fresh profile, assert a visible window and core UI marker, complete a minimal mutation, relaunch and verify it, exercise export, then cleanly terminate. Before upload, assert exactly one nonempty executable AppImage and set missing artifacts to error. Acceptance: deliberate blank-window, crash, missing artifact, persistence, and export failures each make CI fail.

## README command coverage

`npm run check` is composed of the independently passing test/build/Rust-test commands. `npm run appimage` is documented but fails as above. `npm run web:dev` and `npm run dev` are long-running development servers rather than finite verification gates. The README uses `npm install` for developer setup while CI correctly uses reproducible `npm ci`; recommend documenting `npm ci` for clean checkout verification.
