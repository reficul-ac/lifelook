# LifeLook Fixes and Usability Backlog

This file tracks concrete problems found while using the application. It complements `PLAN.md`: the plan describes the intended product, while this list records observed gaps that need implementation and verification.

## Audit record

- Audited commit: `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71` (`Complete onboarding and local persistence`)
- Audit date: 2026-08-08 America/Los_Angeles
- Local environment: Ubuntu 24.04, Linux 6.17 x86_64, Node 22.22.2, npm 11.15.0, rustc/cargo 1.97.1
- CI environment: Ubuntu 22.04, Node 20, Rust stable; Actions run [31287128922](https://github.com/reficul-ac/lifelook/actions/runs/31287128922)
- Artifacts: [`audit-artifacts/3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71/`](audit-artifacts/3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71/)
- Tested artifact: native release binary with isolated `XDG_DATA_HOME` and Xvfb. The AppImage could not be produced; all AppImage-only launch, integration, file-dialog, persistence, and export behavior is **Blocked**.
- Initial worktree: no tracked changes; pre-existing untracked `CLAUDE.md`. The audit changed only this file and `audit-artifacts/`.
- Limitations: one debug run was contaminated by Snap `core20` libraries and failed before React. Independent release-binary screenshots supersede that blanket native blocker for the ordinary onboarding/workspace path. Calendar use, assistive-technology exposure, all requested viewport sizes, offline isolation, many failure paths, and mutation/relaunch checks without a reachable UI remain explicitly blocked below.

No P0 defect was found. “Passed” is limited to the behavior named; component tests with mock repositories do not prove SQLite persistence or relaunch behavior.

## Coverage matrix

| Screen or flow | Pointer | Keyboard | Persistence/relaunch | Error paths | Light/dark | 920×650 | Adversarial review |
|---|---|---|---|---|---|---|---|
| Fresh onboarding | Passed ordinary release path | Implementation-supported; radio defect | Ordinary account appeared in workspace; interruption/relaunch Blocked | Validation component-tested; native DB failures Blocked | N/A | Blocked | Confirmed/Narrowed |
| Account onboarding | Passed ordinary checking path; other kinds component/source | Partial; custom radio Defect | Account visible after completion; process relaunch Blocked | Boundary/sign Defects | N/A | Blocked | Confirmed |
| Shell/navigation | Passed all five destinations | Native buttons supported; detailed focus Blocked | View not expected to persist | N/A | Immediate toggle Passed; persistence Defect | Blocked | Confirmed |
| Overview | Pointer rendered | Chart alternative Defect | Uses persisted opening balance only | Misleading-output Defect | Rendered both; contrast Defect | Blocked | Confirmed |
| Activity | Navigation/input entry Passed | Search focus Passed (native) | Defect: ignores database | Empty/filters Defect | Dark semantic contrast Passed | Passed at 920×650 | Confirmed |
| Plan | Year expand/collapse Passed | Disclosure state Defect | Defect: ignores persisted scenarios/domain | Edge warnings absent/outstanding v1 | Rendered | Blocked | Confirmed |
| Net Worth | Navigation Passed | Native button semantics supported | Defect: opening balances only | Empty state Defect | Rendered | Blocked | Confirmed |
| Settings members | Controls wired; full mutation not exercised | Calendar Blocked | Blocked after real relaunch | Save rejection Defect | Rendered | Blocked | Narrowed |
| Appearance | Immediate theme toggles Passed | Switch names/states Passed (native) | Theme/motion persistence Defect | N/A | Light/dark Passed | Passed at 920×650 | Confirmed |
| Backup/restore | Defect: buttons are no-ops | Defect | Blocked | Blocked | N/A | Blocked | Confirmed |
| Corrupt/unwritable startup | N/A; app exits | N/A | Defect | Defect | N/A | N/A | Confirmed |
| AppImage/CI | Local visible launch Passed | Native keyboard suite Passed | Packaged persistence/export still Blocked | Hosted run pending | Light/dark evidence Passed | Passed at 920×650 | Awaiting hosted CI |

## Complete interaction and claim inventory

Evidence abbreviations: `WF-01`–`WF-08` are the native PNGs in `workspace-features/native/`; `ONB` is `onboarding-persistence/report.md`; `EDGE` is `edge-usability/report.md`; `APR` and `ADV` are the two adversarial reports; `CI` is `ci-packaging/SUMMARY.md` and its adjacent logs.

| ID | Screen/flow and item | Disposition | Evidence or blocker |
|---|---|---|---|
| I-001 | Fresh launch/household step | Passed (release path) | `WF-01`; AppImage Blocked by F-001 |
| I-002 | Household name input and required validation | Passed component/implementation; native validation Blocked | `ONB` ONB-02 |
| I-003 | Person name and required validation | Passed component/implementation; native validation Blocked | `ONB` ONB-03 |
| I-004 | Typed optional birth date and invalid-date alert | Passed component | `ONB` ONB-04 |
| I-005 | Calendar birth-date control | Blocked | No successful native activation; `ONB` ONB-05 |
| I-006 | Add person | Passed component; native persistence Blocked | `ONB` ONB-06 |
| I-007 | Remove person | Blocked | Source-wired, not exercised; `ONB` ONB-07 |
| I-008 | Disabled California display | Passed as display only | `WF-01`; `ONB` ONB-08 |
| I-009 | Filing-status/residency selection | Defect | F-008; `ADV` confirms |
| I-010 | Save & Continue | Passed ordinary path | `WF-01`→`WF-02`; component contract |
| I-011 | Checking account radio | Passed ordinary pointer path | `WF-02`; keyboard semantics Defect F-014 |
| I-012 | Savings account radio | Passed component; native Blocked | `ONB` ONB-12 |
| I-013 | Credit-card radio | Passed component; sign semantics Defect | `ONB` ONB-13; F-006 |
| I-014 | Investment account radio | Implementation-supported; native Blocked | `ONB` ONB-14 |
| I-015 | Retirement account radio | Passed restored component; native Blocked | `ONB` ONB-15 |
| I-016 | Account name/opening balance | Passed ordinary value; Defect at sign/boundaries | `WF-02`–`WF-04`; F-006/F-007 |
| I-017 | Add account during onboarding | Passed component; native multi-account Blocked | `ONB` ONB-19 |
| I-018 | Remove account during onboarding | Blocked | `ONB` ONB-20 |
| I-019 | Back from accounts | Passed synthetic component; native Blocked | `ONB` ONB-21 |
| I-020 | Finish setup | Passed ordinary release path | `WF-03`–`WF-04` |
| I-021 | Rapid/duplicate finish | Blocked, not a confirmed defect | Button disables while saving; `ADV` |
| I-022 | Onboarding save error alert | Implementation-supported; native Blocked | `ONB` ONB-23 |
| I-023 | Interrupted onboarding and relaunch | Blocked | No real visible mutation/relaunch evidence |
| I-024 | Overview navigation | Passed | `WF-04`; `APR` PC-001 |
| I-025 | Activity navigation | Passed; badge content Defect | `WF-05`; F-003 |
| I-026 | Plan navigation | Passed | `WF-06` |
| I-027 | Net Worth navigation | Passed | `WF-07` |
| I-028 | Settings navigation | Passed | `WF-08` |
| I-029 | Profile/ellipsis menu | Defect | Enabled no-op; F-002 |
| I-030 | Global Search | Defect | Enabled no-op; F-002 |
| I-031 | Header/Settings dark-theme toggles | Passed immediate; Defect after relaunch | Component test; F-010 |
| I-032 | Global Add menu | Defect | Enabled no-op; F-002 |
| I-033 | Overview net-worth ending amount | Passed only for fresh opening balance | `WF-04`; becomes false after postings, F-005 |
| I-034 | Overview date, yearly gain, trend, deltas, assumptions and 92% guidance | Defect | Hard-coded/current-looking; F-004 |
| I-035 | Overview View all | Defect | Enabled no-op; F-002 |
| I-036 | Overview Open plan | Defect | Enabled no-op; F-002 |
| I-037 | Activity search input | Defect | Accepts text but never filters; F-003 |
| I-038 | Activity account filter | Defect | Enabled no-op; F-003 |
| I-039 | Activity year filter | Defect | Enabled no-op; F-003 |
| I-040 | Activity badge, total and four “Actual” rows | Defect | Fresh DB still shows literals; `WF-05`; F-003 |
| I-041 | Compare scenarios | Defect | Enabled no-op and persisted scenarios ignored; F-005 |
| I-042 | Ten Plan annual row expanders | Passed disclosure only | `WF-06`; `APR` PC-016 |
| I-043 | Plan annual/monthly values | Defect as household truth | Hard-coded/incomplete snapshot; F-005 |
| I-044 | Net Worth totals/accounts | Passed fresh opening-only display; Defect as current balance | `WF-07`; F-005/F-006 |
| I-045 | Net Worth Add account and zero-account state | Defect | No-op/blank state; F-002/F-015 |
| I-046 | Settings member text/date editing | Passed immediate/component; relaunch Blocked | `APR` PC-018/019 |
| I-047 | Settings member calendar/add/remove/save | Blocked ordinary success; error Defect | `APR` PC-020–023; F-013 |
| I-048 | Reduced-motion switch | Defect | No handler or state; F-011 |
| I-049 | Back up data | Defect | Enabled no-op despite backend command; F-009 |
| I-050 | Choose backup/restore | Defect | Enabled no-op; no replacement command; F-009 |
| I-051 | Loading/error/validation announcements | Passed implementation only | Roles at `src/App.tsx:80-91,490-493` |
| I-052 | Switch accessible names | Passed | Native WebDriver role/name/state assertions; `artifacts/native-e2e/02-dark-settings-920x650.png` |
| I-053 | Activity-search focus indicator | Passed | Native keyboard focus assertion; `artifacts/native-e2e/03-dark-activity-search-focus-920x650.png` |
| I-054 | Radio arrow keys/roving tab stop | Defect | F-014 |
| I-055 | Current nav and Plan disclosure state | Defect | F-014 |
| I-056 | Chart nonvisual alternative | Defect | F-014 |
| I-057 | Dark semantic text contrast | Passed | Native computed-style contrast assertions ≥4.5:1 |
| I-058 | OS reduced-motion media query | Implementation-supported; native Blocked | `EDGE` |
| I-059 | 920×650, 1024×768, 1280×820, large desktop | Partial | Native onboarding/Settings/Activity passed at 920×650; remaining viewport wave Blocked |
| I-060 | Long names, extreme/negative currency, expanded table clipping | Blocked except monetary Defect | `EDGE`; F-007 |
| I-061 | Corrupt profile startup | Defect | Exit 101; F-016; `corrupt-profile.log` |
| I-062 | Unwritable profile startup | Defect | Exit 101; F-016; `unwritable-profile.log` |
| I-063 | Offline launch | Blocked | No strict network namespace test |
| I-064 | AppImage build/launch/upload | Local build/metadata/icon/visible launch Passed; hosted upload pending | F-001; `artifacts/appimage-smoke/visible-window.png` |
| I-065 | `npm ci`, 12 frontend tests, web build, 3 Rust tests | Passed | CI logs |
| I-066 | Rust format and strict Clippy | Passed | Exact all-target/all-feature commands pass locally and gate CI before packaging |
| I-067 | Production npm audit | Passed (0); full audit policy Defect; Rust status Blocked | F-018 |
| I-068 | Packaged render/persistence/accessibility/export CI | Defect/Blocked | F-019 |
| I-069 | CSV/import/scenarios/tax fixtures and other unchecked PLAN phases with no enabled UI | Intentional unavailable/outstanding v1 | `PLAN.md` checklist; not silently counted as defects |
| I-070 | README imperative quick-start/feature claims for unavailable flows | Defect (documentation truth) | F-020 |

## Deduplicated defects

### F-001 — AppImage packaging awaits hosted CI confirmation

- **Status:** Fix implemented; awaiting hosted GitHub Actions · **Severity:** P1 · **Area/type:** Packaging, release blocker
- **Intended behavior:** README documents `npm run appimage`; PLAN requires an x86_64 AppImage that launches under a virtual display.
- **Reproduction:** The audited checkout aborted after compiling because it had no configured square bundle icon. The current worktree builds exactly one nonempty executable AppImage locally.
- **Evidence/relaunch:** Original failure: `ci-packaging/npm-appimage.log`, `github-actions-failed.log`, and Actions run 31287128922. Current local validation checks desktop metadata/icon and captures a visible launched window at `artifacts/appimage-smoke/visible-window.png`.
- **Impact/frequency:** Local release packaging is unblocked; hosted artifact production remains unproven until the updated workflow passes.
- **Root cause:** Fixed by configuring the existing square Linux PNGs in `src-tauri/tauri.conf.json`.
- **Fix/order/dependencies:** Keep active until the updated Ubuntu 22.04 hosted workflow validates and uploads the artifact.
- **Regression/acceptance:** Local and CI builds exit 0; exactly one nonempty executable AppImage exists; desktop metadata/icon validate; smoke and upload steps run.
- **Tester/reviewer:** Local packaging/native verification **Passed**; hosted Actions confirmation pending.

### F-002 — Enabled navigation and creation controls silently do nothing

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Shell/Overview/Net Worth, dead primary interactions
- **Intended behavior:** PLAN's progressive-disclosure/Add-menu principle and the visible labels themselves promise navigation or creation.
- **Reproduction:** Complete setup; activate profile, global Search, global Add, Overview View all/Open plan, or Net Worth Add account. Expected the named menu/view/flow. Actual: no visible or persisted change.
- **Evidence/relaunch:** `WF-04`, `WF-07`; `src/App.tsx:181-212,691-707,955-957`. Relaunch not applicable because no mutation occurs.
- **Impact/frequency:** Common primary actions strand every user; the Overview empty state explicitly points to dead Add.
- **Root cause:** Enabled buttons have no handlers.
- **Fix/order/dependencies:** After truthful financial output. Implement reachable flows/navigation or render controls disabled with honest unavailable copy until their flows exist.
- **Regression/acceptance:** Pointer and keyboard activation opens the correct surface; cancellation is safe; successful mutations update immediately and survive relaunch.
- **Tester/reviewer:** Workspace agent; product-truth and reproduction reviewers — **Confirmed**.

### F-003 — Activity is a realistic static mock, not a persisted ledger

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Activity, misleading output/dead controls
- **Intended behavior:** README says Activity stores and filters actual transactions; “Actual” must be persisted user data.
- **Reproduction:** Finish a fresh profile with no transactions; open Activity, type a nonexistent term, and activate both filters. Expected an honest empty ledger and working query/filter behavior. Actual: badge `12`, four merchant/payroll/mortgage rows, August 2025 total `−$4,916.80`; search merely accepts text and filters do nothing.
- **Evidence/relaunch:** `WF-05`; literal UI at `src/App.tsx:176,787-834`; no transaction read method in `src/repository.ts`. Same literals appear for every launch.
- **Impact/frequency:** Every user sees fictional financial history labeled as their actual activity.
- **Root cause:** Literal array/total/badge and uncontrolled search; repository exposes no ledger query.
- **Fix/order/dependencies:** Immediately after packaging. Read normalized entries/postings, derive totals/badge, wire query/account/date filters, and show an honest empty state.
- **Regression/acceptance:** Fresh DB shows zero rows/badge; created income/expense/transfer rows filter correctly; transfers do not affect income/spend; state remains correct after relaunch.
- **Tester/reviewer:** Workspace agent; both adversarial reviewers — **Confirmed**.

### F-004 — Overview fabricates personalized financial guidance

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Overview, misleading financial output
- **Intended behavior:** README/PLAN require actuals, assumptions, and projections to be distinct and explainable.
- **Reproduction:** Finish with one $1,234.56 checking account and no income/activity; open Overview. Expected only derivable values/empty guidance. Actual includes stale `Projected · Dec 2025`, `$29,482 this year`, static rising chart, fixed 3.2%/1.8%/24.6%, retirement 2048, return 6.5%, and “on track…92%”.
- **Evidence/relaunch:** `WF-04`; literals/static SVG at `src/App.tsx:621-725`. Deterministic across profiles/relaunch.
- **Impact/frequency:** Every user can mistake invented numbers for individualized financial advice.
- **Root cause:** Presentation mock values are mixed with one computed ending balance without sample labeling or data prerequisites.
- **Fix/order/dependencies:** With F-003, before dead-control polish. Derive every claim from persisted, dated inputs; otherwise suppress it and show missing-input guidance.
- **Regression/acceptance:** Zero-data fixture contains no gain/percent/on-track claim; seeded fixtures reconcile each label/chart point to repository/domain output and current date.
- **Tester/reviewer:** Workspace agent; product-truth and reproduction reviewers — **Confirmed**.

### F-005 — Plan and current balances ignore persisted domain state

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Projection/Net Worth, misleading/incomplete calculation
- **Intended behavior:** PLAN requires scenarios, tax profile, transactions, assets/liabilities, recurring data, and current balances to drive projections and balance sheet.
- **Reproduction:** Inspect Plan/Net Worth after a persisted mutation or compare source inputs. Expected the household's current normalized state. Actual snapshot hardcodes single/CA/2025 and a module baseline, forces recurring/assets/liabilities empty, ignores stored scenarios and `account_balances`, and uses opening balances.
- **Evidence/relaunch:** `src/App.tsx:122-156,838-980`; backend view at `src-tauri/src/lib.rs`; `WF-06`/`WF-07`. True post-transaction UI check is Blocked because creation is unreachable, but the missing read path is deterministic.
- **Impact/frequency:** Projections, taxes, debt, and current net worth become wrong as soon as data extends beyond opening accounts.
- **Root cause:** Bootstrap/repository boundary exposes only onboarding records; Workspace constructs a partial synthetic `FinancialSnapshot`.
- **Fix/order/dependencies:** After F-003/F-008. Expose one consistent persisted snapshot/current-balance query, load tax/scenarios/domain rows, and version/date assumptions.
- **Regression/acceptance:** Seeded postings/assets/debts/recurring/tax/scenarios reconcile Overview, Plan, and Net Worth before and after relaunch; scenario clones remain isolated.
- **Tester/reviewer:** Workspace agent; product-truth reviewer — **Confirmed** as source-backed truth defect.

### F-006 — Credit-card sign handling can increase net worth

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Onboarding/Net Worth, validation and financial correctness
- **Intended behavior:** UI says owed credit balance is negative; debt should reduce net worth.
- **Reproduction:** Choose Credit card, enter `125.40`, finish. Expected rejection or normalization to `−$125.40`. Actual regex accepts it, stores `+12540`, and account aggregation treats it as wealth.
- **Evidence/relaunch:** `src/App.tsx:462-464,550-555,922`; backend has no sign constraint. Persisted sign is returned unchanged.
- **Impact/frequency:** A common interpretation overstates wealth by $250.80 relative to the correct sign for a $125.40 debt.
- **Root cause:** Generic signed balance parser plus all-accounts-as-assets aggregation.
- **Fix/order/dependencies:** Before expanding account editing. Model “amount owed” explicitly or enforce/normalize sign in frontend and backend.
- **Regression/acceptance:** Positive/negative/zero/decimal/relaunch cases prove $125.40 owed reduces net worth by exactly $125.40.
- **Tester/reviewer:** Onboarding agent; reproduction reviewer — **Confirmed**.

### F-007 — Large accepted USD values silently mutate cents

- **Status:** Confirmed (narrowed example) · **Severity:** P1 · **Area/type:** Money input, data integrity
- **Intended behavior:** Decimal USD is persisted as exact integer cents or rejected with a stated limit.
- **Reproduction:** Enter `90071992547409.90`. Expected exact `9007199254740990` cents or a field error. Actual `Number(value) * 100` yields `9007199254740991`. `.93` and `.99` also mutate. The original `.91` example is counter-evidence and must not be used.
- **Evidence/relaunch:** `adversarial-reproduction/money-boundaries.log`; `src/App.tsx:550-555`. Mutation occurs before persistence.
- **Impact/frequency:** Rare boundary input, but silent alteration of financial data.
- **Root cause:** Binary floating-point conversion beyond `Number.MAX_SAFE_INTEGER`; backend expects i64.
- **Fix/order/dependencies:** Define supported range and parse decimal strings/BigInt cents exactly on both sides.
- **Regression/acceptance:** Exact tests at maximum, maximum+0.01, `.90/.91/.93/.99`, very long and negative inputs; stored/displayed cents match after relaunch.
- **Tester/reviewer:** Onboarding agent; reproduction reviewer — **Narrowed**, defect confirmed with corrected values.

### F-008 — Current onboarding omits promised tax profile and broader inputs

- **Status:** Confirmed documentation/current-flow mismatch · **Severity:** P2 (filing status blocks correct tax input and should be scheduled with F-005) · **Area/type:** Onboarding/product truth
- **Intended behavior:** README quick start says choose filing status and California residency; PLAN describes income, expenses, assets and debts onboarding.
- **Reproduction:** Complete both setup steps. Expected those controls or explicit skip/unavailable states. Actual: people and accounts only; California is disabled; payload/backend never writes `tax_profiles`.
- **Evidence/relaunch:** `src/App.tsx:333-510`; `src-tauri/src/lib.rs` onboarding payload/save; README line 32 and PLAN line 19. README status and unchecked phases explicitly admit guided onboarding is incomplete, narrowing this from an unconditional shipped-feature failure.
- **Impact/frequency:** Every household finishes setup without inputs used by visible tax/plan output.
- **Root cause:** Two-step vertical slice and documentation that mixes current instructions with future v1 scope.
- **Fix/order/dependencies:** Add/persist/restore tax choices first; implement remaining guided steps or clearly mark them unavailable in current-facing docs.
- **Regression/acceptance:** Every supported filing status survives relaunch and affects calculation; every additional class has add/remove/back/error/interruption tests or honest deferral copy.
- **Tester/reviewer:** Onboarding agent; both reviewers — filing/status **Confirmed**, broader scope **Narrowed**.

### F-009 — Backup and restore controls are dead; restore replacement is absent

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Data safety, dead flow
- **Intended behavior:** Visible Settings copy and README describe snapshot backup and validated restore.
- **Reproduction:** Settings → Back up data or Choose backup. Expected file selection plus safe operation. Actual: nothing. Backend has `backup_database` and `inspect_backup`, but repository/UI invoke neither; no restore-replacement command exists.
- **Evidence/relaunch:** `src/App.tsx:1102-1118`, `src/repository.ts`, `src-tauri/src/lib.rs`. AppImage file-dialog behavior Blocked.
- **Impact/frequency:** Users cannot use the only presented recovery mechanism for local financial data.
- **Root cause:** Backend foundation is disconnected and incomplete.
- **Fix/order/dependencies:** After startup recovery. Wire snapshot creation; implement staged integrity/schema validation and atomic replacement with pre-restore backup.
- **Regression/acceptance:** Backup/relaunch round trip; corrupt/newer/wrong files leave bytes unchanged and show actionable errors; cancellation is non-mutating.
- **Tester/reviewer:** Workspace agent; both reviewers — **Confirmed**.

### F-010 — Appearance choice resets on relaunch and ignores system preference

- **Status:** Confirmed · **Severity:** P2 · **Area/type:** Appearance persistence
- **Intended behavior:** Settings and PLAN promise light/dark themes; troubleshooting implies settings normally persist.
- **Reproduction:** Enable dark, quit/relaunch. Expected stored dark/system/light selection. Actual `dark` initializes `false`; bootstrap has no settings and no settings command is called.
- **Evidence/relaunch:** `src/App.tsx:120`, `src/repository.ts`; component test proves only immediate class change.
- **Impact/frequency:** Every dark-theme user repeats the choice each launch; system preference is ignored.
- **Root cause:** Local component state is disconnected from the existing settings table.
- **Fix/order/dependencies:** Add typed settings bootstrap/update and system/light/dark model.
- **Regression/acceptance:** Both toggles stay synchronized; explicit and system modes survive relaunch and respond correctly to OS changes.
- **Tester/reviewer:** Workspace/edge agents; reviewers — immediate pass **Narrowed**, persistence defect **Confirmed**.

### F-011 — Reduced-motion switch is an enabled no-op

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Accessibility/dead setting
- **Intended behavior:** PLAN promises reduced-motion support and Settings offers a switch.
- **Reproduction:** Activate Reduced motion with pointer, Space, or Enter. Expected checked state and suppressed motion, persisted. Actual no handler/state; `aria-checked` remains false. OS media-query support is separate.
- **Evidence/relaunch:** `src/App.tsx:1093-1100`; `src/styles.css:555-562`.
- **Impact/frequency:** Users who need reduced motion are given false assurance.
- **Root cause:** Presentational switch not connected to preference/state.
- **Fix/order/dependencies:** Implement with F-010; combine stored choice with OS preference and a root class.
- **Regression/acceptance:** Named switch toggles by pointer/keyboard, disables every transition immediately, and survives relaunch.
- **Tester/reviewer:** Edge/workspace agents; product-truth reviewer — **Confirmed**.

### F-013 — Settings member-save failures are unhandled and unannounced

- **Status:** Confirmed · **Severity:** P2 · **Area/type:** Persistence/error handling
- **Intended behavior:** Local write failures should retain edits and produce actionable announced errors.
- **Reproduction:** Make repository save reject; activate Save members. Expected busy protection then `role=alert` with retry. Actual unhandled promise; success status is never set and no failure status exists.
- **Evidence/relaunch:** `src/App.tsx:1007-1029,1071-1075`; ordinary native failure injection/relaunch Blocked.
- **Impact/frequency:** Any disk/database failure looks like an ignored save and risks mistaken trust.
- **Root cause:** `savePeople` has no try/catch/finally or saving state.
- **Fix/order/dependencies:** Add busy state, caught structured errors, retained drafts, alert/focus behavior and retry.
- **Regression/acceptance:** Rejection is announced, duplicate activation disabled, edits retained, retry persists and survives relaunch.
- **Tester/reviewer:** Edge agent; reproduction reviewer — **Confirmed**.

### F-014 — Custom radio, navigation, disclosure and chart semantics are incomplete

- **Status:** Confirmed by source; native AT verification Blocked · **Severity:** P2 · **Area/type:** Keyboard/accessibility
- **Intended behavior:** Standard radio/disclosure/current-page patterns and a chart data alternative.
- **Reproduction:** Keyboard through account types and inspect the accessibility tree for nav/year/chart. Actual: five radios are all tab stops with no arrow handling; nav has no `aria-current`; year rows lack `aria-expanded/controls`; generic chart div has no role or underlying data alternative.
- **Evidence/relaunch:** `src/App.tsx:167-177,411-430,621-654,875-913`; `EDGE`.
- **Impact/frequency:** Keyboard and nonvisual users receive inefficient or missing state/data.
- **Root cause:** Visual controls without complete ARIA interaction patterns.
- **Fix/order/dependencies:** Prefer native radio inputs; add roving behavior only if necessary, stateful nav/disclosures, and one meaningful chart object plus text/table values.
- **Regression/acceptance:** Arrow/Home/End/Space tests; one tab stop per radio group; role/name/state snapshots; chart values available nonvisually.
- **Tester/reviewer:** Edge agent; reproduction reviewer confirms radio gap — **Confirmed**.

### F-015 — Empty Net Worth gives no usable next step

- **Status:** Confirmed by source; zero-account native state Blocked · **Severity:** P2 · **Area/type:** Empty state/usability
- **Intended behavior:** Empty views guide users to a working action.
- **Reproduction:** Open Net Worth for a zero-account completed/seeded profile. Expected explanation and account flow. Actual blank Accounts & assets card plus dead Add account.
- **Evidence/relaunch:** `src/App.tsx:949-983`; overlaps F-002 for the button.
- **Impact/frequency:** Edge profile or future deletion leaves a confusing empty primary screen.
- **Root cause:** Unconditional list container and placeholder action.
- **Fix/order/dependencies:** Implement add flow, then render conditional guidance.
- **Regression/acceptance:** Zero/many account fixtures at minimum size; keyboard action creates and persists an account.
- **Tester/reviewer:** Edge agent; product-truth reviewer — **Confirmed** source risk, native seed **Blocked**.

### F-016 — Corrupt or unwritable profiles panic before recovery UI

- **Status:** Confirmed · **Severity:** P1 · **Area/type:** Startup/data recovery
- **Intended behavior:** Startup failures preserve data and show actionable recovery, retry, or safe exit.
- **Reproduction:** Put invalid bytes at `lifelook.db` in a fresh XDG profile, or make the app-data path unwritable; launch release binary. Expected recovery UI. Actual exit 101/panic (`file is not a database` or `Permission denied`) before React loads.
- **Evidence/relaunch:** `adversarial-reproduction/corrupt-profile.log`, `unwritable-profile.log`; setup and `.expect` at `src-tauri/src/lib.rs:450-469`.
- **Impact/frequency:** Users with disk/permission/corruption trouble cannot open the app or reach the displayed Try again flow.
- **Root cause:** Database open/migration fails inside Tauri setup and is converted to process termination; React load error is too late.
- **Fix/order/dependencies:** Before backup/restore UI. Preserve original bytes; expose managed startup error or a native recovery surface without auto-replacement.
- **Regression/acceptance:** Both profiles show actionable error, original bytes stay identical, fixed-permission/recovered relaunch succeeds, no panic text is the user interface.
- **Tester/reviewer:** Reproduction reviewer — **Confirmed** with independent profiles.

### F-018 — Dependency-advisory coverage and policy are incomplete

- **Status:** Confirmed/Narrowed · **Severity:** P2 · **Area/type:** CI supply-chain gate
- **Intended behavior:** Production and Rust dependencies have blocking audit coverage; dev exceptions are reviewed.
- **Reproduction:** `npm audit --omit=dev` passes with zero; full `npm audit` reports five dev-tree advisories through Vitest/Vite/esbuild; `cargo audit` is unavailable and CI installs/runs neither audit policy.
- **Evidence/relaunch:** `npm-audit-production.log`, `npm-audit-full.log`; Rust vulnerability status is **Blocked**, not asserted vulnerable.
- **Impact/frequency:** New advisories have no consistent release signal.
- **Root cause:** No workflow steps/tool provisioning or explicit dev policy.
- **Fix/order/dependencies:** Upgrade test toolchain; add blocking production npm and pinned Rust audit; document scoped, expiring dev exceptions.
- **Regression/acceptance:** Both production audits pass in CI; any dev exception has owner/reason/expiry.
- **Tester/reviewer:** CI agent; reproduction reviewer — **Narrowed** to policy gap.

### F-019 — CI packaged smoke proves only process liveness

- **Status:** Confirmed · **Severity:** P2 · **Area/type:** CI release validation
- **Intended behavior:** PLAN requires AppImage render, first-launch persistence and export validation.
- **Reproduction:** Inspect `.github/workflows/ci.yml`: a 20-second timeout is accepted as success. It does not assert a window/UI marker, mutation/relaunch, accessibility, export, or clean shutdown; upload lacks an explicit missing-file error/uniqueness check.
- **Evidence/relaunch:** Workflow line 21; currently Blocked by F-001.
- **Impact/frequency:** A blank, hung, nonpersistent or non-exporting package can pass after packaging is fixed.
- **Root cause:** Liveness-only shell smoke.
- **Fix/order/dependencies:** After F-001. Drive packaged UI on a clean profile, assert render, mutate, relaunch, verify persistence/export, then validate exactly one nonempty executable artifact.
- **Regression/acceptance:** Deliberate blank/crash/missing/persistence/export failures each fail CI; artifact upload uses `if-no-files-found: error`.
- **Tester/reviewer:** CI agent; reproduction reviewer — **Confirmed**.

### F-020 — README presents unavailable pre-release flows as executable steps

- **Status:** Confirmed/Narrowed · **Severity:** P2 · **Area/type:** Documentation/product truth
- **Intended behavior:** Current quick start and feature guide distinguish reachable behavior from v1 vision.
- **Reproduction:** Follow README user steps for filing status/residency, property/debts, activity/CSV, plan assumptions/scenarios, backup/restore. Most cannot be completed. README warning/status and unchecked PLAN phases acknowledge incompleteness, but imperative instructions do not mark each unavailable step.
- **Evidence/relaunch:** README lines 30–53, 70; PLAN checklist; `APR` documented-claim reconciliation.
- **Impact/frequency:** Every evaluator/user is directed into absent flows and may mistake realistic placeholders for their data.
- **Root cause:** Vision copy and shipped-state documentation are interleaved.
- **Fix/order/dependencies:** Immediately update status/feature labels while implementation proceeds; keep PLAN as vision.
- **Regression/acceptance:** Every README command is CI-covered; every user step is reachable or explicitly tagged unavailable; no enabled mock data is called actual/current.
- **Tester/reviewer:** Product-truth reviewer; reproduction reviewer — **Narrowed** because pre-release caveats exist.

## Prioritized repair sequence

1. **Packaging and CI blockers:** Confirm F-001 in hosted Actions, then F-018–F-019.
2. **Data loss and misleading output:** F-016, F-003, F-004, F-005, F-006, F-007. Preserve corrupt data and remove fabricated/current-looking finance results first.
3. **Dead primary interactions:** F-002, F-009, F-011. Hide/disable unavailable affordances only as a short-term honest state; implement their actual flows.
4. **Persistence and error handling:** F-008, F-010, F-013, then backup/restore completion in F-009.
5. **Accessibility and responsive verification:** F-014, F-015, followed by packaged tests at 1024×768, 1280×820, large desktop, long names, extreme values and expanded tables.
6. **Product polish/documentation:** F-020 and remaining intentional-unavailable v1 work, keeping current behavior and vision clearly separated.

Completion of a fix requires its observable acceptance criteria, immediate-state check, and post-relaunch check where mutation is involved. Previously blocked AppImage, viewport, keyboard/AT, offline, corrupt/unwritable, cancellation, and failure rows must be rerun after F-001; they cannot be converted to passes by source inspection alone.
