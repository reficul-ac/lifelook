# Task 4 Report: Multi-Year Retirement Projection Boundary

## Status

Implemented and verified in commit `c99532f` (`feat: calculate annual retirement scenarios`).

## Implementation

- Added the public `calculateRetirementProjection` boundary and exact Keep/Sell result contracts.
- Added `extendScenarioHorizon`, preserving the active scenario, all event dates, and all recurring end dates while extending Plan data through the last requested retirement month (1–60 years).
- Seeded annual simulation from `buildRetirementCutoff` and snapshot summaries from `calculateRetirementSnapshot`.
- Reused `ProjectionEngine` monthly rows for non-employment income, recurring expenses, home appreciation, rent, mortgage balances, and all housing components. Exported only the narrow additional monthly cash-flow fields needed by Retirement and reused the Plan growth primitive for account compounding.
- Recalculated each year's withdrawal target from starting non-home portfolio value; home equity stays outside eligible capital.
- Carried taxable-basis and Roth-contribution-basis maps through every target and shortfall draw and into following years.
- Added surplus and home-sale net proceeds to the selected taxable account and its taxable basis.
- Passed household people on every draw; shortfall draws put the selected taxable destination before the effective fallback order.
- Added annual tax-character calculation, early penalties, grossed-up shortfall funding, ending balances, and net-worth reconciliation.
- Refactored `retirementSnapshot` to export `resolveRetirementHomeSales`, the shared normalized home/sale source for snapshot and roll-forward calculations.
- Sell applies simultaneous retirement-month sales, shared incremental tax, costs, mortgage payoff, and net proceeds once, then removes all sold home income, cost, asset, and liability state.
- Added missing-destination, missing-home-data, early-withdrawal, account-depleted, unfunded-spending, activity-ended, and year-specific calculation-error warnings. Error rows clear financial maps rather than carrying prior figures.

## Strict TDD Evidence

Baseline before changes:

- `npm test -- --run src/domain/retirementSnapshot.test.ts src/domain/projection.test.ts src/domain/tax.test.ts src/domain/homeSaleTax.test.ts`
- PASS: 4 files, 147 tests.

Result contract and horizon:

- RED: `npm test -- --run src/domain/retirementProjection.test.ts`
- Expected failure: Vite could not resolve `./retirementProjection`.
- GREEN: 1 file, 2 tests.

Keep-home roll-forward:

- RED: same focused command, 4 intended failures on zero starting portfolio/target values.
- Covered target recalculation, surplus/basis deposit, monthly returns, rent, Plan expenses, full housing costs, mortgage amortization, shortfall order/fallback, and net-worth reconciliation.
- A fixture initially omitted `annualGrowthBps: 0`; Plan correctly inflated it. The fixture was corrected to match its hand-derived fixed-expense literals.
- GREEN: 1 file, 6 tests; projection regression run also passed 50/50 tests.

Sell-home roll-forward:

- RED: Sell reused Keep state (`5,000,000` starting portfolio instead of after-sale capital).
- The hand-derived California incremental-tax literal was corrected from `89,192` to `116,070` after checking the existing primitive's baseline-delta rules; resulting net proceeds are `25,383,930`.
- GREEN: retirement projection plus retirement snapshot, 46/46 tests.

Warnings and errors:

- RED: 4 intended failures for missing destination, unfunded spending, ended activity, and cleared calculation-error rows. The owner-specific IRA penalty/depletion test already passed because people were supplied on every draw.
- GREEN: retirement projection, 13/13 tests.

Final fresh verification:

- `npm test -- --run src/domain/retirementProjection.test.ts src/domain/retirementSnapshot.test.ts src/domain/projection.test.ts src/domain/tax.test.ts src/domain/homeSaleTax.test.ts`
- PASS: 5 files, 160 tests.
- `npm run build`
- PASS: TypeScript project build and Vite production build, exit 0.
- `npm test`
- PASS: full repository suite, 15 files and 283 tests.
- `git diff --check`
- PASS: no whitespace errors.

## Files

- Created `src/domain/retirementProjection.ts`.
- Created `src/domain/retirementProjection.test.ts`.
- Modified `src/domain/retirementSnapshot.ts`.
- Modified `src/domain/projection.ts`.
- Modified `src/domain/types.ts`.
- Modified `src/domain/index.ts`.

## Self-Review and Concerns

- No blocking concerns found. The public result fields, scenario immutability, exact horizon, basis-map continuity, owner-aware penalties, destination-first shortfalls, shared sale resolution, and warning scoping were checked against the brief.
- Non-blocking modeling note: Task 3 exposes aggregate taxable gain but not tax-lot holding period, so this boundary applies federal capital-gain brackets to that aggregate and California ordinary-income brackets. Short-term/long-term lot allocation would require a future Task 3 contract extension.
- The `.superpowers` tree was otherwise left untouched and was not included in the initial source commit.

