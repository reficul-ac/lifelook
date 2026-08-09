# Adversarial product-truth and control-coverage review

- Audited commit: `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71`
- Reviewer role: independent product-truth/control-coverage challenger
- Evidence reviewed: native release-binary screenshots `workspace-features/native/01` through `08`, onboarding report and screenshot, CI/package report and logs, rendered-control source, repository/backend commands, `README.md`, and `PLAN.md`.
- Important scope distinction: `PLAN.md` is explicitly a v1 vision whose phases 2–7 are unchecked, and README status says guided onboarding, production CSV import, restore UI, and other work remain pre-release. Missing future capability is not automatically an implementation defect. An enabled control that represents that capability but does nothing, or realistic data presented as actual/current without provenance, remains a defect.

## Review verdicts on prior findings and passes

| Challenged claim | Verdict | Rationale / counter-evidence |
|---|---|---|
| Native workspace could not be exercised because WebKit failed | Narrowed | This was true only of the onboarding agent's debug/runtime attempt. The release binary rendered and accepted real X11 pointer/keyboard input with isolated `XDG_DATA_HOME`; screenshots `workspace-features/native/01`–`08` prove it. AppImage behavior remains Blocked. |
| Fresh onboarding opens and can reach Overview | Confirmed | Native release run progressed through both steps and persisted a `$1,234.56` checking account into Overview and Net Worth (`01`–`04`, `07`). This does not prove every onboarding mutation/relaunch edge case. |
| All five primary navigation buttons work | Confirmed | Pointer activation produced the corresponding screens (`04`–`08`); each has an `onClick` changing `view` at `src/App.tsx:167-177`. |
| Header theme button and Settings dark-theme switch work immediately | Confirmed | Both call the same `setDark` state (`src/App.tsx:203-209,1084-1091`). |
| Theme persists | False positive if claimed as a pass; Confirmed defect otherwise | `dark` always initializes `false`; bootstrap does not contain settings and no settings command is called (`src/App.tsx:120`; `src/repository.ts`). It resets on process restart. |
| Reduced-motion setting works | Confirmed defect | Literal `aria-checked="false"`, no state and no handler (`src/App.tsx:1093-1100`). OS `prefers-reduced-motion` CSS is a separate automatic behavior, not this visible switch. |
| Plan year rows expand/collapse | Confirmed | Native screenshot `06-plan-expanded.png`; `onClick` at `src/App.tsx:877-895`. This only validates disclosure, not correctness of values. |
| Activity search works | Narrowed | The input accepts text, but `ActivityView` owns no query state and its rows are a literal array. It cannot search/filter anything (`src/App.tsx:787-834`). |
| Settings member edit/add/remove/save is fully passed | Narrowed | Controls and save invocation exist (`src/App.tsx:1007-1075`), but first-wave native evidence did not demonstrate add/remove/save plus relaunch. Save also has no `try/catch`; a rejection provides no actionable error. |
| Positive credit-card balance defect | Confirmed | Regex accepts positive input and Net Worth adds it as an asset. This is not merely documentation scope; the enabled shipped flow gives materially wrong wealth. Duplicate of the broader account-sign/net-worth truth defect, not a separate placeholder issue. |
| Extreme USD input loses cents | Confirmed | `Number(value) * 100` can exceed safe-integer precision (`src/App.tsx:550-555`). Native boundary reproduction remains Blocked, but root cause is deterministic. |
| Missing filing status/residency and expanded onboarding are unconditional current defects | Narrowed | README quick start presents them as usable, but README status and unchecked PLAN phases explicitly admit guided onboarding is incomplete. Record as documentation/current-flow mismatch or missing promised v1 work, not proof that a completed milestone regressed. Hardcoded single/CA/2025 values used in visible calculations remain a separate misleading-output defect. |
| AppImage packaging blocker and absent packaged interaction | Confirmed | Local and Actions logs agree; no AppImage exists, so AppImage-only launch/persistence/export remain Blocked. |

## Independently derived visible interaction inventory

Disposition applies to the current release-binary UI. `Defect` means enabled but dead/misleading; `Passed` is limited to the behavior stated.

