# LifeLook Fixes and Usability Backlog

This is a current-branch backlog, not a snapshot of the original audit. `PLAN.md` describes product intent; this file records shipped, accepted, and still-blocked behavior.

## Verification record

- Reconciled branch: current worktree based on `d81bbf1855dfcc694f8970898f40db4d780b8314`.
- Reconciliation date: 2026-08-10 America/Los_Angeles.
- Current automated baseline: 58 frontend tests and 27 Rust tests. The release binary passed the general acceptance, financial-record, and live System-theme scenarios in this worktree; the built AppImage passed validation plus both isolated recovery variants. A complete native-suite rerun is still required before updating the final tested commit and aggregate native count.
- Native evidence: `artifacts/native-e2e/`, generated from the release binary with isolated profiles.
- Terms used below:
  - **Implemented/component-tested** means code or an injected-repository test passed; it is not persistence evidence.
  - **Native accepted** means the release process and real SQLite profile were exercised.
  - **Still blocked** means the UI or required end-to-end evidence does not exist yet.

No P0 defect is known. Native acceptance covers onboarding variants and interruption, strict-offline setup, member-save failure/retry, member edits, appearance preferences, ledger/account/asset/liability mutation, global search navigation and focus, mixed CSV import, filtering, reconciliation, backup/restore, supported viewport sizes, and startup recovery.

## Coverage matrix

| Screen or flow | Current implementation | Native acceptance | Still blocked |
|---|---|---|---|
| Onboarding | Household, members, filing status, typed accounts, recurring income/expenses, assets, debts, exact money parsing, and credit signs are implemented/component-tested | Add/remove/Back, guided financial inputs, calendar birth date, interruption/relaunch, and credit/investment/retirement accounts accepted | None for current scope |
| Shell/navigation | All five destinations, local global search, the six-mode Add menu, and an accessible keyboard-complete Workspace menu with path, Settings, and backup feedback are implemented/component-tested | Navigation, search navigation/focus, current state, focus, and 920×650 minimum accepted | Native Workspace-menu coverage |
| Overview | Current balances/activity totals are derived; projections require a saved tax profile | Transaction-driven income, spending, saved amount, and net worth survive relaunch | None for current scope |
| Activity | Manual/import/export/transfer deletion and reviewed CSV import are implemented with component and persistence-backed Rust coverage | Native filtering/export, global-search focus, mutation, editing, deletion, grouped transfers, mixed-file CSV import, exact totals, and relaunch persistence accepted | None for current scope |
| Plan | Recurring CRUD, all dated event variants, ordered surplus allocations, scenario CRUD/clone, dynamic horizons, selection, comparison, and all five priority-ordered funding-goal variants feed deterministic projections | Planning mutation, clone isolation, changed totals, allocations, and relaunch persistence accepted | Native five-goal persistence and clone-isolation coverage |
| Net Worth | Account, asset, liability, and scenario-linked asset/debt lifecycle editing; mortgage terms; signed credit balances; reconciliation; and guarded deletion are implemented/component/Rust-tested | Current-record CRUD and general scenario mutation/relaunch accepted | Native coverage of every scenario lifecycle variant |
| Settings members | Save busy/error/retry behavior is component-tested | Real SQLite failure, announced/focused error, retained draft, retry, calendar date, and relaunch persistence accepted | None for current scope |
| Appearance | System/light/dark and reduced motion persist; System follows GNOME `color-scheme` changes through the native bridge while retaining media-query support | Dark and reduced motion survive process relaunch; both live System changes passed under D-Bus | None for current scope |
| Backup/restore | Staged atomic backup/restore, confirmation, error recovery, and refresh are implemented | Native and packaged AppImage dialog round trips accepted, including relaunch persistence | None for current scope |
| Startup recovery | Structured corrupt/unwritable recovery and Retry are component/Rust-tested | Release and AppImage recovery runs preserve corrupt bytes and reopen the repaired same path | Full CI rerun/upload confirmation |
| Supply chain/CI | Zero-advisory production/full npm gates and pinned Rust audits gate CI; native tests use standalone WebdriverIO with Node's test runner | Not applicable | None for current scope |
| AppImage | Build, content validation, visible-window smoke, packaged mutation/export/restore/relaunch, reusable packaged recovery, and artifact upload gate CI | Packaged isolated-profile acceptance; both recovery variants passed locally with `APPIMAGE_EXTRACT_AND_RUN=1` | Full CI rerun/upload confirmation |

## Interaction inventory