---

## Review Fix Round 1

### Status

All seven Critical/Important findings were reproduced, fixed, and verified. The review fix is committed with message `fix: preserve retirement projection value and tax boundaries` on top of `c99532f`.

### Result

- Removed the retirement-only 1,200-month ceiling, the cutoff 1,200-month ceiling, and the projected-tax 2100 ceiling. Normal Plan horizons remain capped at 480 months. A 2099 retirement now completes all 60 annual rows through 2158.
- Wrapped every retirement-year calculation independently. A year failure produces cleared `calculation-error` rows inside each scenario instead of throwing away Keep and Sell together.
- Replaced retirement-year tax approximation with calendar-year household increments. A July-to-June row now stacks its first six months on cutoff wages, uses next-year rules for its second six months, and aggregates both calendar liabilities into the display row.
- Added a shared incremental household-tax primitive that reuses projected rule packs, federal SALT limits, the $750,000 mortgage-interest limit, California itemization, jurisdiction-specific income, and incremental California tax in federal SALT.
- Composed Sell home gain, retirement distributions, taxable non-wage income, and rental income against the same household baseline. The composed sale tax now drives the Sell row, opening portfolio, withdrawal target, net proceeds, and Sell summary.
- Added source-tagged monthly Plan account transitions for pre-tax contributions, account contributions/transfers, purchase and ADU funding, loan origination/payoff, and sale proceeds. Automatic surplus allocation remains intentionally absent. Retirement applies these transitions once, alongside monthly returns, and updates taxable basis/lots.
- Maintains the owned-home set dynamically. Sell removes only IDs actually sold at retirement; a later planned home, its funding, carrying costs, rent, asset, liability, and home-equity exclusion remain in both scenarios.
- Missing/invalid taxable destinations now clear any row that would otherwise lose surplus or positive sale proceeds. Negative sale proceeds never create a negative brokerage or basis; they reduce eligible opening capital and use destination-first normal shortfall funding.
- Rental tax uses the separate federal and California allowed-income fields and deducts only the personal share of housing. Disabled modeling, unresolved passive loss limits, and unresolved federal/California carryforwards return structured `unsupported-rental-tax` plus `calculation-error` rows.
- Extended withdrawal results with FIFO lot state, federal short-/long-term gain, California gain, and a supported-character flag. Complete positive-gain lots are taxed by exact character and carried across draws/years; missing lots or unsupported loss/carry treatment return structured `unsupported-tax-character` rows rather than false exact tax.
- Replaced the eight-pass gross-up with a monotone binary search over available ordered balances. The solver finds the smallest cent draw whose after-tax proceeds cover the need, or reports only the genuine residual after exhaustion.

### Review TDD Evidence

Late 60-year horizon:

- Mutation named: restore either the year-2100 tax ceiling or 1,200-month retirement cap.
- RED: `npx vitest run src/domain/retirementProjection.test.ts -t "supports a late retirement through every year of the maximum horizon"`
- Failure: `RangeError: Projection horizon must be between 1 and 480 months` from the retirement extension's hidden 1,200-month branch.
- GREEN: 1 selected test passed; 60 rows span literal years 2099–2158 in both scenarios.

Source-tagged value transitions and dynamic homes:

- Mutation named: omit a Plan account event or export automatic surplus and double-count it.
- RED: `npx vitest run src/domain/projection.test.ts -t "exports source-tagged account event transitions"`
- Failure: `accountTransitions` was `undefined` instead of the literal contribution, transfer, origination, and payoff deltas.
- GREEN: the focused projection test passed.
- Mutations named: copy Plan assets/liabilities without account deltas; treat Sell as a permanent all-home filter.
- RED: retirement focused run reported `10,000,000` instead of `12,998,500` for the taxable account, and Sell omitted the later home's `844,174` cents of carrying cost.
- GREEN: both selected retirement tests passed with `16,000,000` ending net worth for the event case and `7,155,826` next-year eligible capital for the planned-home case.

Destination and negative proceeds conservation:

- Mutations named: leave a successful row after dropping destination surplus; deposit negative sale proceeds directly.
- RED: missing-destination row lacked `calculation-error`; underwater sale reported zero shortfall rather than the literal `5,000,000` closing need.
- GREEN: both selected tests passed. The underwater sale exhausts `2,000,000` and reports exactly `3,000,000` unfunded without a negative account.

Tax-lot character:

