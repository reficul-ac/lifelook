# Adversarial reproduction report

Commit `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71`; reviewer: adversarial-reproduction. No P0 finding was reported or discovered. Review used fresh, corrupt, and unwritable XDG profiles, the release native executable, source inspection, focused numeric probes, existing tests, and CI logs. AppImage-only results remain blocked by CI-PKG-1.

## P1 verdicts

| Finding | Verdict | Independent evidence and rationale |
|---|---|---|
| CI-PKG-1 AppImage cannot be produced | **Confirmed** | Independent local `npm run appimage` and Actions run 31287128922 both reach a built release executable then abort exit 134 with `couldn't find a square icon`. `bundle.icon` is absent from `src-tauri/tauri.conf.json:8`, so existing square files are not configured candidates. |
| ONB-D1 missing filing-status/residency choice | **Confirmed** | Both setup steps were independently traced at `src/App.tsx:333-510`; only a disabled California input exists. The payload and backend transaction contain no tax profile. README explicitly instructs users to choose both. Static proof is complete even though packaged interaction is blocked. |
| ONB-D2 positive credit balance increases wealth | **Confirmed** | `validMoney` permits `125.40`; `toAccount` emits `12540`; backend persists that sign; snapshot includes all account balances as assets. There is no credit-kind normalization/constraint. This contradicts the nearby debt instruction and materially overstates net worth. |
| ONB-D3 large USD silently loses cents | **Narrowed** | The defect class is confirmed, but the report's exact `90071992547409.91` example happens to convert to the expected integer `9007199254740991`. Alternate accepted inputs prove the issue: `90071992547409.90` becomes `9007199254740991`, `.93` becomes `...994`, and `.99` becomes `...998` (`money-boundaries.log`). Keep the finding but replace its reproduction value/counterexample. P1 may be retained for silent financial mutation, though frequency is low. |

## Failure-profile findings

### ADV-D1 — Corrupt or unwritable profile terminates the application (P1, Confirmed)

With an invalid `lifelook.db` under a fresh XDG directory, the release executable exits 101 and panics `Failed to setup app ... file is not a database` (`corrupt-profile.log`). With an XDG directory mode `0555`, it exits 101 and panics `Permission denied` (`unwritable-profile.log`). The React error screen at `src/App.tsx:77-86` cannot render because database open/migration occurs in Tauri's setup hook before the webview starts (`src-tauri/src/lib.rs:450-463`), and `.expect` terminates the process.

Expected: a recoverable native error flow identifying the profile and offering safe retry/backup/restore or exit, without overwriting corrupt data. Fix: avoid setup-hook panic; preserve the database error as managed startup state or show a native dialog/recovery window, never auto-replace the corrupt DB. Acceptance: both seeded failures show an actionable error, retain the original bytes, and a repaired-permission/recovered-profile relaunch succeeds.

## Sampled P2 and pass verdicts

| Claim/finding | Verdict | Rationale |
|---|---|---|
| CI-PKG-2 missing fmt/Clippy gates | **Confirmed** | Replayed exact commands: fmt fails in the two one-line entrypoints; strict Clippy fails twice on `repeat().take()`. Workflow contains neither gate. |
| CI-PKG-3 audit policy gap | **Narrowed** | CI omission and five dev-tree npm advisories are confirmed; production npm audit is clean. Rust dependency vulnerability status itself is **Blocked**, not a defect claim, because `cargo-audit` is unavailable. |
| CI-PKG-4 smoke only checks liveness | **Confirmed** | Workflow success condition is timeout 124 only. It cannot distinguish a usable window from a hung/blank process and has no mutation, relaunch, persistence, accessibility, or export assertions. |
| ONB-D4 broader guided onboarding absent | **Narrowed** | Source confirms only people/accounts, but README status explicitly labels guided onboarding pre-release. Record the PLAN/current-copy conflict as P2, not a failure of an unequivocally shipped v1 feature. |
| Fresh native UI entirely blocked by WebKit loader | **Narrowed** | That agent's debug launch was genuinely blocked by a snap-library contamination, but the independently built release executable launches under Xvfb, remains alive, and creates SQLite state. Thus it is an environment-specific debug blocker, not evidence native LifeLook generally cannot render. Packaged behavior remains blocked. |
| Component onboarding passes establish persistence | **False positive if interpreted as native persistence** | Tests use an in-memory mock repository; the original report correctly avoided this interpretation. They establish payload contracts only. |
| Theme toggle pass | **Narrowed** | Component test proves immediate class change only. Theme is component state initialized false and is absent from repository/bootstrap, so persistence across relaunch is not established and source indicates it resets. |
| Account-type radio pass | **Narrowed** | Pointer/click selection is implementation-supported and sampled types pass component tests. Custom `button role=radio` controls implement no radio-group arrow-key behavior/roving tabindex, so the full keyboard radio interaction cannot be marked passed. |
| Duplicate onboarding submission concern | **Narrowed / not confirmed** | `saving` disables the submit button during awaited calls, providing ordinary repeat-click protection. There is no adversarial test for event races or a backend idempotency assertion, so retain as untested risk rather than a confirmed defect. |
| Settings save failure handling | **Confirmed as separate P2 defect candidate** | `savePeople` awaits repository mutation without `try/catch/finally`; rejection becomes an unhandled promise and no error status is shown. This differs from onboarding's caught error path. |
| Enabled Search/Add/profile/Activity filters/Overview links/scenario/backup/restore controls | **Confirmed defect family** | Source gives these enabled buttons no handlers. Backup inspection/write backend commands exist, but repository exposes neither and Settings buttons do not call them. Backend existence is not counter-evidence to an enabled UI no-op. Deduplicate by user flow/area rather than recording every button as a separate root cause when appropriate. |
| Activity's realistic August 2025 transactions and badge `12` | **Confirmed misleading-placeholder defect** | `ActivityView` uses literal merchant/payment rows and total; navigation badge is literal `12`, independent of persisted transactions. README status defers production transaction/import work, but enabled, realistic current UI still needs explicit sample labeling or an honest empty state. |
| Overview plan status/percentages | **Confirmed misleading-placeholder defect** | Retirement 2048, 6.5%, 2.5%, “on track,” and 92% are literal values; they are not derived from persisted assumptions. |

## Offline and packaged limits

Runtime logic uses local repository calls and no application network client was found. A strict network-namespace launch was not available in this environment, so offline launch is **Blocked** rather than passed. The AppImage does not exist; its launch, icon/desktop integration, persistence, and export remain **Blocked** until packaging is repaired. Native release liveness is useful counter-evidence to the debug loader problem but is not equivalent to packaged interaction.

## Reviewer reconciliation recommendations

1. Preserve all original evidence when changing ONB-D3's example to `.90`, `.93`, or `.99`.
2. Add ADV-D1 as a high-priority startup/recovery defect; the existing React load-error screen does not cover setup failures.
3. Treat mock/component passes as immediate UI contracts only, never SQLite/relaunch evidence.
4. Keep all AppImage-only rows blocked and all enabled no-op/realistic placeholder controls as defects.
5. No P0 exists. All P1s above have independent source/command reproduction; ONB-D3 is confirmed only with the narrowed alternate input.