| ID | Interaction or claim | Status | Evidence or remaining work |
|---|---|---|---|
| I-001 | Fresh launch and household setup | Native accepted | `acceptance.e2e.js` |
| I-002 | Household/member validation and birth-date parsing | Implemented/component-tested | `App.test.tsx` |
| I-003 | Add/remove members during onboarding | Native accepted | Isolated `onboarding-variants.e2e.js` profile |
| I-004 | Filing status and California profile | Implemented/component-tested | Saved in onboarding payload and bootstrap |
| I-005 | Account-kind radios and typed balances | Native accepted | Checking/savings plus isolated credit/investment/retirement coverage |
| I-006 | Exact USD parsing and supported maximum | Implemented/component/Rust-tested | Decimal strings use integer/BigInt cents; backend limit enforced |
| I-007 | Credit-card amount owed reduces net worth | Implemented/component/Rust-tested | Positive input normalizes to signed debt; migration repairs old positive credit balances |
| I-008 | Interrupted onboarding/relaunch | Native accepted | Committed household/calendar data restore after a mid-setup process relaunch |
| I-009 | Overview current net worth/cash flow/tax labels | Implemented/component-tested | Derived from bootstrap; tax output withheld without profile |
| I-010 | Activity creation/editing/deletion, grouped transfers, CSV import/export, search, account/year filters | Native and packaged accepted | Export is exactly filter-scoped and includes both transfer postings with signed RFC 4180 rows |
| I-011 | Plan expanders and monthly regions | Native accepted | Three supported viewports, including expanded rows |
| I-012 | Scenario comparison and planning mutation | Native accepted | Clone isolation, dated-event/allocation persistence, changed projected totals, and relaunch covered |
| I-013 | Net Worth current balances and credit/liability sections | Native accepted for current-record CRUD/persistence; scenario lifecycle editing implemented/component/Rust-tested | Native coverage of each asset/debt lifecycle event variant remains open |
| I-014 | Net Worth zero-account action | Implemented/component-tested | Add account opens the shared account dialog |
| I-015 | Settings member save, rejection, retained draft, retry | Native accepted | SQLite trigger injects a real write failure; focus, draft, retry, and relaunch persistence verified |
| I-016 | Theme and reduced motion | Native accepted | Both persisted through process relaunch |
| I-017 | Search/add/profile controls | Search and Add implemented; only Profile unavailable | Component coverage plus release-binary global-search acceptance |
| I-018 | Backup and restore | Native accepted | Staged atomic backup/restore, confirmation, recovery, immediate refresh, dialogs, and relaunch persistence are covered |
| I-019 | Keyboard focus, switch/radio/nav/disclosure semantics | Native accepted | Current no-history visualization exposes its state as semantic text; no chart is rendered |
| I-020 | Long names and responsive layouts | Native accepted | 920×650, 1024×768, and 1280×820 screenshots |
| I-021 | Corrupt-profile startup | Native accepted | Recovery UI displayed; SHA-256 unchanged |
| I-022 | Unwritable-profile startup and Retry | Native accepted | No database before repair; same path opens after chmod and Retry |
| I-023 | Offline launch | Native accepted | Isolated onboarding and relaunch pass inside a Bubblewrap network namespace |
| I-024 | npm/Rust advisory gates | Implemented | CI plus `SECURITY.md`; full npm report remains visible |
| I-025 | AppImage render/build/upload | Packaged accepted in CI | Visible smoke retained; isolated mutation, CSV dialog/content, backup/restore, and relaunch gate packaging |
| I-026 | README current-vs-future accuracy | Reconciled | Current quick start and unavailable features are explicitly separated |

## Deduplicated findings

### F-002 — Workspace control

- **Status:** Implemented/component-tested. The local Workspace menu is the Profile finding's resolution; it exposes the household, local profile path, Settings navigation, and backup action with keyboard navigation, focus restoration, loading, success, and error feedback. Native menu coverage remains to be added.
- Add now opens income, expense, transfer, account, asset, and debt creation. Net Worth creation controls and backup/restore selection are functional.
- Global Search indexes the current bootstrap snapshot locally, deduplicates transfers, and navigates to and focuses Activity, Plan, and Net Worth records. Release-binary acceptance covers `Ctrl+K` activation against a persisted transaction.

### F-003 — Activity used static mock data

- **Status:** Native accepted.
- Activity reads persisted postings, groups transfer postings, supports manual creation/editing, derives transfer-neutral totals, and filters by text/account/year.
- Release-binary acceptance creates and edits income, expense, and transfer entries, isolates current/prior/all-year and account/search results, and repeats critical assertions after relaunch against the same SQLite profile.

### F-004 — Overview presented fabricated guidance

- **Status:** Implemented/component-tested.
- Overview derives current net worth and current-year activity, distinguishes projected tax, and suppresses projection claims when the tax profile is missing.
- Future guidance remains bounded by the planning inputs currently exposed.

### F-005 — Plan and balances ignored persisted domain state

