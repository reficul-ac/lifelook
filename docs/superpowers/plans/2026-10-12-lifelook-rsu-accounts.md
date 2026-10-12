# LifeLook RSU accounts implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent schema, schedule and browser tasks, with coordinated projection integration and a fresh final review.

**Goal:** Enter independent RSU grants and forecast vesting, share growth, sell-to-cover funding and federal/California wage taxes without counting unsold equity as cash.

**Architecture:** Nest grants inside a new RSU account type to preserve existing plan and backup paths. A deterministic equity schedule feeds separate asset movements and owner/employer wage facts into the calculation engine; browser forms and reports explain withholding and liquidity.

**Tech Stack:** TypeScript, Decimal.js, native browser forms, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-lifelook-rsu-accounts-design.md`

## Global constraints

- Work on main per CLAUDE.md. No git push without explicit user confirmation for repository, remote and branch.
- Preserve schema version 1, storage key and old account compatibility.
- Keep engine independent of browser APIs, clocks and storage; use Decimal for financial arithmetic.
- Support full-year California married-joint ordinary RSUs settled at vest; explicitly block deferred settlement taxes rather than guess payroll timing.
- Sell-to-cover percentage funds taxes and reduces shares; do not treat it as final tax liability or deduct it twice.

## Review focus

- Vesting before the forecast must not repeat compensation or manufacture retained opening shares.
- Multiple grants/employers must share an owner's payroll caps.
- A cliff and a final partial interval must preserve the entire awarded quantity.
- Unknown opening basis or unsupported settlement must not hide independent share-value schedules.
- Restoring existing backups and changing account type must preserve data and reference validation.

### Task 1: Account contract and validation

**Files:** `src/engine/model/plan.ts`, `src/engine/validation.ts`, `src/browser/state.ts`, engine validation tests and browser draft/storage tests.

**Interfaces:** Produce `RsuGrant`, `RsuAccountDetails` and optional `Account.rsu` with the exact spec fields. Account type is `rsu`, while existing uniform base fields remain required. Scheduler consumes these types. Parse `vestingMonths`, `cliffMonths`, share quantities and `openingBasis` appropriately.

- [x] Add failing tests for valid nested grants, bad prices/terms/share precision/percentages, unique IDs, wrong owners, RSU contribution rejection and old/new backup handling. Run targeted tests and inspect expected failures.
- [x] Implement contract and validation, including indexed account/grant error paths, opening balance policy and monetary ranges. Preserve old account fields and histories.
- [x] Run focused engine validation and browser state/storage tests.

### Task 2: Independent RSU schedule

**Files:** Create `src/engine/equity/rsu.ts` and `tests/engine/rsu.test.ts`.

**Interfaces:** Produce `rsuVestingEvents(grant)`, `projectRsuAccounts(plan)` and the `RsuGrantMonth`, `RsuVestingEvent`, `RsuProjection` types from the spec. Do not edit projection or schema files.

- [x] Add failing schedule tests: monthly/quarterly/annual, overlapping grants, a 12-month cliff, 14-month partial quarterly term, January 31 and leap anchors, opening holdings, FMV growth and 0/100% withholding. Verify failure before implementation.
- [x] Implement anchored cumulative Decimal vesting, event/closing price forecasts, net holdings, optional known basis and deferred-settlement issues.
- [x] Run focused schedule tests, assert quantities and money using independent arithmetic.

### Task 3: Tax, cash and reporting integration

**Files:** `src/engine/projection.ts`, `src/engine/projection-types.ts`, `src/engine/reporting.ts`, `src/engine/coverage.ts`, `src/engine/tax/comparison.ts`, `src/engine/index.ts`, new projection tests.

**Interfaces:** Consume the schedule. Produce optional `rsu: Available<RsuPeriod>` on monthly and annual rows; `RsuPeriod` has `taxableIncomeCents`, `withholdingCents`, `unvestedValueCents`, `grants`. Keep ordinary outputs unchanged when no RSU account exists.

- [x] Add failing comparison/conservation tests: RSU compensation versus equal cash wages has equal federal/California/payroll taxes; shares are assets, no wage cash; sell-to-cover credits the reserve once; owner SS cap is shared; future-year and preforecast schedules are correct.
- [x] Inject noncash RSU wage facts into the tax model, reserve income tax with compensation-aware weights, incorporate held values/net worth and separate tax funding. Preserve independent schedules under unsupported tax coverage and overflow.
- [x] Summarize RSU flows annually with December quantities/balances and run focused integration plus existing projection/reporting tests.

### Task 4: Entry and explanation

**Files:** `src/browser/forms/investments.ts`, create `src/browser/forms/rsu.ts` as needed, `src/browser/views/projection.ts`, `src/browser/issue-presentation.ts`, browser tests, acceptance tests.

**Interfaces:** Consume the new account contract and optional RSU period reports. Use existing field and draft APIs; store grants in the account's single save.

- [x] Add failing browser tests for account selection, two independently configured grants, computed units/years left, invalid grant prices, contribution filtering and grant review navigation.
- [x] Implement nested fields and grant reports with native controls and explanations for noncash compensation and sell-to-cover. Generate collision-safe grant IDs, preserve drafts, and reveal exact invalid fields.
- [x] Run browser tests and a Playwright save/export/restore flow using a synthetic RSU plan.

### Task 5: Review and delivery

**Files:** README, source register/RSU research references, design/plan progress.

- [x] Review tax claims against official sources; document supported settlement and forecast assumptions.
- [x] Have an independent reviewer inspect conservation, rounding, tax caps, persistence, validation and UI behavior. Resolve substantive findings with regression tests.
- [x] Run `npm run check` and `TZ=America/Los_Angeles npm run test:engine`, inspect results, mark completed tasks and commit the verified implementation on main. Do not push.

## Verification results

`npm run check` passed: 716 engine/browser tests, production build, and 11 Chromium acceptance flows. `TZ=America/Los_Angeles npm run test:engine` passed 569 tests. Independent whole-change review and scoped re-review found no remaining material issues after regression fixes for opening holdings, deferred settlement history, paper valuation availability and lifetime rounding.
