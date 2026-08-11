# Exact-package interaction manifest

This manifest is tied to application commit `18be03ecfb760e91e41c8daa5f2dd6336a41b883` and AppImage SHA-256 `80d932bc237aff1a33bcdbe5ab0886f9a4edca677763f53aa88b9d6094d539dd`.

## Declaration inventory

[`source-control-inventory.json`](source-control-inventory.json) is the authoritative one-row-per-control declaration inventory. It contains 246 unique stable IDs from all rendered `button`, `input`, `select`, `textarea`, and `summary` declarations in `App.tsx`, `GlobalSearch.tsx`, and `ScenarioPlanningDialog.tsx`. Each row records source location, role, accessible-name expression, conditional prerequisites, disabled expression, expected visible behavior, and pointer/keyboard operation. Of these declarations, 193 are conditional or repeated and 57 have a disabled state. Six calculate their name from runtime content and are explicitly marked `DYNAMIC_RENDERED_NAME`; the package scenarios exercise their rendered names.

Runtime traversal reconciled the source inventory against the following conditional surfaces: eight onboarding steps; shell navigation, Workspace, Add, and global search; Overview unavailable/available projection states; Activity filters, editable rows, import review, deletion, and file-dialog feedback; Plan disclosures, recurring rows, scenario/event/allocation dialogs, and empty goal summary; Net Worth empty/populated/edit/reconcile/delete states; Settings appearance, member-save failure/retry, backup/restore, corrupt startup, and unwritable startup. No additional intrinsic control declaration appeared at runtime outside the 246 source rows.

## Execution records

| Execution set | Profile/state | Pointer/keyboard | Appearance/layout | Result and evidence |
|---|---|---|---|---|
| Persistent shell matrix | Populated isolated profile | Both for navigation and Add; keyboard shortcuts/Escape for Search, Workspace, and dialogs | All 32 required combinations | 32/32 passed; `package/control-matrix/results.json` plus 32 screenshots |
| General acceptance | Long household/member names; populated ledger | Real WebDriver pointer/keyboard and native file dialogs | Light/dark, reduced motion, 920×650, 1024×768, 1280×820 | Passed; `package/final-full-suite/01`–`06` and layout screenshots |
| Financial records | Assets, liabilities, mortgage, relaunch | Pointer/keyboard | 1280×820 | Passed; exact-AppImage scenario |
| Deletion/import/export | Populated and mixed CSV | Pointer/keyboard and native dialogs | 1280×820 | Passed; exact-AppImage scenario |
| Onboarding variants | Fresh, interrupted, unsaved rollback, typed accounts | Pointer/keyboard | 1280×820 | Passed after stale route prerequisites were corrected |
| Scenario planning | Clone, event, allocation, persistence | Pointer/keyboard | 1280×820 | Passed; exact-AppImage scenario |
| System appearance | System resolving light/dark live | Pointer | 1280×820 | Passed; exact-AppImage scenario |
| Persistence failure | SQLite-trigger member save failure/retry | Pointer/keyboard focus assertions | 1280×820 | Passed; exact-AppImage scenario |
| Offline | Fresh strict network namespace | Pointer/keyboard | 1280×820 | Passed; exact-AppImage scenario |
| Recovery | Corrupt and unwritable profiles | Pointer/keyboard Retry | 1280×820 | 2/2 passed; `package/final-full-suite/07`–`08` |

## Coverage disposition

The 32-combination result is exhaustive for persistent shell controls and responsive observation. State-specific mutation, failure, import/export, and recovery controls passed in the same AppImage at their scenario viewport, but were not each repeated across all 32 combinations. Therefore the package has strong exact-runtime evidence but does not satisfy the plan's literal `246 declarations × every runtime instance × 32 combinations` completion gate. `PROD-001` remains Open in `FIXES.md`; no grouped row is presented as full control verification.
