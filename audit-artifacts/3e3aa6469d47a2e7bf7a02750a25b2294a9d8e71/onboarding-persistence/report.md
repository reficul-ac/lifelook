# Onboarding and persistence audit

Commit: `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71`

## Native interaction limitation

The debug native binary was launched with a fresh `XDG_DATA_HOME` on Xvfb and driven/inspected through X11. The WebKit network process failed before the React UI loaded because it resolved `/snap/core20/current/lib/x86_64-linux-gnu/libpthread.so.0`, which lacks the host's required `GLIBC_PRIVATE` symbol. `01-fresh-onboarding.png` records the resulting native window and `app.log` records the loader failure. Consequently all native pointer, calendar, database mutation, quit/relaunch, corrupt/unwritable-profile, and duplicate-click observations are Blocked in this environment; source and component-test results below are not presented as equivalent native evidence.

The focused component suite passed: 6/6 tests. It covers fresh rendering, typed date rejection, two people, savings/credit accounts, and restoration from a synthetic step-6 bootstrap. It does not exercise SQLite or an actual relaunch.

## Inventory dispositions

| ID | Interaction or claim | Disposition | Evidence |
|---|---|---|---|
| ONB-01 | Fresh profile opens household step | Blocked native; Passed component | `01-fresh-onboarding.png`; `src/App.test.tsx:21-42` |
| ONB-02 | Household name input/required validation | Blocked native; implementation-supported | `src/App.tsx:272-285,351-357` |
| ONB-03 | Person name input/required validation | Blocked native; implementation-supported | `src/App.tsx:272-285,359-370` |
| ONB-04 | Optional typed birth date and invalid-date rejection | Blocked native; Passed component | `src/App.test.tsx:115-141`; `src/App.tsx:561-572` |
| ONB-05 | Calendar birth-date picker | Blocked | `src/App.tsx:598-606`; no component test activates it |
| ONB-06 | Add another person | Blocked native; Passed component | `src/App.test.tsx:68-71,106`; `src/App.tsx:392-400` |
| ONB-07 | Remove person | Blocked | `src/App.tsx:379-389`; no test |
| ONB-08 | Filing location California display | Blocked native; implementation-supported | `src/App.tsx:401-404` |
| ONB-09 | Filing status / residency choice promised by README | Defect | `README.md:32`; only disabled California input at `src/App.tsx:401-404` |
| ONB-10 | Save & Continue | Blocked native; Passed component contract | `src/App.test.tsx:72-75`; backend transaction `src-tauri/src/lib.rs:232-299` |
| ONB-11 | Checking radio | Blocked; implementation-supported | `src/App.tsx:416-430,525` |
| ONB-12 | Savings radio | Blocked native; Passed component | `src/App.test.tsx:76-82` |
| ONB-13 | Credit-card radio | Blocked native; Passed component | `src/App.test.tsx:86-109` |
| ONB-14 | Investment radio | Blocked; implementation-supported | `src/App.tsx:416-430,528` |
| ONB-15 | Retirement radio | Blocked native; Passed restored-state component | `src/App.test.tsx:143-177` |
| ONB-16 | Account name and USD balance inputs | Blocked native; Passed component for ordinary values | `src/App.test.tsx:77-92`; `src/App.tsx:432-459` |
| ONB-17 | Credit balance sign semantics | Defect | positive values accepted by `validMoney`, `src/App.tsx:550-555`, despite debt instruction at 462-464 |
| ONB-18 | Extreme monetary boundaries / exact cents | Defect | unrestricted decimal-to-Number conversion, `src/App.tsx:550-555` |
| ONB-19 | Add another account | Blocked native; Passed component | `src/App.test.tsx:83-92` |
| ONB-20 | Remove account | Blocked | `src/App.tsx:466-476`; no test |
| ONB-21 | Back preserves in-memory and saved fields | Blocked native; Passed synthetic component | `src/App.test.tsx:143-177` |
| ONB-22 | Finish setup / duplicate activation | Blocked native; ordinary component contract passed | `src/App.test.tsx:93-112`; no repeated-action test |
| ONB-23 | Save failure shown as alert | Blocked | catch/alert at `src/App.tsx:322-325,490-493`; no test |
| ONB-24 | Interrupted after step 1 and relaunch | Blocked native; implementation indicates saved data reloads at step 1 | step selection `src/App.tsx:248-265`; no real DB/relaunch test |
| ONB-25 | Interrupted during/completed step 2 and relaunch | Blocked native; synthetic step-6 restore passed | `src/App.test.tsx:143-177`; backend completion `src-tauri/src/lib.rs:301-334` |
| ONB-26 | All onboarding mutations persist in SQLite | Blocked | native WebKit failure prevented visible actions; component repositories are mocks |
| ONB-27 | Income, recurring expenses, assets, debts onboarding promised by PLAN | Defect (unless product explicitly narrows current milestone) | `PLAN.md:19`; only people/accounts exist at `src/App.tsx:349-488` |

## Defects

### ONB-D1 — Onboarding omits filing status and residency choice