- Mutation named: collapse lots into aggregate long-term basis.
- RED: FIFO draw reported `75,000` gain rather than `22,500` and omitted holding/jurisdiction fields.
- GREEN: withdrawal test returned `12,500` short federal gain, `10,000` long federal gain, `25,000` California gain, and the literal remaining recent lot.
- Mutation named: present aggregate brokerage basis as an exact tax result when lots are absent.
- RED: projection returned populated balances instead of an unavailable row.
- GREEN: selected projection test passed with `unsupported-tax-character` and cleared financial maps.

Gross-up convergence:

- Mutation named: stop high-rate early-distribution gross-up after eight geometric passes.
- RED: gross withdrawals stopped at `273,069,089` rather than the hand-derived cent fixed point.
- GREEN: selected test passed at `277,120,458` gross, `129,408,412` income tax, `27,712,046` penalty, and exactly `120,000,000` after tax with no false residual.

Household deduction seam:

- Mutation named: allow full personal mortgage interest or uncapped property tax.
- RED: `calculateIncrementalHouseholdIncomeTax` did not exist.
- GREEN: selected tax test passed with literal federal deduction `5,040,000`, California deduction `7,000,000`, and total incremental tax `570,400`.

Calendar years and Sell composition:

- Mutations named: tax a July-to-June row once under start-year rules; calculate sale tax before retirement income.
- RED: July row cleared/omitted its `12,000,000` pension and Sell retained standalone sale tax `1,295,542` instead of the composed amount.
- GREEN: both selected tests passed. July incremental tax is `2,644,815`; composed Sell retirement tax is `22,020,228`, sale tax is `3,510,000`, net proceeds are `16,490,000`, and combined tax is `25,530,228`.
- Mutation named: update the Sell row but leave its summary/opening target on standalone tax.
- RED: summary retained tax `1,295,542`, proceeds `18,704,458`, and opening portfolio `118,704,458`.
- GREEN: summary and row now share tax `3,510,000`, proceeds `16,490,000`, opening capital `116,490,000`, and target `11,649`.
- Expected-literal correction during final verification: adding the incremental California liability to the shared federal SALT calculation reduced retirement tax from the earlier incomplete `22,700,817` reference to the final `22,020,228`; the production result matches the household deduction rules.

Rental treatment:

- Mutations named: silently make unsupported rent nontaxable; double-deduct mixed-use housing.
- RED: disabled-modeling row retained balances; mixed-use tax was `2,278,312` instead of `2,784,712`.
- GREEN: both selected tests passed; `24,000,000` rent, `14,531,528` total property tax, and personal-only housing deduction produce the literal tax.
- Mutation named: deduct a raw passive loss without limits.
- RED: loss row retained account/asset balances.
- GREEN: selected test passed with `unsupported-rental-tax` and cleared maps; a documented non-passive material-participation fixture remains supported.
- Mutation named: ignore unequal federal/California passive carryforwards.
- RED: positive-rent row retained `109,578,941` in the destination and presented tax.
- GREEN: selected test passed with a structured unavailable row.

### Final Fresh Verification

- Brief command: `npm test -- --run src/domain/retirementProjection.test.ts src/domain/retirementSnapshot.test.ts src/domain/projection.test.ts src/domain/tax.test.ts src/domain/homeSaleTax.test.ts && npm run build`
- PASS: 5 files, 174 tests; TypeScript project build and Vite production build passed, exit 0.
- Affected withdrawal/cutoff command: `npm test -- --run src/domain/retirementWithdrawals.test.ts src/domain/retirementCutoff.test.ts`
- PASS: 2 files, 26 tests.
- Full suite: `npm test -- --run`
- PASS: 15 files, 298 tests.
- `git diff --check`
- PASS: no whitespace errors.

### Review-Fix Files

- `src/domain/retirementProjection.ts`
- `src/domain/retirementProjection.test.ts`
- `src/domain/projection.ts`
- `src/domain/projection.test.ts`
- `src/domain/retirementCutoff.ts`
- `src/domain/retirementWithdrawals.ts`
- `src/domain/retirementWithdrawals.test.ts`
- `src/domain/tax.ts`
- `src/domain/tax.test.ts`
- `src/domain/types.ts`
- `.superpowers/sdd/2026-08-21-retirement-scenario-projections/task-4-report.md`

### Review-Fix Concerns

- No blocking concern remains.
- Deliberate conservative boundary: passive rental losses/carryforwards and taxable brokerage gains without complete positive-gain lot character produce structured calculation-error rows. This is preferable to displaying false precision; adding full loss carry ledgers can make those cases available later without changing the warning contract.
- The `.superpowers` tree was otherwise left untouched.