| ID | Screen | Visible interaction | Disposition | Evidence / reviewer note |
|---|---|---|---|---|
| PC-001 | Shell | Overview navigation | Passed | Native `04`; changes view. |
| PC-002 | Shell | Activity navigation | Passed | Native `05`; changes view. Badge content is separately defective. |
| PC-003 | Shell | Plan navigation | Passed | Native `06`; changes view. |
| PC-004 | Shell | Net Worth navigation | Passed | Native `07`; changes view. |
| PC-005 | Shell | Settings navigation | Passed | Native `08`; changes view. |
| PC-006 | Shell | Profile/ellipsis button | Defect | Enabled button has no handler/menu (`src/App.tsx:181-190`). |
| PC-007 | Header | Search icon | Defect | Enabled button has no handler/dialog (`src/App.tsx:200-202`). |
| PC-008 | Header | Toggle theme icon | Passed immediate; Defect persistence | Updates component state only. |
| PC-009 | Header | Add dropdown | Defect | Enabled primary button has no handler/menu (`src/App.tsx:210-212`), contradicting empty-state instruction and PLAN's one-Add-menu principle. |
| PC-010 | Overview | View all recent activity | Defect | No handler (`src/App.tsx:691-693`). |
| PC-011 | Overview | Open plan | Defect | No handler (`src/App.tsx:705-707`). |
| PC-012 | Activity | Search transactions input | Defect | Accepts input but has no state/filter effect. |
| PC-013 | Activity | All accounts dropdown | Defect | No handler/menu (`src/App.tsx:801-803`). |
| PC-014 | Activity | This year dropdown | Defect | No handler/menu (`src/App.tsx:804-806`). |
| PC-015 | Plan | Compare scenarios | Defect | No handler/dialog (`src/App.tsx:857`). |
| PC-016 | Plan | Each of ten annual disclosure rows | Passed disclosure only | Same working control repeated for 2025–2034; native `06`; each toggles its own monthly rows. Values are reviewed separately. |
| PC-017 | Net Worth | Add account | Defect | No handler (`src/App.tsx:955-957`). |
| PC-018 | Settings | Member name input(s) | Passed immediate edit; persistence Blocked | Controlled inputs; no complete native relaunch evidence. |
| PC-019 | Settings | Member typed birth-date input(s) | Passed ordinary/validation by component; native persistence Blocked | Parser is wired; report's component evidence applies. |
| PC-020 | Settings | Member calendar input(s) | Blocked | Wired source, but neither native audit activated it. |
| PC-021 | Settings | Remove member button(s), when >1 | Blocked native | Source mutates local array; saving/relaunch not independently exercised. |
| PC-022 | Settings | Add person | Blocked native | Source appends local draft; persistence depends on Save members. |
| PC-023 | Settings | Save members | Narrowed pass / Defect error path | Calls repository, but failure is uncaught and success/relaunch were not independently shown. |
| PC-024 | Settings | Dark-theme switch | Passed immediate; Defect persistence | Same state as PC-008. |
| PC-025 | Settings | Reduced-motion switch | Defect | Dead enabled switch. |
| PC-026 | Settings | Back up data | Defect | Dead enabled button even though backend command exists. |
| PC-027 | Settings | Choose backup / restore | Defect | Dead enabled button; backend can only inspect a backup and has no replace/restore command. |

Onboarding controls ONB-01 through ONB-27 in the first report cover the fresh-profile inventory. Native evidence `workspace-features/native/01`–`04` supersedes the blanket native blocker for the ordinary household/name/account/finish path, but calendar, remove, duplicate activation, failure, interruption, and relaunch rows remain Blocked unless another later report provides direct evidence.

## Placeholder and displayed-claim audit

| ID | Displayed claim | Verdict | Product-truth finding |
|---|---|---|---|
| PT-001 | Activity badge `12` | Confirmed defect | Literal badge shown for every profile (`src/App.tsx:176`), including a fresh database with zero transactions. |
| PT-002 | August 2025 Activity total and four merchant/payroll/mortgage rows labeled Actual | Confirmed defect | Entire ledger is a literal realistic array and total (`src/App.tsx:808-832`); it is not read from SQLite. Native `05` proves presentation in a fresh profile. |
| PT-003 | Overview `Projected · Dec 2025` | Confirmed defect | Fixed label is stale relative to audit date 2026-08-08 and independent of projection horizon/current date. |
| PT-004 | Overview net worth amount | Narrowed | `$1,234.56` correctly reflects the persisted opening account in this fresh run, but it uses `openingBalanceCents`, not current `account_balances`, so it becomes false after postings. |
| PT-005 | `$29,482.00 this year` | Confirmed defect | Literal `2948200`, impossible alongside a fresh `$1,234.56` account and no activity (`src/App.tsx:628`). |
| PT-006 | Net-worth trend chart | Confirmed defect | Static SVG path unrelated to data, but labeled as a net-worth trend chart. |
| PT-007 | Income change `3.2%`, Spending `1.8%`, Saved `24.6% rate` | Confirmed defect | Fixed strings even when all corresponding values are `$0.00`; visually presented as account-specific metrics. |
| PT-008 | Retirement target 2048, annual return 6.5%, inflation 2.5% | Confirmed defect | Fixed display; no user plan inputs persist these values. Inflation coincidentally matches hardcoded baseline, while annual return does not match the audited 0-bps account. |
| PT-009 | “You're on track” / “funds 92%” | Confirmed defect, high misleading-output priority | No target-lifestyle input or 92% computation exists; shown as personalized guidance. |
| PT-010 | Plan Baseline | Narrowed | Backend creates a baseline scenario, but UI ignores bootstrapped scenarios and always uses module constant `baseline`; its displayed identity is not persistence-backed. |
| PT-011 | Plan projected year/month values | Confirmed defect as household plan truth | Engine calculation itself is deterministic, but snapshot hardcodes single/CA/2025, omits all persisted/current transactions, categories, scenarios, recurring items, assets, and liabilities (`src/App.tsx:122-156`). “Projected” labeling does not cure invalid/incomplete inputs. |
| PT-012 | Plan “10-year outlook” | Confirmed for extent only | Baseline horizon is exactly 120 months; this is a truthful structural label, though values are incomplete. |
| PT-013 | Net Worth total assets/debt/current net worth | Confirmed defect after any transaction and incomplete by design | UI reads only bootstrapped opening accounts and always-empty asset/liability arrays; backend `account_balances` is not exposed. Fresh opening-only value happened to match native `07`. |
| PT-014 | “No transactions yet. Use Add…” | Duplicate defect | Empty-state fact matches fresh DB, but instructed Add action is dead (PC-009). |
| PT-015 | “Local workspace” / data stays on device | Confirmed within reviewed implementation | Tauri uses per-user app-data SQLite and no network integration was found. This review did not perform network packet capture, so the broader no-network claim is implementation-supported rather than exhaustively proven. |
| PT-016 | Backup/restore explanatory text | Confirmed defect when paired with enabled controls | Backup backend exists, but buttons do nothing; restore replacement does not exist. README status explicitly admits restore UI is pre-release, making the visible enabled affordance especially misleading. |