- Severity: P1; type: missing promised primary flow.
- Intended behavior: README Getting started says “Choose filing status and California residency” (`README.md:32`); PLAN says onboarding collects filing status and California residency (`PLAN.md:19`).
- Reproduction: launch a fresh profile; inspect both setup steps. Expected controls for filing status and residency. Actual: step 1 provides only a disabled `California` filing-location input; step 2 is accounts. No tax profile is written.
- Evidence/source: `src/App.tsx:333-510`; `src-tauri/src/lib.rs:126` defines `tax_profiles`, but onboarding payload/save has no tax-profile field/write (`src-tauri/src/lib.rs:101-106,232-299`).
- Relaunch: Blocked by native WebKit loader failure. Static behavior is deterministic.
- Impact/frequency: every new household cannot choose data that documentation says is required, and later tax planning lacks user filing status.
- Fix: add accessible filing-status choice and California-residency control to onboarding, validate it, transactionally persist `tax_profiles`, restore on interrupted onboarding, and include it in bootstrap. Acceptance: each supported filing status survives relaunch; residency/status affect the snapshot/tax calculation; invalid/incomplete state cannot advance.

### ONB-D2 — Positive credit-card balances are accepted and increase displayed wealth

- Severity: P1; type: misleading financial output / validation.
- Intended behavior: UI says a credit amount owed must be entered as negative (`src/App.tsx:462-464`); Net Worth should join liabilities rather than count debt as wealth (`PLAN.md:21`).
- Reproduction: fresh setup, choose Credit card, name it, enter `125.40`, Finish setup. Expected rejection or an unambiguous “amount owed” conversion to `-12540` cents. Actual: `validMoney` accepts the positive string and `toAccount` stores `+12540`; workspace sums account balances into net worth.
- Evidence/source: `src/App.tsx:550-555`; account aggregation `src/App.tsx:922`; backend has no sign constraint at `src-tauri/src/lib.rs:129,283-285`.
- Relaunch: native verification Blocked. Persisted sign is unchanged by bootstrap (`src-tauri/src/lib.rs:188-199`).
- Impact/frequency: common user interpretation of a credit-card “balance” overstates net worth by twice the debt relative to the correct negative representation.
- Fix: label as “Amount owed” and normalize positive input to negative, or require a negative value with immediate error; enforce semantics in backend too. Regression: positive, negative, zero, decimal, keyboard submit, and relaunch cases; acceptance requires a $125.40 debt to reduce net worth by $125.40.

### ONB-D3 — Large valid-looking USD inputs silently lose cent accuracy

- Severity: P1; type: data integrity / monetary boundary validation.
- Intended behavior: opening balance is a USD amount persisted in integer cents; financial input must not silently change.
- Reproduction: enter `90071992547409.91` as an opening balance. Expected a stated maximum/error or exact integer-cent persistence. Actual: regex accepts it and binary `Number` multiplication/rounding occurs outside the safe-integer range before serialization (`Math.round(Number(balance) * 100)`), so submitted cents cannot be trusted. Even larger digit strings can become `Infinity` and fail later with a backend serialization/deserialization error rather than field validation.
- Evidence/source: `src/App.tsx:550-555`; backend expects `i64` cents (`src-tauri/src/lib.rs:90-99`).
- Relaunch: native verification Blocked; corruption happens before persistence.
- Impact/frequency: uncommon boundary input but silent financial data alteration merits high priority.
- Fix: parse the decimal as a string/decimal or BigInt cents, define a safe i64/product limit, reject out-of-range values before submit, and retain exact cents. Regression at max, max+0.01, JS safe-integer boundary, very long strings, and negative equivalents; acceptance compares displayed and stored exact cents after relaunch.

### ONB-D4 — Documented guided onboarding is reduced to people and accounts

- Severity: P2; type: missing v1 flow / product-truth mismatch.
- Intended behavior: PLAN says guided onboarding collects income, recurring expenses, accounts, assets, debts, and starting balances (`PLAN.md:19`).
- Reproduction: complete both setup steps. Expected guided collection or an explicit skip/defer path for each described category. Actual: only household people and accounts are offered, and setup completes.
- Evidence/source: `src/App.tsx:333-510`; onboarding backend payload only household/people/accounts (`src-tauri/src/lib.rs:101-106`). README line 70 does call guided onboarding pre-release, so final severity/disposition should preserve this conflicting documentation rather than treat it as an unequivocal shipped claim.
- Relaunch: Blocked.
- Impact/frequency: every new user reaches a “completed” workspace without core inputs described as onboarding data.
- Fix: either implement the guided steps transactionally with skip states and relaunch restoration, or revise current-facing PLAN language/status so unfinished flows are not presented as behavior. Acceptance covers add/remove/back/error/interruption and relaunch for every new data class.

## Recommended additional tests

Real packaged/native tests should cover every row marked Blocked, with special focus on calendar activation, remove-last constraints, rapid double submit, failure between `save_onboarding_step(6)` and `complete_onboarding`, DB-unwritable errors, and actual process relaunch. Current component tests use repository mocks and therefore do not establish SQLite persistence.