- **Status:** Narrowed; ledger/account-derived views native accepted.
- Bootstrap includes current account balances, tax profile, activity, recurring items, assets, liabilities, and scenarios. Overview/Plan/Net Worth consume that snapshot.
- Release-binary acceptance proves exact Overview and Net Worth values after transaction/transfer edits, second-account rename, reconciliation, and process relaunch.
- Scenario selection/comparison and create/clone/edit/delete are implemented. Recurring cash-flow CRUD drives projections. Asset and liability CRUD, mortgage terms, independent asset growth, and monthly debt amortization are implemented.

### F-006 — Credit-card sign handling increased net worth

- **Status:** Implemented/component/Rust-tested.
- Credit input is explicitly an amount owed, normalized to negative cents in frontend and backend, displayed as debt, and repaired by schema migration for older positive values.

### F-007 — Large USD values silently changed cents

- **Status:** Implemented/component/Rust-tested.
- Decimal strings are parsed exactly with a 12-digit-dollar limit and converted only after the cents value is safe; the backend enforces the matching maximum.

### F-008 — Filing status and onboarding scope mismatch

- **Status:** Narrowed.
- Filing status, the supported California tax profile, and guided income, expense, asset, and debt onboarding are implemented and persisted.

### F-009 — Backup/restore is incomplete

- **Status:** Native accepted.
- Settings provides filtered save/open dialogs, silent cancellation, busy protection, explicit destructive confirmation, announced/focused errors, and immediate workspace refresh. Native restore validates and migrates a staging copy, preserves the selected source, atomically replaces the live profile with rollback recovery, and returns the restored snapshot. Release-binary acceptance proves backup A, mutation B, immediate restore A, and persistence after relaunch.

### F-010 — Appearance reset on relaunch

- **Status:** Native accepted.
- System/light/dark settings are stored in SQLite; explicit dark survives process relaunch and system mode observes the OS media query.

### F-011 — Reduced motion was a no-op

- **Status:** Native accepted.
- The named switch updates persisted settings, sets the application motion state, and survives process relaunch.

### F-013 — Member-save failures were unhandled

- **Status:** Native accepted.
- Busy protection, announced/focused errors, draft retention, retry, success refresh, and relaunch persistence are exercised after a real SQLite trigger rejects the member update.

### F-014 — Accessibility semantics were incomplete

- **Status:** Native accepted for the current interface.
- Native tests cover labelled controls, current navigation, disclosure relationships, keyboard focus, and semantic text contrast. No chart is presently rendered: the empty visualization region exposes the complete “no dated balance history” state as ordinary semantic text.

### F-015 — Net Worth empty state has no usable action

- **Status:** Native accepted for account, asset, and liability creation plus account metadata editing and reconciliation.
- Net Worth uses shared account, asset, and debt dialogs; release-binary acceptance covers exact balances, mortgage persistence, deletion, and relaunch.

### F-021 — Transaction and account deletion

- **Status:** Native accepted.
- Manual, transfer, and imported transactions can be deleted individually; transfer postings are removed atomically, reconciliation adjustments and stale revisions are rejected, and import-batch audit metadata remains.
- Account deletion is limited to non-final empty accounts without posting, reconciliation, import, recurring-entry, or allocation references. Confirmation and blocker/error dialogs retain focus and state.
- Release-binary acceptance deletes manual and grouped-transfer activity atomically, deletes an empty account, rejects deletion of a blocked account, deletes an imported row, and proves the remaining state after relaunch.

### F-016 — Startup corruption/permissions terminated before recovery

- **Status:** Native accepted.
- Separate release-binary scenarios show recovery UI, preserve corrupt bytes exactly, avoid replacement of an unwritable profile, and reopen through Retry after permissions are repaired.

### F-018 — Advisory policy was missing

- **Status:** Implemented.
- CI blocks `npm audit --omit=dev`, installs `cargo-audit` 0.22.2 with `--locked`, blocks Rust advisories, displays the full npm audit, and rejects anything outside the exact temporary exception in `SECURITY.md`.

### F-019 — Packaged smoke proved only liveness

- **Status:** Implemented and packaged-accepted for persistence and file dialogs.
- CI retains the lightweight visible-window smoke and separately runs the built AppImage through onboarding, mutation, filtered CSV export/content verification, backup/restore, immediate refresh, and same-profile relaunch.

### F-020 — README mixed shipped and future flows

- **Status:** Reconciled.
- The quick start describes reachable onboarding, recurring and dated scenario planning, creation/editing, filtered CSV import/export, current-balance, appearance, and backup/restore behavior.

## Prioritized repair sequence

1. Native-accept all five shipped funding-goal variants, including edit/reorder/disable/delete, relaunch persistence, and clone isolation.
2. Add native Workspace-menu coverage and complete the full native/AppImage CI evidence rerun.

A finding is complete only when its observable acceptance criteria pass at the appropriate layer. Source inspection and component tests are never labeled as native persistence or packaged-runtime evidence.
