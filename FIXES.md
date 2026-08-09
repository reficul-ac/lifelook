# LifeLook Fixes and Usability Backlog

This is a current-branch backlog, not a snapshot of the original audit. `PLAN.md` describes product intent; this file records shipped, accepted, and still-blocked behavior.

## Verification record

- Reconciled branch: current worktree based on `d81bbf1855dfcc694f8970898f40db4d780b8314`.
- Reconciliation date: 2026-08-09 America/Los_Angeles.
- Current automated baseline: 19 frontend tests, 9 Rust tests, and 3 native WebDriver scenarios.
- Native evidence: `artifacts/native-e2e/`, generated from the release binary with isolated profiles.
- Terms used below:
  - **Implemented/component-tested** means code or an injected-repository test passed; it is not persistence evidence.
  - **Native accepted** means the release process and real SQLite profile were exercised.
  - **Still blocked** means the UI or required end-to-end evidence does not exist yet.

No P0 defect is known. Native acceptance now covers onboarding through relaunch, member edits, appearance preferences, supported viewport sizes, and startup recovery. AppImage-specific file dialogs, strict offline isolation, restore, and unavailable editing flows remain blocked.

## Coverage matrix

| Screen or flow | Current implementation | Native acceptance | Still blocked |
|---|---|---|---|
| Onboarding | Household, members, filing status, typed accounts, exact money parsing, and credit signs are implemented/component-tested | Account and household data survive process relaunch | Native add/remove/back/error interruption variants |
| Shell/navigation | All five destinations and honest disabled controls are implemented | Navigation, current state, focus, and 920×650 minimum accepted | Profile/search/add implementations |
| Overview | Current balances/activity totals are derived; projections require a saved tax profile | Opening/current account presentation exercised | Transaction-entry-driven reconciliation and broader planning inputs |
| Activity | Persisted postings, empty state, search, account/year filters, and transfer-neutral total are implemented | Search focus and empty persisted ledger exercised | Transaction creation/editing UI and seeded native filter fixture |
| Plan | Saved tax/current domain snapshot feeds deterministic projection; disclosure semantics implemented | Expanded rows accepted at 920×650, 1024×768, and 1280×820 with long names | Scenario selection/editing and full domain-entry UI |
| Net Worth | Current account balances, assets, liabilities, and credit signs are derived | Current onboarded account survives relaunch | Usable zero-state action and account/asset/liability editing |
| Settings members | Save busy/error/retry behavior is component-tested | Edited long member name survives relaunch | Native write-failure injection and calendar coverage |
| Appearance | System/light/dark and reduced motion persist | Dark and reduced motion survive process relaunch | Native OS preference-change simulation |
| Backup/restore | Backup/inspection Rust primitives exist | None | File selection, restore replacement, cancellation, and round trip |
| Startup recovery | Structured corrupt/unwritable recovery and Retry are component/Rust-tested | Corrupt bytes retain the same SHA-256; repaired permissions reopen the same profile | Packaged/AppImage recovery variant |
| Supply chain/CI | Production npm, policy-aware full npm, and pinned Rust audits gate CI | Not applicable | Temporary WebDriver-only exception tracked in `SECURITY.md` |
| AppImage | Build, content validation, visible-window smoke, and artifact upload gate CI | Prior hosted visible launch | Packaged mutation/relaunch and export/file-dialog validation |

## Interaction inventory

| ID | Interaction or claim | Status | Evidence or remaining work |
|---|---|---|---|
| I-001 | Fresh launch and household setup | Native accepted | `acceptance.e2e.js` |
| I-002 | Household/member validation and birth-date parsing | Implemented/component-tested | `App.test.tsx` |
| I-003 | Add/remove members during onboarding | Implemented/component-tested | Native variants still blocked |
| I-004 | Filing status and California profile | Implemented/component-tested | Saved in onboarding payload and bootstrap |
| I-005 | Account-kind radios and typed balances | Native accepted for checking; component-tested across kinds | Multi-account native variant blocked |
| I-006 | Exact USD parsing and supported maximum | Implemented/component/Rust-tested | Decimal strings use integer/BigInt cents; backend limit enforced |
| I-007 | Credit-card amount owed reduces net worth | Implemented/component/Rust-tested | Positive input normalizes to signed debt; migration repairs old positive credit balances |
| I-008 | Interrupted onboarding/relaunch | Partially native accepted | Completed onboarding survives relaunch; mid-step interruption remains blocked |
| I-009 | Overview current net worth/cash flow/tax labels | Implemented/component-tested | Derived from bootstrap; tax output withheld without profile |
| I-010 | Activity persisted rows, search, account/year filters | Implemented/component-tested | Native creation is blocked because entry UI is absent |
| I-011 | Plan expanders and monthly regions | Native accepted | Three supported viewports, including expanded rows |
| I-012 | Scenario comparison | Honestly unavailable | Selection/editing remains open |
| I-013 | Net Worth current balances and credit/liability sections | Implemented/component-tested | Account editing remains open |
| I-014 | Net Worth zero-account action | Still blocked | Empty copy exists, but Add account is intentionally disabled |
| I-015 | Settings member save, rejection, retained draft, retry | Implemented/component-tested | Successful member edit survives native relaunch |
| I-016 | Theme and reduced motion | Native accepted | Both persisted through process relaunch |
| I-017 | Search/add/profile controls | Honestly unavailable | Disabled-state regression coverage |
| I-018 | Backup and restore | Still blocked | Backend backup inspection does not provide a usable UI or restore replacement |
| I-019 | Keyboard focus, switch/radio/nav/disclosure semantics | Native accepted | Chart alternative remains tracked below |
| I-020 | Long names and responsive layouts | Native accepted | 920×650, 1024×768, and 1280×820 screenshots |
| I-021 | Corrupt-profile startup | Native accepted | Recovery UI displayed; SHA-256 unchanged |
| I-022 | Unwritable-profile startup and Retry | Native accepted | No database before repair; same path opens after chmod and Retry |
| I-023 | Offline launch | Still blocked | No strict network-namespace test |
| I-024 | npm/Rust advisory gates | Implemented | CI plus `SECURITY.md`; full npm report remains visible |
| I-025 | AppImage render/build/upload | Implemented in CI | Packaged persistence/export remains open |
| I-026 | README current-vs-future accuracy | Reconciled | Current quick start and unavailable features are explicitly separated |