## Documented claim reconciliation

1. Current-facing README quick-start and feature-guide prose describes filing status/residency, property/debts, manual/CSV activity, plan inputs, scenario cloning/comparison, filters, recurring entries, reconciliation, backup, and restore as available. Most have no reachable UI. Verdict: **Narrowed documentation defect** because README's pre-release warning/status and PLAN's unchecked checklist acknowledge incompleteness, but the document does not mark each unavailable step and still gives users imperative instructions they cannot complete.
2. PLAN's v1 capabilities are requirements, not evidence of shipped behavior. Missing CSV/scenario/tax/restore capability should be inventoried as **Intentional unavailable / outstanding v1 work** where no UI is offered. Where an enabled visible control offers it and silently does nothing, verdict is **Confirmed defect**.
3. README says the repository contains an “accessible responsive interface.” The visible reduced-motion switch is dead, charts lack a textual data alternative, and broader keyboard/responsive evidence was not established in first wave. Verdict: **Narrowed/unsubstantiated claim**, pending the accessibility/edge reviewer rather than a standalone duplicate defect here.
4. README troubleshooting says non-persisting Settings may indicate an unwritable directory. This is misleading for theme/reduced motion because the UI never persists them even on a writable profile. Verdict: **Confirmed documentation/product-truth defect**, duplicate of appearance persistence.
5. Backend command existence does not validate UI behavior: `create_transaction`, `create_transfer`, `backup_database`, and `inspect_backup` are not exposed through `Repository` or invoked by rendered controls. Restore replacement, CSV import, settings persistence, and most domain data bootstrap are absent.

## Deduplication and priority guidance

- Merge PT-001, PT-002, and Activity search/filter dead controls under one “Activity is a realistic static mock rather than a persisted ledger” defect, while acceptance criteria enumerate badge, rows, totals, search, and filters.
- Merge PT-003, PT-005–PT-009 under “Overview presents fabricated personalized financial guidance”; keep PC-010/011 dead navigation as a separate interaction defect if ownership differs.
- Merge PT-010/011 and Compare scenarios under “Plan ignores persisted scenario/tax/domain state”; the working disclosure control is not evidence against this defect.
- Merge PT-004/PT-013 and positive-credit behavior under “Net Worth derives from opening account signs rather than current normalized balances/assets/liabilities.” Preserve exact positive-credit reproduction as a regression case.
- Merge PC-008/024 and README troubleshooting mismatch under appearance persistence. Keep reduced-motion dead switch separately because its implementation and acceptance criteria differ.
- Backup dead UI and restore dead UI may share a Data & Privacy feature entry, but acceptance must distinguish working snapshot creation from staged validation/replacement because only the former backend exists.

## Remaining blockers

- AppImage-only rendering, launch, file-dialog behavior, persistence, and export: Blocked by packaging failure.
- True post-transaction UI accuracy: Blocked because the UI has no transaction creation path, though source proves it never reads postings.
- Settings member mutation after real relaunch, calendar interaction, and repository error behavior: not established by reviewed native artifacts.
- Later edge/accessibility reports were not present in the artifact directory at review time; their evidence should supersede only the specifically tested rows, not these source-backed no-op/product-truth findings.
