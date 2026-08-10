# LifeLook Fixes and Usability Backlog

This is a current-branch backlog, not a snapshot of the original audit. `PLAN.md` describes product intent; this file records shipped, accepted, and still-blocked behavior.

## Verification record

- Reconciled branch: current worktree based on `d81bbf1855dfcc694f8970898f40db4d780b8314`.
- Reconciliation date: 2026-08-09 America/Los_Angeles.
- Current automated baseline: 35 frontend tests, 23 Rust tests, and 5 native WebDriver scenarios.
- Native evidence: `artifacts/native-e2e/`, generated from the release binary with isolated profiles.
- Terms used below:
  - **Implemented/component-tested** means code or an injected-repository test passed; it is not persistence evidence.
  - **Native accepted** means the release process and real SQLite profile were exercised.
  - **Still blocked** means the UI or required end-to-end evidence does not exist yet.

No P0 defect is known. Native acceptance covers onboarding through relaunch, member edits, appearance preferences, ledger/account/asset/liability mutation, mixed CSV import, filtering, reconciliation, backup/restore, supported viewport sizes, and startup recovery.

## Coverage matrix

| Screen or flow | Current implementation | Native acceptance | Still blocked |
|---|---|---|---|
| Onboarding | Household, members, filing status, typed accounts, exact money parsing, and credit signs are implemented/component-tested | Account and household data survive process relaunch | Native add/remove/back/error interruption variants |
| Shell/navigation | All five destinations, the six-mode Add menu, and honest disabled controls are implemented | Navigation, current state, focus, and 920×650 minimum accepted | Profile and global-search implementations |
| Overview | Current balances/activity totals are derived; projections require a saved tax profile | Transaction-driven income, spending, saved amount, and net worth survive relaunch | Broader planning inputs |
| Activity | Manual/import/transfer deletion and reviewed CSV import are implemented with component and persistence-backed Rust coverage | Native mutation, editing, deletion, grouped transfers, mixed-file CSV import, search/account/year filters, exact totals, and relaunch persistence accepted | CSV export and broader planning inputs |
| Plan | Saved tax/current domain snapshot feeds deterministic projection; disclosure semantics implemented | Expanded rows accepted at 920×650, 1024×768, and 1280×820 with long names | Scenario selection/editing and full domain-entry UI |
| Net Worth | Account, asset, and liability CRUD; mortgage terms; signed credit balances; reconciliation; and guarded empty-account deletion are implemented/component/Rust-tested | Account/asset/liability creation and editing, mortgage persistence, deletion, exact balances/net worth, and relaunch persistence accepted | Scenario-linked asset/liability events |
| Settings members | Save busy/error/retry behavior is component-tested | Edited long member name survives relaunch | Native write-failure injection and calendar coverage |
| Appearance | System/light/dark and reduced motion persist | Dark and reduced motion survive process relaunch | Native OS preference-change simulation |
| Backup/restore | Staged atomic backup/restore, confirmation, error recovery, and refresh are implemented | Native accepted, including relaunch persistence | AppImage-specific dialog round trip |
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
| I-005 | Account-kind radios and typed balances | Native accepted for checking and a second savings account; component-tested across kinds | Credit/investment/retirement native variants blocked |
| I-006 | Exact USD parsing and supported maximum | Implemented/component/Rust-tested | Decimal strings use integer/BigInt cents; backend limit enforced |
| I-007 | Credit-card amount owed reduces net worth | Implemented/component/Rust-tested | Positive input normalizes to signed debt; migration repairs old positive credit balances |
| I-008 | Interrupted onboarding/relaunch | Partially native accepted | Completed onboarding survives relaunch; mid-step interruption remains blocked |
| I-009 | Overview current net worth/cash flow/tax labels | Implemented/component-tested | Derived from bootstrap; tax output withheld without profile |
| I-010 | Activity creation/editing/deletion, grouped transfers, mixed CSV import, search, account/year filters | Native accepted | Exact edited ledger balances, atomic transfer deletion, duplicate override, filter isolation, grouped rendering, dynamic years, and relaunch persistence covered |
| I-011 | Plan expanders and monthly regions | Native accepted | Three supported viewports, including expanded rows |
| I-012 | Scenario comparison | Honestly unavailable | Selection/editing remains open |
| I-013 | Net Worth current balances and credit/liability sections | Native accepted for account, asset, generic liability, and mortgage CRUD/persistence, including exact totals and relaunch | Scenario-linked asset/liability events remain open |
| I-014 | Net Worth zero-account action | Implemented/component-tested | Add account opens the shared account dialog |
| I-015 | Settings member save, rejection, retained draft, retry | Implemented/component-tested | Successful member edit survives native relaunch |
| I-016 | Theme and reduced motion | Native accepted | Both persisted through process relaunch |
| I-017 | Search/add/profile controls | Add implemented; search/profile honestly unavailable | Add modal component coverage; search/profile remain disabled |
| I-018 | Backup and restore | Native accepted | Staged atomic backup/restore, confirmation, recovery, immediate refresh, dialogs, and relaunch persistence are covered |
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

- **Status:** Narrowed to Profile and global Search, which remain honestly disabled and component-tested.
- Add now opens income, expense, transfer, account, asset, and debt creation. Net Worth creation controls and backup/restore selection are functional.

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
- Scenario selection/editing remains blocked. Asset and liability CRUD, mortgage terms, independent asset growth, and monthly debt amortization are implemented.

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

- **Status:** Native accepted.
- Settings provides filtered save/open dialogs, silent cancellation, busy protection, explicit destructive confirmation, announced/focused errors, and immediate workspace refresh. Native restore validates and migrates a staging copy, preserves the selected source, atomically replaces the live profile with rollback recovery, and returns the restored snapshot. Release-binary acceptance proves backup A, mutation B, immediate restore A, and persistence after relaunch.

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

- **Status:** Narrowed; still open for packaged persistence/dialog acceptance.
- CI validates AppImage contents, a visible window, native accessibility/recovery, and required artifact presence. The release-binary suite covers backup/restore file dialogs and persistence, but the same dialog round trip is not yet exercised through the AppImage; export remains future work.

### F-020 — README mixed shipped and future flows

- **Status:** Reconciled.
- The quick start describes reachable onboarding, creation/editing, CSV, current-balance, appearance, and backup/restore behavior; scenario comparison and CSV export remain explicitly unavailable.

## Prioritized repair sequence

1. Implement scenario selection/editing and expose remaining recurring income/expense and scenario-event inputs (F-005/F-008).
2. Add the chart nonvisual alternative, strict offline test, and remaining native failure/calendar variants (F-013/F-014).
3. Extend AppImage acceptance to mutation/relaunch and export/file-dialog behavior (F-019).

A finding is complete only when its observable acceptance criteria pass at the appropriate layer. Source inspection and component tests are never labeled as native persistence or packaged-runtime evidence.