## Deduplicated findings

### F-002 — Unimplemented global and creation controls

- **Status:** Narrowed; honestly disabled and component-tested.
- Profile, Search, Add, Add account, and backup/restore selection no longer masquerade as working actions.
- Implementing the underlying flows remains product work; see F-009 and F-015.

### F-003 — Activity used static mock data

- **Status:** Implemented/component-tested; native seeded-entry acceptance still blocked.
- Activity now reads bootstrap postings, derives the badge and total, filters by text/account/year, treats transfers as balance-neutral, and shows an honest empty state.
- Native entry creation cannot be accepted until transaction UI exists.

### F-004 — Overview presented fabricated guidance

- **Status:** Implemented/component-tested.
- Overview derives current net worth and current-year activity, distinguishes projected tax, and suppresses projection claims when the tax profile is missing.
- Future guidance remains bounded by the planning inputs currently exposed.

### F-005 — Plan and balances ignored persisted domain state

- **Status:** Implemented/component-tested; partially native accepted.
- Bootstrap includes current account balances, tax profile, activity, recurring items, assets, liabilities, and scenarios. Overview/Plan/Net Worth consume that snapshot.
- Scenario selection/editing and UI-driven seeded mutations remain blocked.

### F-006 — Credit-card sign handling increased net worth

- **Status:** Implemented/component/Rust-tested.
- Credit input is explicitly an amount owed, normalized to negative cents in frontend and backend, displayed as debt, and repaired by schema migration for older positive values.

### F-007 — Large USD values silently changed cents

- **Status:** Implemented/component/Rust-tested.
- Decimal strings are parsed exactly with a 12-digit-dollar limit and converted only after the cents value is safe; the backend enforces the matching maximum.

### F-008 — Filing status and onboarding scope mismatch

- **Status:** Narrowed.
- Filing status and the supported California tax profile are implemented and persisted. Income, expenses, assets, and debts are still not editable during onboarding and remain explicit pre-release work.

### F-009 — Backup/restore is incomplete

- **Status:** Still blocked (P1).
- Snapshot and inspection primitives exist, but file selection and safe atomic restore replacement do not. Disabled controls are truthful; they are not a recovery strategy.

### F-010 — Appearance reset on relaunch

- **Status:** Native accepted.
- System/light/dark settings are stored in SQLite; explicit dark survives process relaunch and system mode observes the OS media query.

### F-011 — Reduced motion was a no-op

- **Status:** Native accepted.
- The named switch updates persisted settings, sets the application motion state, and survives process relaunch.

### F-013 — Member-save failures were unhandled

- **Status:** Implemented/component-tested; successful persistence native accepted.
- Busy protection, announced/focused errors, draft retention, retry, and success refresh have regression coverage. Native disk-failure injection remains blocked.

### F-014 — Accessibility semantics were incomplete

- **Status:** Narrowed; radio/nav/disclosure/focus/contrast native accepted.
- Native tests cover labelled controls, current navigation, disclosure relationships, keyboard focus, and semantic text contrast. A complete nonvisual chart alternative remains open.

### F-015 — Net Worth empty state has no usable action

- **Status:** Still blocked (P2).
- The empty state is honest, but the Add account action is disabled because account editing is not implemented.

### F-016 — Startup corruption/permissions terminated before recovery

- **Status:** Native accepted.
- Separate release-binary scenarios show recovery UI, preserve corrupt bytes exactly, avoid replacement of an unwritable profile, and reopen through Retry after permissions are repaired.

### F-018 — Advisory policy was missing

- **Status:** Implemented.
- CI blocks `npm audit --omit=dev`, installs `cargo-audit` 0.22.2 with `--locked`, blocks Rust advisories, displays the full npm audit, and rejects anything outside the exact temporary exception in `SECURITY.md`.

### F-019 — Packaged smoke proved only liveness

- **Status:** Narrowed; still open for packaged persistence/export.
- CI validates AppImage contents, a visible window, native accessibility/recovery, and required artifact presence. The persistent-profile suite currently targets the release binary, not the AppImage, and export/file dialogs remain blocked.

### F-020 — README mixed shipped and future flows

- **Status:** Reconciled.
- The quick start describes reachable onboarding/current-balance/activity/appearance behavior, while creation/editing, CSV, scenarios, and backup/restore are explicitly marked unavailable.

## Prioritized repair sequence

1. Implement safe restore plus backup/restore file selection and cancellation (F-009).
2. Add transaction creation/editing and account editing, then native seeded Activity/current-balance relaunch coverage (F-003/F-005).
3. Implement scenario selection/editing and expose the remaining planning inputs (F-005/F-008).
4. Replace the Net Worth dead-end with a usable account action (F-015).
5. Add the chart nonvisual alternative, strict offline test, and remaining native failure/calendar variants (F-013/F-014).
6. Extend AppImage acceptance to mutation/relaunch and export/file-dialog behavior (F-019).

A finding is complete only when its observable acceptance criteria pass at the appropriate layer. Source inspection and component tests are never labeled as native persistence or packaged-runtime evidence.
