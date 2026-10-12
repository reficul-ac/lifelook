# LifeLook Foundation Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified federal/California household projection engine and a plain browser workspace for one locally saved financial plan.

**Architecture:** A separate `foundation/` package owns immutable plan documents, pure TypeScript calculators, versioned tax rules, and independent reference fixtures. Annual tax resolution precedes monthly account deposits and cash reconciliation; native browser forms consume the engine through one public boundary. Preserve the React/Tauri application while the replacement passes the three milestone gates.

**Tech Stack:** TypeScript, decimal.js, Vite, Vitest (Node engine tests and jsdom browser tests), Playwright, native HTML forms, localStorage, JSON backups. Reuse the repository's compatible TypeScript/Vite/Vitest versions; declare decimal.js directly and commit the replacement package's own lockfile.

**Spec:** `docs/superpowers/specs/2026-10-11-lifelook-foundation-rebuild-design.md` (read alongside this plan).

## Global Constraints

- “USD only; two adult tax filers who are full-year California residents.”
- “Forecasts begin January 1 of a chosen year.”
- “The default horizon is 30 years, adjustable from 1 through 40.”
- “A new plan defaults to the next calendar year”; pass the current calendar date into document creation, never read the clock in the engine.
- “Properties already exist at the forecast start, and included rental units are already available for rent at that date.”
- “ADUs and whole-property rentals use ordinary long-term, fair-market leases without personal use of the rental unit or substantial tenant services.”
- “The initial rule baseline is tax year 2026.”
- “defaulting to 0% until changed”: future indexed-threshold growth; fixed thresholds remain fixed and enacted changes override projection assumptions.
- “User-entered rates have 0.01 percentage-point precision.” Store integer basis points; growth is greater than -100%, APR is nonnegative, and rates above 1,000% are unsupported.
- “Every stored or reported monetary amount must be a safe integer with absolute value at most `99_999_999_999_999` cents”; check intermediate aggregates before converting to numbers.
- “use decimal arithmetic with at least 34 significant digits”; use a private decimal.js constructor with 40 significant digits, cash rounding ties away from zero, and separate official tax rounding.
- “Contribution deposits occur at month end and first participate in growth the following month.”
- “Each dependent result has an availability state: `available`, `needs-data`, or `unsupported-case`”; unavailable results carry no numeric value.
- “Rule provenance (`verified`, `provisional`, `projected`) and scenario coverage are separate metadata.”
- “Withdrawals and retirement planning are explicitly deferred”; distribution-dependent years disclose incomplete total-liability coverage.
- “Use synthetic fixtures; do not embed the user's financial records.” Expected tax values come from independent primary-source worksheets, never the production rule tables.
- “Keep the existing application and the user's uncommitted edits intact”; no removal, migration of legacy user data, or deployment in this plan.
- Before every push, obtain explicit confirmation for the exact repository, remote, and branch. This user instruction overrides `CLAUDE.md`'s older standing push permission; no task below includes a push.

## Review Focus

1. Unknown historical depreciation, at-risk/passive/AMT/QBI losses: preserve unknowns, block dependent current/later tax totals, and retain independent schedules (Tasks 5, 7, 10, 14).
2. One owner with multiple employers/accounts and late-year catch-up changes: share owner limits, use sponsoring-employer history, and settle overlapping contribution rules in visible priority order (Task 6).
3. Individually valid amounts that overflow in aggregate or during a 40-year high-growth forecast: return a located issue and no approximate total (Tasks 1, 13, 14).
4. Streams beginning before the forecast, leap-day anniversaries, and ranges ending midmonth: retain pre-forecast changes and apply inclusive, timezone-independent timing (Task 3).
5. A valid saved revision followed by invalid drafts, malformed restoration, or storage failure: retain drafts/results with accurate revision and save status, and keep the in-memory document exportable (Tasks 15, 16, 18).

---

## Scope, workspace, and dependency decisions

This is one plan: rental loss state, IRA eligibility, deduction choices, and monthly funding depend on the same household/year facts. Splitting them into independently shipped subsystems would expose incomplete liabilities. The browser and storage tasks follow the verified engine; the three gates below mirror the spec's milestones.

Planning creates only this document. Execution starts after plan review and selection of an execution method. At execution time use `superpowers:using-git-worktrees` to establish isolation. The current checkout is `main` with user edits in `src/App.tsx` and `src/App.test.tsx`; `CLAUDE.md` also requests main-only work. Prefer a managed isolated checkout retaining `main`, or a local independent clone on `main` under `/tmp` when a linked worktree would require a feature branch. Do not stash, reset, copy over, or commit those user edits. Commit implementation tasks only in that isolated repository; returning commits to the original checkout is separate integration work.

Tasks 1–12 establish the tax/property foundation; Tasks 13–14 deliver the unified projection; Tasks 15–18 deliver the browser workspace. Tasks 3 and 4 can be implemented independently after Task 1, and Tasks 10 and 11 after their stated inputs exist. Other dependencies are explicit in each Interfaces block. Execute reviewable tasks in order by default.

## File structure and ownership

All paths below are repository-relative; brace notation enumerates exact filenames. Tests mirror the responsible engine/browser module. Do not import `src/domain/*`: existing tests suggest invariants, but existing SALT, California projection, depreciation, and surplus-contribution formulas do not meet this spec.

| Paths | Responsibility |
| --- | --- |
| `foundation/package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html` | Independent package, strict checking, engine/browser test projects, browser entrypoint |
| `foundation/src/engine/model/{plan,results,tax-state}.ts` | Readonly document, result, and carried-history contracts |
| `foundation/src/engine/{money,dates,validation,coverage}.ts` | Decimal/date primitives, structural validation, supported-case checks |
| `foundation/src/engine/rules/{types,federal-2026,california-2026,payroll-2026,retirement-2026,registry,projection}.ts` | Sourced baseline rules and deterministic future policies |
| `foundation/src/engine/cash/{income,expenses,contribution-requests}.ts` | Dated income, recurring expenses, requested deposits |
| `foundation/src/engine/property/{loans,allocation,depreciation,facts}.ts` | Debt cash schedules and separate property/rental tax books |
| `foundation/src/engine/tax/{facts,workplace,payroll,rental-losses,modified-income,ira,mortgage,itemized,federal,california,comparison}.ts` | Annual contribution and tax resolution; no browser or growth logic |
| `foundation/src/engine/{growth,projection,reporting,index}.ts` | Account/property growth, annual coordinator, reconciled reporting, public API |
| `foundation/src/browser/{main,state,storage,fields}.ts` and `styles.css` | Workspace lifecycle, draft/save state, storage adapters, field parsing, minimal presentation |
| `foundation/src/browser/forms/{household,income,expenses-debts,investments,properties}.ts` | Focused native input sections |
| `foundation/src/browser/views/{projection,tax-explanation,issues}.ts` | Annual/monthly results, tax trace, actionable issues |
| `foundation/tests/helpers/{plans,references,dom}.ts`, `tests/{engine,browser,e2e}/` | Synthetic builders, independent expected values, browser acceptance |
| `foundation/fixtures/{math,tax}/`, `sources/{register,2025-reference,2026}/` | Checked calculations, source excerpts/snapshots, publication/applicability metadata |
| `foundation/playwright.config.ts`, `foundation/README.md`, `.github/workflows/foundation.yml` | Browser acceptance, local run/backup instructions, independent CI gate |
| `vitest.config.ts` | Only add an explicit legacy `src/**/*.test.{ts,tsx}` include so root Vitest does not discover the new package's tests |

Use Node 22 for the replacement CI, compatible with the currently installed runtime. Declare TypeScript, Vite, Vitest, jsdom, `@types/node`, `@testing-library/dom`, `@testing-library/jest-dom`, and `@playwright/test` as direct development dependencies, plus decimal.js as a runtime dependency. Scripts are `dev` (Vite localhost port 1421), `test` (all Vitest projects), `test:engine` (`vitest run --project engine`), `test:browser` (`vitest run --project browser`), `test:e2e` (Playwright), `typecheck`, `build`, and `check` (typecheck, unit/component tests, build, E2E). Playwright's web server runs the production preview on localhost port 4174 with strict port selection. Resolve and lock compatible direct dependencies during Task 1; no legacy dependency upgrade. Keep browser entrypoint/build wiring until Task 16; earlier gates run tests/typecheck only.

## Shared contract vocabulary

Task 1 defines these names; later tasks extend their owning result types before exposing a new function. All records/arrays are readonly and IDs are strings. JSON contains safe integer cents and basis points, never Decimal instances.

- `Cents = number`, `BasisPoints = number`, `ISODate = string`, `YearMonth = string` (validated `YYYY-MM-DD` / `YYYY-MM`). `History<T> = { known: true; value: T } | { known: false }`; explicitly confirmed zero is a known value of zero.
- `Issue = { code: string; recordId?: string; year?: number; field?: string; severity: 'error' | 'warning' | 'info'; explanation: string; resolution: string }`.
- `Available<T> = { status: 'available'; value: T } | { status: 'needs-data' | 'unsupported-case'; issues: readonly Issue[] }`. Do not add `value: 0` or `value: null` to unavailable branches.
- `RuleProvenance = { status: 'verified' | 'provisional' | 'projected'; ruleVersion: string; baselineYear: number; applicableYear: number; sources: readonly string[]; assumptions: readonly string[] }`. `Coverage = { completeForModeledScope: boolean; completeHouseholdLiability: boolean; issues: readonly Issue[] }` is separate.
- `PlanDocument = { schemaVersion: 1; id: string; revision: number; startYear: number; horizonYears: number; openingCashCents: Cents; household: Household; taxPolicy: TaxPolicy; salaries: readonly Salary[]; otherIncome: readonly OtherIncome[]; expenses: readonly Expense[]; accounts: readonly Account[]; contributions: readonly ContributionRule[]; debts: readonly Debt[]; properties: readonly Property[]; rentals: readonly RentalUnit[] }`.
- `ValidatedPlan` is the validated readonly `PlanDocument` with a type brand. `ValidationResult = { ok: true; plan: ValidatedPlan; issues: readonly Issue[] } | { ok: false; issues: readonly Issue[] }`. Known missing tax history is structurally valid and produces coverage issues, rather than preventing all editing.
- `Household`: exactly two `Filer` records (`id`, `name`, `birthDate: History<ISODate>`, `workplaceCoverage: History<boolean>`, annual coverage overrides); `filingStatus: 'married-joint'`, `residence: 'CA-full-year'`, `currency: 'USD'`. Explicit coverage answers identify additional income/credits, rental qualifications, and omitted distribution circumstances; unknown answers are distinguishable from confirmed absence. New documents start with unknown ages/coverage and display required-data results until supplied; never fabricate birth dates or current workplace coverage to initialize the app.
- `TaxPolicy`: `baselineYear: 2026`, `futureIndexGrowthBps` default 0, and `actualStateTaxPaidByYear: readonly { year: number; californiaIncomeTaxPaidCents: Cents; sdiPaidCents: Cents }[]`. Annual overrides replace the deduction-payment assumption, not assessed tax or reserve cash flows.
- `Salary`: ID/name, `ownerId`, `employerId`, `annualGrossCents`, inclusive `startDate`/optional `endDate`, `annualRaiseBps`, `raiseMonth`, `raiseDay`, and `changes: readonly ({ date: ISODate; kind: 'percent'; percentBps: BasisPoints } | { date: ISODate; kind: 'amount'; annualGrossCents: Cents })[]`.
- `OtherIncome`: ID/name, `amountCents`, `frequency: 'monthly' | 'annual'`, date range, `annualGrowthBps`, `classification: 'wage' | 'ordinary-taxable' | 'non-taxable'`, required owner/employer for wages, and `niitTreatment: 'included' | 'excluded' | 'unknown'` for taxable nonwage income. Cash interest/ordinary dividends are included; unresolved characterization blocks NIIT. Qualified dividends/realized gains are unsupported. `Expense` has the same payment timing plus optional property/rental IDs, `use: 'personal' | 'rental' | 'shared'`, allocation override, and `taxCategory: 'property-tax' | 'homeowners-insurance' | 'mortgage-insurance' | 'repair' | 'operating' | 'capital' | 'personal'`.
- `Account`: ID/name/owner, `type: 'taxable-brokerage' | 'traditional-401k' | 'roth-401k' | 'traditional-ira' | 'roth-ira'`, `openingBalanceCents`, `annualGrowthBps`, and `openingIraBasis: History<Cents>`. Growth is unrealized; account basis is not inferred from its balance.
- `ContributionRule`: ID, `accountId`, integer `priority`, dates, `amount: { kind: 'fixed'; monthlyCents: Cents } | { kind: 'salary-percent'; salaryId: string; percentBps: BasisPoints }`, and required `sponsoringSalaryId` for 401(k). Employer-year assumptions supply prior-year employer wages, plan catch-up availability, and Roth catch-up availability as `History` values.
- `Debt`: ID/name, `openingBalanceCents`, `aprBps`, `monthlyPaymentCents`, `firstPaymentMonth`, optional `propertyId`. `PropertyLoan` additionally has ID, original principal, origination/acquisition dates, term, first-payment date, `openingBalance: History<Cents>`, `openingPayment: History<Cents>`, collateral, proceeds qualification/allocation, and financing-at-risk qualification. Store loans only under properties; unique IDs prevent duplication in `debts`.
- `Property`: ID/name, `role: 'primary' | 'rental' | 'primary-with-adu'`, purchase date/price/down payment, `openingValueCents`, `appreciationBps`, yearly rate overrides, primary/ADU living areas where applicable, and linked loans. `RentalUnit`: ID/property ID, rent/date/growth assumptions, `availableDate`, active participation, shared allocation, explicit loan allocations, qualification answers, and independent federal/California/AMT building/depreciation/at-risk/passive histories. Converted properties also record conversion FMV excluding land; QBI qualification and loss history are explicit. Unresolved advanced financing/basis adjustments are coverage issues, not invented inputs.
- Use `TaxBook = 'federal' | 'california' | 'federal-amt' | 'california-amt'`; neither jurisdiction can reuse the other's AMT history. `RentalUnit.taxHistory` maps each book to `History<RentalBookState>`; `RentalBookState` records `recoveryBasisCents`, `adjustedBuildingBasisCents`, `cumulativeDepreciationCents`, `atRiskCents`, `atRiskSuspendedCents`, `passiveSuspendedCents`, and source-qualified loss vintages. Distinguish original recovery basis from remaining adjusted basis rather than restarting a full depreciation schedule on the remaining basis. `RentalUnit.qbi` holds qualification, wage/UBIA facts, and QBI opening loss vintages as explicit known/unknown values. `HouseholdTaxState` maps rental IDs/books to their available carried state, owner IDs to IRA basis, and contains federal/CA minimum-tax-credit coverage markers. `initialTaxState(plan: ValidatedPlan): HouseholdTaxState` reads only declared opening history.
- Exact nested field names: `Household.filers`, `Household.coverageAnswers`, `Filer.coverageByYear`, `Filer.employerAssumptionsByYear`; `Property.loans`, `Property.primaryArea`, `Property.aduArea`, `Property.appreciationOverrides: readonly { year: number; rateBps: BasisPoints }[]`; `PropertyLoan.originalPrincipalCents`, `originationDate`, `acquisitionDate`, `termMonths`, `firstPaymentDate`; `RentalUnit.monthlyRentCents`, `rentGrowthBps`, `rentStartDate`, `rentEndDate`, `activeParticipation`, `conversionBuildingFmv: History<Cents>`. Loan allocation/qualification records retain referenced rental/property IDs and exact numerator/denominator shares.

## Milestone 1: Verified tax/property foundation

### Task 1: Validated documents and exact money/calendar primitives

**Files:** Create the package/configuration files above (browser entrypoint wiring follows in Task 16); `foundation/src/engine/model/{plan,results,tax-state}.ts`, `{money,dates,validation,coverage}.ts`; `foundation/tests/helpers/plans.ts`; `foundation/tests/browser/setup.ts` for jest-dom matchers; `foundation/tests/engine/core.test.ts`. Modify root `vitest.config.ts` test include only.

**Interfaces:** Produces the shared vocabulary/`initialTaxState`, `validatePlan(raw: unknown): ValidationResult`, `createPlan(today: ISODate, id: string): PlanDocument`, `settleCents(value: Decimal): Cents`, `settleSeries(values: readonly Decimal[]): readonly Cents[]`, `calendarDate(year: number, month: number, day: number): ISODate` (clamps absent days), and `checkCoverage(plan: ValidatedPlan, year: number): Coverage`. `money.ts` exports the private `Decimal` constructor and `CalculationRangeError extends RangeError` with code `'monetary-overflow'`. The test helper `makePlan(overrides?: Partial<PlanDocument>): PlanDocument` supplies synthetic 2026, one-year, known-empty finances for owners `owner-a`/`owner-b`, born 1980/1982; `mustValidate(doc: PlanDocument): ValidatedPlan` throws on structural errors.

- [ ] **Step 1: Establish the test runner and write the failing core tests.** Configure separate Node and jsdom projects restricted to `tests/engine/**/*.test.ts` and `tests/browser/**/*.test.ts`; typecheck includes source, helpers, unit/browser/E2E tests, and configs. Add the named tests/assertions:

```ts
it('settles cumulative annual cents and signed ties', () => {
  expect(settleCents(new Decimal('0.5'))).toBe(1);
  expect(settleCents(new Decimal('-0.5'))).toBe(-1);
  expect(settleSeries(Array.from({ length: 12 }, () => new Decimal(100001).div(12)))
    .reduce((a, b) => a + b, 0)).toBe(100001);
});
it('clamps leap dates and injects the default year', () => {
  expect(calendarDate(2027, 2, 29)).toBe('2027-02-28');
  expect(createPlan('2026-10-11', 'new').startYear).toBe(2027);
  expect(createPlan('2026-10-11', 'new').horizonYears).toBe(30);
});
it.each([0, 41])('rejects horizon %i', horizonYears => {
  expect(validatePlan(makePlan({ horizonYears })).ok).toBe(false);
});
```

Also assert duplicate/dangling IDs, invalid dates, unknown enums, wage records without employer/owner, same-date salary changes, negative nonnegative amounts, unsafe/over-limit cents, invalid allocations, future property availability, APR below zero, growth -100%, and rates above 1,000% produce located issues. Assert unknown basis/history remains unknown and a valid plan with it can be edited. Set up these cases with literal mutations of `makePlan()`, not production-generated expected values.

- [ ] **Step 2: Run the red test.** Run `npm --prefix foundation test -- tests/engine/core.test.ts`; expected failure is missing engine exports after the runner starts successfully.
- [ ] **Step 3: Implement the shared contracts and primitives.** Define every input above in its focused model module. Use decimal.js's private cloned constructor, prohibit non-finite values, and check decimal sums before number conversion. Validate complete ISO calendar dates using integer calendar arithmetic, not local `Date`. Sort derived copies; never mutate documents. Distinguish structural invalidity from required-data/unsupported-case coverage. Define annual carried state with per-rental federal/CA/AMT depreciation, at-risk/passive loss balances, and federal QBI loss vintages; unknown states propagate.
- [ ] **Step 4: Verify core contracts and package isolation.** Run `npm --prefix foundation run typecheck`, the core test command, and `npm exec -- vitest list --filesOnly`; expected core PASS and legacy discovery contains only `src/` tests. Run the core test once with `TZ=UTC` and once with `TZ=America/Los_Angeles`; identical results.
- [ ] **Step 5: Commit.** Stage the new foundation package/configs/core files and root Vitest include; commit `feat: add validated foundation documents and exact primitives`.

### Task 2: Versioned 2026 rules and independent reference fixtures

**Files:** Create all `foundation/src/engine/rules/*.ts` listed above; `foundation/tests/helpers/references.ts`; `foundation/tests/engine/rules.test.ts`; `foundation/sources/register.md`, source snapshots under `sources/2025-reference/` and `sources/2026/`; `foundation/fixtures/tax/rules-2026.json`.

**Interfaces:** Produces `RuleSet` (versioned federal/CA/payroll/retirement baseline packs), `YearRules`, `loadRuleSet(): RuleSet`, `resolveYearRules(ruleSet: RuleSet, year: number, policy: TaxPolicy): Available<YearRules>`. Packs store `RuleValue<T>` including value, publication/applicable year, effective dates, source URLs, review date, status, legal indexing/rounding policy, and enacted transitions. Resolved `YearRules` exposes plain numeric constants under `federal`, `california`, `payroll`, `retirement`, with corresponding field-path provenance separately. Test-only `loadReferences<I, O>(suite: string): readonly ReferenceCase<I, O>[]` reads a named JSON suite from `fixtures/math/` or `fixtures/tax/`; each case has `id`, `taxYear`, `sources`, `input`, `worksheetSteps`, `expected`, `toleranceCents`, and `ruleVersions`. All structural/nonmoney values compare exactly; `assertReference<O>(actual: O, expected: O, toleranceCents: number): void` compares monetary leaves within the declared tolerance and rejects missing/unexpected fields. Use it instead of strict equality only when the fixture explicitly permits nonzero monetary tolerance.

- [ ] **Step 1: Write independent rules tests and source records.** Transcribe expected constants from applicable official documents, separately from production packs. Initial exact assertions:

```ts
it('uses enacted 2026 SALT and published retirement amounts', () => {
  const r = resolveYearRules(loadRuleSet(), 2026, makePlan().taxPolicy);
  if (r.status !== 'available') throw new Error('missing rules');
  expect(r.value.federal.salt.capCents).toBe(4040000);
  expect(r.value.federal.salt.phaseoutStartCents).toBe(50500000);
  expect(r.value.federal.salt.reductionBps).toBe(3000);
  expect(r.value.federal.salt.floorCents).toBe(1000000);
  expect(r.value.retirement.electiveDeferralLimitCents).toBe(2450000);
  expect(r.value.retirement.iraLimitCents).toBe(750000);
});
it('projects only indexable rules and preserves future-law transitions', () => {
  // Use independently transcribed 2027/2030 examples in rules-2026.json.
  for (const c of loadReferences<TaxPolicy, Available<YearRules>>('rules-2026')) {
    const actual = resolveYearRules(loadRuleSet(), c.taxYear, c.input);
    expect(actual).toEqual(c.expected);
  }
});
```

The fixture matrix includes 0% and nonzero index growth, fixed Additional Medicare/NIIT thresholds, SALT transition years, finite-duration age deductions, employer catch-up changes, jurisdiction-specific rounding, and source-inconsistent/missing California constants. A missing constant without an explicit assumption is `needs-data`; an explicit provisional value produces numeric rules with provisional provenance. Record the source discrepancy instead of copying an inconsistent table row.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/rules.test.ts`.** Expected FAIL for missing rule registry/projection behavior.
- [ ] **Step 3: Implement rule loading and legal projection.** Populate field-level sourced packs from the spec's register. Full 2025 sources are historical references, not a competing baseline. Freeze rule inputs; apply effective-year enacted transitions first and explicit indexing only to legally indexable values. Distinguish annually administered rates such as SDI from indexed dollar thresholds; carry the baseline rate forward only as an explicit projected assumption. For any California amount still unresolved after statutory checking, a usable baseline may explicitly carry forward its last published amount as a named provisional proxy; record the source year and assumption per field. Aggregate provenance from the fields actually used; never stamp mixed packs fully verified. Snapshot applicable worksheet/table material with retrieval/publication dates and content hashes; tests never fetch live pages.
- [ ] **Step 4: Run the rules test and typecheck.** Expected PASS, every included numeric constant/transition has a source record, and every JSON reference has inputs, worksheet steps, expected values, and tolerance. Verify every unresolved field is either unavailable or backed by a named explicit provisional assumption.
- [ ] **Step 5: Commit.** Stage rules, reference helper, rule tests/fixtures, and source register/snapshots; commit `feat: add sourced tax rules and independent reference harness`.

### Task 3: Dated salaries, recurring payments, and requested contributions

**Files:** Create `foundation/src/engine/cash/{income,expenses,contribution-requests}.ts`, `foundation/tests/engine/cash.test.ts`, and `foundation/fixtures/math/cash.json`. Extend result contracts in `model/results.ts`.

**Interfaces:** Consumes `ValidatedPlan` and decimal/calendar primitives. Produces `resolveCashYear(plan: ValidatedPlan, year: number): CashYear`, with twelve monthly gross income/expense entries, employer/owner wage facts, positive gross-cash weights, and per-stream salary-period facts; `requestContributions(plan: ValidatedPlan, cash: CashYear): readonly ContributionRequest[]`. Internal salary-period `unroundedEarnedCents` is a canonical decimal string for lossless reference fixtures; parse it with the private Decimal constructor, and never display/export it as a settled monetary amount. Each request has `ruleId`, `accountId`, `ownerId`, `year`, `month`, `priority`, and `requestedCents`; keep sponsoring salary/employer facts.

- [ ] **Step 1: Write cash fixtures and failing assertions.** Create synthetic salary/recurrence/contribution inputs in `cash.json`, with independent calendar arithmetic:

```ts
it.each(loadReferences<PlanDocument, CashYear>('cash'))('$id', c => {
  expect(resolveCashYear(mustValidate(c.input), c.taxYear)).toEqual(c.expected);
});
```

Cases must assert annual `100001` cents sums exactly; a 2028 February salary changing from `12000000` to `24000000` annual cents on February 15 settles February to `1517241` cents; midmonth end is inclusive; amount zero stops salary; first automatic raise is strictly after start; explicit same-day changes suppress automatic raises; later raises use the changed salary; pre-forecast raises remain effective; February 29 clamps in 2027; monthly day 31 clamps; annual/monthly payments occur only on scheduled dates; rent is prorated while expenses are not. Name the Review Focus fixture `pre-forecast-leap-day-midmonth-end`. Assert fixed contribution ending before month end is zero and salary-percent contribution uses only intersecting active salary days. Wage-classified ordinary income contributes owner/employer wages; non-taxable income is cash but not taxable income. Rent is not duplicated in other income.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/cash.test.ts`.** Expected FAIL for missing streams/requests.
- [ ] **Step 3: Implement the three signatures.** Build salary periods from start, raises, and dated changes, including history before the forecast. Use actual days divided by that month's days for salary/rent proration and cumulative calendar-year cent settlement per stream. Apply January 1 growth strictly after other-income/expense/rent starts; schedule payments by original month/day with clamps. Requested contributions use their own cumulative settlement and stable priority; eligibility remains unresolved here. Property-linked expenses have one cash identity and retain tax/allocation metadata for Task 5.
- [ ] **Step 4: Run cash tests under UTC and America/Los_Angeles plus typecheck.** Expected PASS and identical output in both zones; confirm separate stream totals reconcile to household monthly/annual totals.
- [ ] **Step 5: Commit.** Stage cash modules, result contracts, and cash fixtures/tests; commit `feat: resolve dated income expenses and contribution requests`.

### Task 4: Fixed-rate property loans and standalone debts

**Files:** Create `foundation/src/engine/property/loans.ts`, `foundation/tests/engine/loans.test.ts`, `foundation/fixtures/math/loans.json`. Extend `model/results.ts` with `LoanSchedule`/`LoanMonth`.

**Interfaces:** Produces `scheduledPayment(principalCents: Cents, aprBps: BasisPoints, termMonths: number): Cents` and `calculateLoanSchedule(loan: Debt | PropertyLoan, startYear: number, horizonYears: number): LoanSchedule`. Monthly records expose `openingPrincipalCents`, `interestCents`, `paymentCents`, signed `principalPaidCents`, `closingPrincipalCents`, date, known/estimated opening provenance, and issues. Mortgage tax facts also preserve average-balance evidence and qualification; cash availability does not depend on deductible status.

- [ ] **Step 1: Write the loan tests.** Independently calculate fixed-rate reference payments/schedules rather than reusing `scheduledPayment` to create expectations:

```ts
it('amortizes zero-rate debt and caps payoff', () => {
  expect(scheduledPayment(120000, 0, 12)).toBe(10000);
  const loan: Debt = { id: 'd', name: 'Debt', openingBalanceCents: 101,
    aprBps: 0, monthlyPaymentCents: 100, firstPaymentMonth: '2026-01' };
  const s = calculateLoanSchedule(loan, 2026, 1);
  expect(s.months.slice(0, 3).map(m => m.paymentCents)).toEqual([100, 1, 0]);
  expect(s.months[1].closingPrincipalCents).toBe(0);
});
```

Reference cases assert purchase price minus down payment initializes ordinary principal, known opening balance/payment overrides historical estimates, first-payment dates are honored, final interest/payment cap reconciles cents, and interest `100`/payment `50` on opening `10000` at 12% closes at `10050` with a below-interest issue. A linked loan and standalone debt use the same convention; home-value changes cannot alter principal.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/loans.test.ts`.** Expected FAIL for missing loan functions.
- [ ] **Step 3: Implement payment and schedule signatures.** Nominal APR/12 interest settles each month; the payment caps at principal plus settled interest and stops after payoff. Derive historical scheduled balance only when known opening data is absent; label estimates. Preserve negative principal repayment for below-interest schedules and emit a located issue. Loans can remain numerically available when their tax qualification is unresolved.
- [ ] **Step 4: Run loan tests and typecheck.** Expected PASS against independent fixed-rate schedules and exact cash/principal reconciliation.
- [ ] **Step 5: Commit.** Stage loan module, result contracts, and references/tests; commit `feat: add reconciled fixed-rate debt schedules`.

### Task 5: Property allocations, separate rental books, and depreciation

**Files:** Create `foundation/src/engine/property/{allocation,depreciation,facts}.ts`, `foundation/tests/engine/property.test.ts`, `foundation/fixtures/tax/property-2026.json`; extend `model/{results,tax-state}.ts`.

**Interfaces:** Consumes `CashYear`, `LoanSchedule`, opening `HouseholdTaxState`, and `YearRules`. Produces `allocateExpense(expense: Expense, property: Property, rentals: readonly RentalUnit[], paidCents: Cents): ExpenseAllocation` (personal/rental shares sum to paid cents), `calculateDepreciation(unit: RentalUnit, year: number, book: TaxBook, opening: Available<RentalBookState>, rules: YearRules): Available<DepreciationYear>`, and `buildPropertyFacts(plan: ValidatedPlan, cash: CashYear, loans: readonly LoanSchedule[], opening: HouseholdTaxState, rules: YearRules): PropertyYearFacts`. Facts separate cash receipts/costs/full debt payments from eligible interest, operating deductions, depreciation, personal deduction candidates, and closing book histories. `ExpenseAllocation` exposes `personalCents` and `rentalCentsByUnit`.

- [ ] **Step 1: Write sourced property reference tests.** For every `property-2026` case assert allocations, cash/tax facts, and closing depreciation histories against fixture expectations. Include 500-square-foot ADU plus 1500-square-foot home, shared expense `100001` cents allocated `25000` rental/`75001` personal; direct rental expense 100% rental; explicit allocations summing at most 100%; and no personal deduction for whole-rental costs. For adjusted building basis `33000000` cents and January availability, assert first-year straight-line mid-month depreciation `1150000` cents (11.5 months of the 27.5-year schedule). Test subsequent/final years, delayed tenant arrival, exhausted basis, land exclusion, lower conversion FMV, differing CA/AMT histories, known-zero versus unknown history, and unsupported capital improvements/financing history. Assert mortgage principal and depreciation are not cash operating expenses.

```ts
it.each(loadReferences<PropertyReferenceInput, PropertyYearFacts>('property-2026'))(
  '$id', c => {
    const i = c.input;
    expect(buildPropertyFacts(mustValidate(i.plan), i.cash, i.loans,
      i.opening, i.rules)).toEqual(c.expected);
  });
```

`PropertyReferenceInput` contains those five exact parameters, with the serialized plan typed `PlanDocument`.
- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/property.test.ts`.** Expected FAIL for missing allocation/depreciation/facts functions.
- [ ] **Step 3: Implement the three signatures.** Keep exact area ratios; settle rental shares cumulatively and assign residual cents to personal use. Direct/explicit expense allocations override area defaults. Interest allocation requires proceeds/collateral qualification rather than assuming area establishes deductibility. Start depreciation at ready-and-available date, cap lifetime basis recovery, and keep federal/CA/AMT histories separate. Classify capital costs separately from repairs; a future basis-changing activity without a supported schedule is an unsupported-case issue. Unknown required history blocks its tax book, not rent/loan cash facts; do not infer basis from market value or balance.
- [ ] **Step 4: Run property tests and typecheck.** Expected PASS with independent IRS/FTB worksheets and exact cash-share conservation.
- [ ] **Step 5: Commit.** Stage property modules/contracts and fixtures/tests; commit `feat: model property allocations and rental depreciation books`.

### Task 6: Workplace deferrals and employee payroll liabilities

**Files:** Create `foundation/src/engine/tax/{facts,workplace,payroll}.ts`, `foundation/tests/engine/tax/payroll.test.ts`, `foundation/fixtures/tax/payroll-2026.json`; extend result contracts.

**Interfaces:** Consumes `CashYear`, `ContributionRequest[]`, filer/employer-year assumptions, and `YearRules`. Produces `resolveWorkplaceContributions(plan: ValidatedPlan, cash: CashYear, requests: readonly ContributionRequest[], rules: YearRules): WorkplaceYear`; `calculatePayroll(cash: CashYear, workplace: WorkplaceYear, rules: YearRules): PayrollYear`. `ContributionRecord` exposes owner/account/rule/month/year, requested/eligible/deductible/nondeductible/prevented cents and reasons. `WorkplaceYear` exposes `year`, `filers: readonly Filer[]`, records, owner/employer compensation, and federal/CA income-tax wage reductions; `PayrollYear` exposes twelve months and annual Social Security, Medicare, Additional Medicare, SDI, per-owner detail, and provenance. Carry the year/filers into `PreIraFacts` and `ResolvedTaxFacts` so later age deductions have their inputs even for a filer without wages.

- [ ] **Step 1: Write reference and conservation tests.** In `payroll-2026.json`, record official per-owner wage-base boundaries, multiple employers for one owner versus two owners, Medicare and joint MFJ Additional Medicare boundary cases, SDI rates/caps applicable by year, traditional/Roth deferrals, and catch-up ages 49/50/59/60/63/64. Assert two regular traditional/Roth 401(k) rules requesting `2000000` cents each for one owner have combined eligible funding `2450000`, with prevented `1550000` left outside accounts. Test priority by `(month, priority, ruleId)`, compensation/percentage caps, sponsoring-employer linkage, missing prior-year employer wages, mandatory Roth catch-up with only a traditional rule, and unavailable plan catch-up. Assert pre-tax deferrals reduce income-tax wages but not Social Security/Medicare wages. Monthly payroll sums equal independently checked annual liabilities.

```ts
it.each(loadReferences<PayrollReferenceInput, PayrollReferenceExpected>(
  'payroll-2026'))('$id', c => {
  const i = c.input;
  const w = resolveWorkplaceContributions(mustValidate(i.plan), i.cash,
    i.requests, i.rules);
  expect(w).toEqual(c.expected.workplace);
  expect(calculatePayroll(i.cash, w, i.rules)).toEqual(c.expected.payroll);
});
```

Define the test input with those four parameters and expected `{ workplace: WorkplaceYear; payroll: PayrollYear }`. Name the Review Focus fixture `one-owner-two-employers-catchup`; determine catch-up age under the applicable year-end rule, including a December 31 birthday, and use the sponsor's own prior-year wages. Eligible/deductible/nondeductible/prevented contribution amounts use `Available<Cents>` when their eligibility depends on missing inputs; requested cents remain numeric.
- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/payroll.test.ts`.** Expected FAIL for unresolved payroll/workplace rules.
- [ ] **Step 3: Implement the two signatures.** Aggregate payroll wages per owner across all wage sources before limits; Additional Medicare uses the joint liability threshold, not simulated employer withholding. Apply owner-combined deferral limits, legally available age/employer-specific catch-ups, compensation, and stable request priority. Do not invent a Roth destination when a traditional rule cannot accept mandatory Roth catch-up. Required but unknown inputs leave that dependent eligibility unavailable rather than awarding benefits. Use cumulative per-owner wage-tax settlement for monthly caps/remainders and the year-specific SDI wage definition.
- [ ] **Step 4: Run payroll tests and typecheck.** Expected PASS at each boundary with independent expected amounts and annual reconciliation; each cap/unknown condition has an actionable contribution issue.
- [ ] **Step 5: Commit.** Stage tax facts/workplace/payroll, contracts, and fixtures/tests; commit `feat: resolve owner retirement deferrals and payroll taxes`.

### Task 7: At-risk restrictions, passive allowances, and annual loss state

**Files:** Create `foundation/src/engine/tax/{rental-losses,modified-income}.ts`, `foundation/tests/engine/tax/rental-losses.test.ts`, `foundation/fixtures/tax/rental-losses-2026.json`; extend `tax/facts.ts` and `model/tax-state.ts`.

**Interfaces:** Consumes `PropertyYearFacts`, `WorkplaceYear`, gross income facts, `YearRules`, and opening `HouseholdTaxState`. Produces `buildPreIraFacts(cash: CashYear, workplace: WorkplaceYear, property: PropertyYearFacts): PreIraFacts`, `passiveAllowanceMagi(facts: PreIraFacts, rules: YearRules): Available<Cents>`, and `resolveRentalLosses(facts: PreIraFacts, opening: HouseholdTaxState, rules: YearRules): RentalLossYear`. The result exposes jurisdiction/AMT books with allowed income/loss, at-risk and passive opening/addition/release/closing amounts by rental ID, and loss vintages needed for QBI. `PreIraFacts` retains separate wages, ordinary taxable/non-taxable cash, NIIT characterization, rental books, and adjustments rather than one generic MAGI.

- [ ] **Step 1: Write independently checked rental-loss fixtures.** Include these explicit special-allowance assertions for a qualifying actively participating rental with adequate at-risk basis and `3100000` cents loss:

```ts
it.each([
  [10000000, -2500000, 600000],
  [12000000, -1500000, 1600000],
  [15000000, 0, 3100000],
])('applies allowance at MAGI %i', (magi, allowed, suspended) => {
  // Each source-backed input is stored under this exact MAGI in the fixture.
  const c = loadReferences<RentalLossReferenceInput, RentalLossYear>('rental-losses-2026')
    .find(c => c.input.passiveAllowanceMagiCents === magi)!;
  const result = resolveRentalLosses(c.input.facts, c.input.opening, c.input.rules);
  if (result.federal.status !== 'available') throw new Error('missing rental book');
  expect(result.federal.value.allowedRentalCents).toBe(allowed);
  expect(result.federal.value.closingPassiveLossCents).toBe(suspended);
});
```

Define the test input as `RentalLossReferenceInput = { facts: PreIraFacts; opening: HouseholdTaxState; rules: YearRules; passiveAllowanceMagiCents: Cents }`. Also assert at-risk restriction precedes passive restriction, insufficient at-risk basis never offsets wages, inactive participation has no special allowance, one household allowance is shared across properties, losses release against later passive profit, deterministic per-property allocation, federal/CA differences, California uses its prescribed modified federal AGI, IRA-deduction addbacks, unknown history propagation, and AMT/QBI loss vintages stay separate.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/rental-losses.test.ts`.** Expected FAIL for missing annual limitations/state.
- [ ] **Step 3: Implement the three signatures.** Follow Form 6198/8582 and FTB 3801 ordering using their distinct modified-income definitions. Allocate a shared release proportionally to eligible losses with cumulative cent settlement in sorted rental-ID order; preserve each vintage's released share for QBI. Carry unused at-risk/passive losses independently by jurisdiction. Distinguish supported personal-liability/qualified-nonrecourse financing from unsupported financing. Unknown affected history makes its current and subsequent dependent book unavailable; unrelated rental cash remains numeric.
- [ ] **Step 4: Run rental-loss tests and typecheck.** Expected PASS against recorded primary-source worksheet steps across two chronological years and multiple properties; allowed plus suspended amounts reconcile exactly.
- [ ] **Step 5: Commit.** Stage modified-income/rental-loss modules, facts/state contracts, and fixtures/tests; commit `feat: resolve rental loss limits and carried tax state`.

### Task 8: IRA modified income, contribution eligibility, deduction, and basis

**Files:** Create `foundation/src/engine/tax/ira.ts`, `foundation/tests/engine/tax/ira.test.ts`, `foundation/fixtures/tax/ira-2026.json`; extend `modified-income.ts`, `facts.ts`, and result/state contracts.

**Interfaces:** Consumes `PreIraFacts`, `RentalLossYear`, requests, workplace records, filer coverage/age, and rules. Produces `traditionalIraMagi(facts: PreIraFacts, rental: RentalLossYear, rules: YearRules): Available<Cents>`, `rothIraMagi(facts: PreIraFacts, rental: RentalLossYear, rules: YearRules): Available<Cents>`, and `resolveIraContributions(plan: ValidatedPlan, facts: PreIraFacts, rental: RentalLossYear, requests: readonly ContributionRequest[], workplace: WorkplaceYear, rules: YearRules): IraYear`. `IraYear` contains month/rule contribution records, owner compensation, federal/CA deductible amounts, nondeductible funding, new basis separately from `History<Cents>` opening/closing basis, and modified-income explanations.

- [ ] **Step 1: Write IRA reference tests.** Record independent 2026 worksheet results for deductible traditional IRA phaseouts (covered owner and uncovered spouse of covered owner), Roth phaseouts, compensation/spousal compensation, catch-up ages, aggregate traditional/Roth limits, and required next-$10/minimum-$200 worksheet rules. Assert `1000000` cents total requests for a non-catch-up eligible owner cap at `750000`; denied money is not deposited elsewhere. Assert nondeductible funding is allowed even where deductible funding is zero; unknown opening basis stays unknown while current-year nondeductible funding remains identifiable. A growth-only old 401(k) does not imply workplace coverage. Use a rental-loss case where IRA MAGI differs from taxable income and from passive-allowance MAGI; include the official Roth worksheet recalculation/addback behavior.

```ts
it.each(loadReferences<IraReferenceInput, IraYear>('ira-2026'))('$id', c => {
  expect(resolveIraContributions(mustValidate(c.input.plan), c.input.facts, c.input.rental,
    c.input.requests, c.input.workplace, c.input.rules)).toEqual(c.expected);
});
```

Define `IraReferenceInput` in the reference test with the six parameter types above, except its serialized `plan` is `PlanDocument`.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/ira.test.ts`.** Expected FAIL for unresolved IRA funding/deduction rules.
- [ ] **Step 3: Implement the three signatures.** Follow distinct Publication 590-A worksheet definitions and legal ordering, using rental restrictions and explicit workplace coverage. Resolve combined owner IRA/compensation limits in the same stable priority convention as Task 6; settle partial-year eligible funding back to the original requests. Apply federal and California deduction conformity separately. Do not finalize deposits until eligibility is known, infer basis from balances, or treat the final taxable income as MAGI.
- [ ] **Step 4: Run IRA and rental-loss tests plus typecheck.** Expected PASS at every source-backed phaseout boundary; a two-year basis example and the dependent rental/Roth-MAGI fixture remain consistent.
- [ ] **Step 5: Commit.** Stage IRA/modified-income/contracts and fixtures/tests; commit `feat: resolve IRA eligibility deductions and basis`.

### Task 9: Qualified mortgage interest and jurisdiction-specific itemization

**Files:** Create `foundation/src/engine/tax/{mortgage,itemized}.ts`, `foundation/tests/engine/tax/itemized.test.ts`, `foundation/fixtures/tax/itemized-2026.json`; extend tax facts/results.

**Interfaces:** Produces `calculateMortgageDeduction(facts: PropertyYearFacts, loans: readonly LoanSchedule[], jurisdiction: 'federal' | 'california', rules: YearRules): Available<MortgageDeduction>`, `standardDeduction(filers: readonly Filer[], year: number, jurisdiction: 'federal' | 'california', rules: YearRules): Available<Cents>`, `federalSaltDeduction(eligiblePaidCents: Cents, modifiedIncomeCents: Cents, rules: YearRules): Cents`, `limitFederalItemized(itemizedCents: Cents, preRestrictionTaxableCents: Cents, rules: YearRules): Cents`, and `buildItemizedCandidate(facts: ResolvedTaxFacts, property: PropertyYearFacts, mortgages: MortgageDeductions, statePaid: Available<StateTaxPaid>, rules: YearRules): ItemizedCandidate`. `ResolvedTaxFacts` is created by `buildResolvedTaxFacts(preIra: PreIraFacts, rental: RentalLossYear, ira: IraYear, workplace: WorkplaceYear): ResolvedTaxFacts`; it retains all named modified incomes/adjustments. `MortgageDeductions` has separate federal/California `Available<MortgageDeduction>` fields; `ItemizedCandidate` likewise has separate available jurisdiction details, including original/allowed/disallowed amounts, eligible paid-tax/NIIT allocation facts, and source references. California details can be built before state-paid facts are available; only federal SALT depends on them.

- [ ] **Step 1: Write itemization fixture tests.** Pin the spec's SALT amounts independently:

```ts
it('separates SALT phaseout from the top-bracket restriction', () => {
  expect(federalSaltDeduction(5000000, 50500000, rules2026)).toBe(4040000);
  expect(federalSaltDeduction(5000000, 51500000, rules2026)).toBe(3740000);
  expect(federalSaltDeduction(5000000, 100000000, rules2026)).toBe(1000000);
});
```

`rules2026` comes from Task 2, while expected results above are independent arithmetic. Additional reference cases exercise age-related standard deductions (including the applicable January 1 birthday convention and unknown age), pre/post-December-15-2017 ordinary acquisition debt, average balances decreasing after principal repayment, aggregate qualified debt across homes, rental interest removed first, California's distinct debt limits, qualified mortgage insurance/phaseout versus nondeductible homeowners insurance, eligible taxes paid versus assessed liability/escrow, annual state-payment override, California exclusion of state income tax/SDI, and high-income California itemized reduction. Pin exact 2/37 calculation and its ordering, including a case where SALT phaseout applies without the top-bracket restriction. Missing grandfathered/refinance/mixed-proceeds history returns the affected deduction unavailable while loan cash remains available.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/itemized.test.ts`.** Expected FAIL for missing qualified deductions.
- [ ] **Step 3: Implement the six signatures.** Use Publication 936's applicable average-balance method and documented evidence, not original principal as a permanent denominator. Resolve jurisdiction-specific standard deductions from applicable age rules. Remove qualified rental shares before personal limits. Apply SALT to eligible payments using its own modified-income definition; apply the separate statutory top-bracket restriction after other federal limits. California independently follows its itemized worksheet; preserve items excluded from its high-income reduction. `StateTaxPaid` is `{ californiaIncomeTaxPaidCents: Cents; sdiPaidCents: Cents; source: 'prospective-assumption' | 'actual-override' }`; candidate comparison supplies it in Task 12.
- [ ] **Step 4: Run itemized tests and typecheck.** Expected PASS against independent federal/California worksheets with recorded rounding tolerances; no rental deduction also appears in personal itemization.
- [ ] **Step 5: Commit.** Stage mortgage/itemized/resolved facts and fixtures/tests; commit `feat: calculate qualified federal and California deductions`.

### Task 10: Federal ordinary tax, age deductions, AMT, NIIT, and rental QBI

**Files:** Create `foundation/src/engine/tax/federal.ts`, `foundation/tests/engine/tax/federal.test.ts`, `foundation/fixtures/tax/federal-2026.json`; extend results/tax state and coverage.

**Interfaces:** Consumes `ResolvedTaxFacts`, eligible deduction candidates, rental AMT/QBI histories, opening state, and rules. Produces `calculateFederalTax(facts: ResolvedTaxFacts, deductions: DeductionChoice, opening: HouseholdTaxState, rules: YearRules): Available<FederalTaxResult>` and `resolveRentalQbi(facts: ResolvedTaxFacts, opening: HouseholdTaxState, rules: YearRules): Available<QbiYear>`. `DeductionChoice` has method `'standard' | 'itemized'`, standard/allowed itemized amounts, disallowed reasons, pre-section-68 taxable-income evidence, and the selected jurisdiction's detailed candidate/paid-tax facts for AMT and NIIT allocation. The tax result exposes AGI/MAGI, deductions, taxable income, ordinary tax, AMT increment, NIIT, total federal liability, explanation steps/provenance, and closing federal AMT/QBI state.

- [ ] **Step 1: Write federal reference tests.** Transcribe official 2026 bracket boundaries and whole-dollar/tax-table methods, including below/at/above every bracket and the official table-versus-schedule boundary. Use complete 2025 worksheets as historical-method evidence with the 2026 applicable values/enacted changes verified separately. Include age 64/65 standard additions, temporary senior deduction/phaseout/expiration, federal AMT exemption/phaseout and regular-versus-AMT itemization, and NIIT on passive rental profit plus supported cash interest/ordinary dividends (wages excluded). Check allocable NIIT deductions. QBI cases cover qualified and explicitly nonqualifying rentals, unresolved qualification, negative QBI carryforwards, released-loss vintages/FIFO, wage/UBIA limits, and taxable income computed without the section-68 restriction.

```ts
it.each(loadReferences<FederalReferenceInput, Available<FederalTaxResult>>(
  'federal-2026'))('$id', c => {
  expect(calculateFederalTax(c.input.facts, c.input.deductions,
    c.input.opening, c.input.rules)).toEqual(c.expected);
});
```

Define `FederalReferenceInput` with the four exact parameter types above. Also assert unknown AMT/QBI history and NIIT characterization cause located unavailable components, not assumed zero. Existing or newly relevant minimum-tax-credit circumstances are outside the stated credit coverage: the affected year's liability is `unsupported-case` until that separate coverage decision is made, with an explicit carried-state marker. Add a two-year fixture where an AMT deferral creates that later coverage boundary.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/federal.test.ts`.** Expected FAIL for unresolved federal components/QBI state.
- [ ] **Step 3: Implement the two signatures.** Keep rule application in this module and constants in packs. Apply official per-form rounding separately from cash rounding; maintain regular/AMT taxable books and federal age deductions in their prescribed positions. Compute NIIT from all covered NII categories and its own MAGI. Apply explicitly established rental QBI qualification, limits, and vintage losses; do not assume qualification or silently zero an unresolved deduction. Carry relevant AMT/QBI state; flag unsupported additional credits rather than claiming full liability.
- [ ] **Step 4: Run federal tests and typecheck.** Expected PASS within each fixture's independently declared tolerance; fixtures with unavailable tax inputs assert absence of numeric liability. Review source versions for every implemented component.
- [ ] **Step 5: Commit.** Stage federal/coverage/state and fixtures/tests; commit `feat: calculate sourced federal tax components and coverage`.

### Task 11: California ordinary tax, exemptions, AMT, and surtax

**Files:** Create `foundation/src/engine/tax/california.ts`, `foundation/tests/engine/tax/california.test.ts`, `foundation/fixtures/tax/california-2026.json`; extend tax results/state and coverage.

**Interfaces:** Produces `calculateCaliforniaTax(facts: ResolvedTaxFacts, deductions: DeductionChoice, opening: HouseholdTaxState, rules: YearRules): Available<CaliforniaTaxResult>`. The result exposes California AGI/taxable income, standard/itemized deduction, filer/age exemption credits and phaseouts, regular tax, AMT increment, high-income surtax, total California liability, explanations/provenance, and closing California/AMT state. Consumes California rental/IRA adjustments and independently allowed California deductions from earlier tasks.

- [ ] **Step 1: Write sourced California fixtures.** Include every published 2026 MFJ bracket/table boundary, whole-dollar/table rules, standard deduction, the two ordinary filer exemption credits and their phaseouts, age-related additions, high-income itemized reduction, separate California AMT and $1 million surtax boundary. Assert federal QBI and the federal senior deduction do not automatically reduce California income. Include differing federal/CA rental books and federal standard with California itemized. Unresolved indexed AMT/limitation values without assumptions yield `needs-data`; an explicit provisional assumption can yield numeric scenarios with provisional status.

```ts
it.each(loadReferences<CaliforniaReferenceInput, Available<CaliforniaTaxResult>>(
  'california-2026'))('$id', c => {
  expect(calculateCaliforniaTax(c.input.facts, c.input.deductions,
    c.input.opening, c.input.rules)).toEqual(c.expected);
});
```

The reference input has the four exact parameter types above. Check candidate tests do not derive expected California tax from the federal calculator or mechanically inflated 2025 brackets.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/california.test.ts`.** Expected FAIL for missing California liability.
- [ ] **Step 3: Implement the signature.** Follow Schedule CA, Schedule P, and Form 540/540-ES using field-level provenance. Include exemption credits/phaseouts and surtax independently; carry California AMT histories. Preserve provisional status from any used unresolved amount and the unsupported-credit boundary from Task 10 where applicable.
- [ ] **Step 4: Run California tests and typecheck.** Expected PASS with independent worksheets, correct unavailable states, and no falsely verified provisional result.
- [ ] **Step 5: Commit.** Stage California/results/state and fixtures/tests; commit `feat: calculate California liability and rule status`.

### Task 12: Joint annual tax resolution and legal deduction-method comparison

**Files:** Create `foundation/src/engine/tax/comparison.ts`, `foundation/tests/engine/tax/comparison.test.ts`, `foundation/fixtures/tax/comparison-2026.json`; extend `tax/facts.ts`, result/state contracts.

**Interfaces:** Produces `resolveHouseholdYear(plan: ValidatedPlan, cash: CashYear, requests: readonly ContributionRequest[], property: PropertyYearFacts, loans: readonly LoanSchedule[], opening: HouseholdTaxState, rules: YearRules): HouseholdYear`. It owns workplace → rental restrictions → IRA eligibility → final facts → method comparison, returning finalized contributions, `PayrollYear`, `Available<HouseholdTaxResult>`, closing tax state, coverage, and issues. Each legal candidate reports federal/CA chosen methods, allowed/disallowed amounts, state tax assessed/paid, AMT/surtax/NIIT, and combined income-tax liability; payroll remains separately reported.

- [ ] **Step 1: Write independent whole-household references.** Use `comparison-2026.json` for all legal standard/itemized combinations, a federal/CA method mismatch, an AMT-driven winner, equal-tax ties, default prospective state tax/SDI paid, actual-paid overrides, and unavailable candidates. Assertions include:

```ts
it.each(loadReferences<HouseholdReferenceInput, HouseholdYear>('comparison-2026'))(
  '$id', c => {
    const i = c.input;
    expect(resolveHouseholdYear(mustValidate(i.plan), i.cash, i.requests, i.property,
      i.loans, i.opening, i.rules)).toEqual(c.expected);
  });
```

Define the input with the eight exact parameter types, except its serialized plan is `PlanDocument`. Fixture assertions pin each candidate's liability/paid taxes, chosen methods, final eligible deposits, and closing state. Test that an unknown potentially winning deduction cannot be hidden by selecting a known standard candidate. Ties prefer the candidate with more standard methods, then federal standard. State payment overrides do not change assessed California liability or payroll cash. An unsupported outside-scope income/credit circumstance has explicit coverage; a potentially material unmodeled tax input makes its dependent liability unavailable. Distribution-dependent years retain the explicitly permitted contribution/growth scenario and show incomplete household-liability coverage; do not invent withdrawals or invalidate those independent schedules.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/tax/comparison.test.ts`.** Expected FAIL for missing coupled tax comparison.
- [ ] **Step 3: Implement the signature.** Use earlier Interfaces in the prescribed dependency order. Evaluate each legally allowed combination from the same opening state without mutation; compute candidate California liability, derive its prospective/overridden paid tax, then federal SALT/other federal liability. Compare resulting combined income tax, not deduction sizes. Only the selected candidate advances carried tax state. Unavailable potentially superior candidates keep the final choice unavailable; do not fabricate a best tax. Retain independent payroll/property results and explanation traces.
- [ ] **Step 4: Run `npm --prefix foundation run test:engine` and `npm --prefix foundation run typecheck`.** Expected all foundation/2026 tax references PASS. Inspect the source register and verify the fixture expected values were independently transcribed/checked; no fixture factory calls production formulas or reads production constants for its expected side.
- [ ] **Step 5: Commit.** Stage comparison/contracts and whole-household references; commit `feat: resolve annual household tax and deduction choices`.

**Milestone 1 gate:** Validated synthetic documents, debt/property schedules, eligible contribution records, 2026 annual tax comparison, and carried rental state are independently tested. All unresolved rule/history/credit boundaries are visible. Do not start browser work before this gate and Milestone 2 pass.

## Milestone 2: Unified projection

### Task 13: Effective annual growth with preserved fractional balances

**Files:** Create `foundation/src/engine/growth.ts`, `foundation/tests/engine/growth.test.ts`, `foundation/fixtures/math/growth.json`; extend `model/results.ts`.

**Interfaces:** Produces `effectiveMonthlyRate(annualBps: BasisPoints): Decimal`, `growMonth(opening: Decimal, annualBps: BasisPoints, monthEndDepositCents: Cents): GrowthMonth`, and `propertyRate(property: Property, year: number): BasisPoints`. `GrowthMonth = { closingExact: Decimal; openingCents: Cents; depositsCents: Cents; growthCents: Cents; closingCents: Cents }` is internal; Decimal never escapes serialized projection output. `growthCents` is the difference between reported closing/opening after deposits.

- [ ] **Step 1: Write growth tests against independent closed forms.** Define test-only `compoundYear(openingCents: Cents, annualBps: BasisPoints, deposits: readonly Cents[]): readonly GrowthMonth[]` as a loop calling `growMonth`; it cannot construct expected values. Assertions:

```ts
it('reports exactly the specified 7 percent example', () => {
  const months = compoundYear(1000000, 700, Array(12).fill(0));
  expect(months[11].closingCents).toBe(1070000);
  expect(months.reduce((s, m) => s + m.growthCents, 0)).toBe(70000);
});
it('deposits at month end before future growth', () => {
  const m = growMonth(new Decimal(0), 700, 10000);
  expect(m.closingCents).toBe(10000);
  expect(m.growthCents).toBe(0);
});
it('rejects projected overflow', () => {
  expect(() => growMonth(new Decimal('99999999999999'), 100000, 0))
    .toThrow('monetary-overflow');
});
```

Include 0%, negative growth greater than -100%, zero/constant deposits, separate effective versus nominal-rate expectations, forty-year closed-form comparisons, per-property calendar-year overrides, and exact reported growth reconciliation. Expected constants in `growth.json` come from an independently recorded high-precision closed-form calculation, with nearest-cent expected outputs.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/growth.test.ts`.** Expected FAIL for missing growth functions.
- [ ] **Step 3: Implement the three signatures.** Compute `(1 + bps/10000)^(1/12) - 1` entirely with the private Decimal constructor; carry `closingExact` forward instead of settled cents. Deposit eligible contributions after monthly growth. Check reported amount bounds and throw a typed internal `CalculationRangeError` with code `monetary-overflow`; the public coordinator catches this as a structured located issue. Property value grows once per property, independently of debt and rental basis.
- [ ] **Step 4: Run growth tests and typecheck.** Expected PASS with exact $10,700 result, independent long-horizon agreement, and no balance reporting drift.
- [ ] **Step 5: Commit.** Stage growth/contracts and fixtures/tests; commit `feat: preserve exact monthly account and property growth`.

### Task 14: Projection coordinator, reserves, and annual/monthly reconciliation

**Files:** Create `foundation/src/engine/{projection,reporting,index}.ts`, `foundation/tests/engine/projection.test.ts`, `foundation/fixtures/math/projection.json`; extend result contracts.

**Interfaces:** Public `calculateProjection(plan: ValidatedPlan, ruleSet: RuleSet): ProjectionResult`; `allocateAnnualTax(liabilityCents: Cents, positiveGrossCashByMonth: readonly Cents[]): readonly Cents[]`; `summarizeYear(months: readonly MonthlyProjection[], household: HouseholdYear): AnnualProjection`. `ProjectionResult` contains `planId`, `inputRevision`, `months: readonly MonthlyProjection[]`, `years: readonly AnnualProjection[]`, contribution records, opening/closing tax state per year, rule provenance, coverage, and issues. Monthly rows expose gross income, each tax component/reserve, ordinary/property expenses, full debt payments and principal/interest, requested/eligible/prevented contributions, account opening/contribution/growth/closing balances, property value/loan/equity, `cashFlowCents: Available<Cents>`, `reserveCents: Available<Cents>`, `netWorthCents: Available<Cents>`, and `fundingStatus: 'funded' | 'conditional-on-gap' | 'unavailable'`. Other dependent amounts also use `Available<T>`; independent schedules retain their own availability. Annual rows have `year`, the same monetary field names, summed flows, December balances, `tax: Available<HouseholdTaxResult>`, and ratios from aggregate numerator/denominator.

- [ ] **Step 1: Write projection references and conservation tests.** Provide independent synthetic fixtures for cash-only, salary plus two accounts, primary home/ADU plus debt, two-year rental losses, provisional 2027, and missing-history scenarios. Pin tax allocation independently:

```ts
it('allocates annual tax with exact cumulative remainders', () => {
  expect(allocateAnnualTax(100, Array(12).fill(0)))
    .toEqual([8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 9, 8]);
  expect(allocateAnnualTax(101, [1, 2, ...Array(10).fill(0)]))
    .toEqual([34, 67, ...Array(10).fill(0)]);
});
it.each(loadReferences<PlanDocument, ProjectionResult>('projection'))('$id', c => {
  assertReference(calculateProjection(mustValidate(c.input), loadRuleSet()),
    c.expected, c.toleranceCents);
});
```

For a zero-income household with opening reserve `10000`, taxable monthly contribution `20000`, and zero growth, assert first-month account deposits `20000`, reserve `-10000`, net worth `10000`, and conditional-on-gap status; contributions are legally planned even without positive surplus. Assert account credit equals cash debit once, capped money stays in reserve, linked expenses/debts appear once, ADU basis is not another asset, depreciation changes tax but not cash, and property appreciation leaves debt principal unchanged. Compare every annual flow with its twelve monthly values and every closing balance with December. Deep-freeze plan/rules; two runs must be deeply equal. Name the Review Focus cases `unknown-rental-history-two-years` (dependent tax/reserve/net worth unavailable; wages/loans/property growth available) and `aggregate-overflow-forty-year-growth` (valid inputs produce a located overflow issue with no numeric affected total). Distribution-dependent years explicitly show incomplete total-liability coverage.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/engine/projection.test.ts`.** Expected FAIL for missing coordinator/reconciliation.
- [ ] **Step 3: Implement the three signatures and public exports.** Process complete years chronologically using Task 12's resolved contributions/state before applying account deposits. Allocate federal/CA income liabilities (including included AMT/surtax/NIIT) by positive gross-cash weights; payroll uses Task 6's monthly owner calculations. Sum all monetary components using decimal bounds checks. Net worth is signed cash plus accounts plus one value per property minus all unique debts; preserve conditional status after any unmet gap. Do not auto-invest surplus, sell assets, borrow, or withdraw. Availability propagates through actual dependencies; unknown eligible IRA deposits affect those account balances but independent growth-only/taxable schedules remain available. Catch typed range errors as structured issues and make affected outputs unavailable. Report assessed/paid tax separately; tax-payment overrides affect deductions only.
- [ ] **Step 4: Run `npm --prefix foundation run test:engine` and typecheck.** Expected all reference/reconciliation tests PASS in both declared timezones; engine source imports no browser, clock, storage, React, Tauri, or legacy domain modules. Inspect all serialized monetary fields for safe integer/range compliance.
- [ ] **Step 5: Commit.** Stage coordinator/reporting/public exports/contracts and fixtures/tests; commit `feat: coordinate reconciled household projections and funding gaps`.

**Milestone 2 gate:** The public engine produces traceable annual/monthly results and explicit partial availability from immutable synthetic inputs. All mathematical/tax fixtures pass before any financial browser view is wired.

## Milestone 3: Plain browser workspace

### Task 15: Versioned local storage and atomic backup restoration

**Files:** Create `foundation/src/browser/storage.ts`, `foundation/tests/browser/storage.test.ts`.

**Interfaces:** `StoragePort = Pick<Storage, 'getItem' | 'setItem'>`; `loadPlan(storage: StoragePort): LoadResult`; `savePlan(storage: StoragePort, plan: PlanDocument): SaveResult`; `exportPlan(plan: PlanDocument): string`; `restorePlan(json: string, current: PlanDocument, storage: StoragePort): RestoreResult`. Use key `lifelook.foundation.plan.v1`. Load distinguishes missing, valid, invalid/unsupported document, and read failure. Save/restore results include the retained in-memory document, persisted boolean, and actionable issues; storage failure after a valid restore retains the restored in-memory plan as unsaved/exportable. Invalid restore leaves both saved/in-memory current plan unchanged. No implicit migration from the legacy app or unsupported schema.

- [ ] **Step 1: Write the storage tests.** Use a test-local Map-backed `StoragePort` and throwing read/write implementations:

```ts
it('round-trips and rejects an invalid restore atomically', () => {
  const current = makePlan({ revision: 3 });
  expect(savePlan(storage, current).persisted).toBe(true);
  expect(loadPlan(storage)).toMatchObject({ status: 'loaded', plan: current });
  expect(restorePlan('{', current, storage))
    .toMatchObject({ accepted: false, plan: current });
  expect(loadPlan(storage)).toMatchObject({ status: 'loaded', plan: current });
  expect(JSON.parse(exportPlan(current))).toEqual(current);
});
```

Also assert future schema version, duplicate/dangling references, unsafe money, invalid nested rows, and structurally unsupported enum values do not replace the current plan. Coverage-incomplete but structurally valid plans round-trip with unknowns intact. Quota/read exceptions become visible issues; a failed write retains the attempted valid document and export round-trips it.

- [ ] **Step 2: Run `npm --prefix foundation test -- tests/browser/storage.test.ts`.** Expected FAIL for missing storage/restore functions.
- [ ] **Step 3: Implement the four signatures.** Parse and validate the entire document before a replacement write; use one storage key/document. Keep unsupported/corrupt loaded JSON available for backup recovery rather than silently overwriting it with a new plan. Catch storage access/serialization errors and return status, not exceptions. JSON export includes input revision and unknown-history values, not calculated results or financial formulas.
- [ ] **Step 4: Run storage tests and typecheck.** Expected PASS for valid backups, rejected invalid restores, missing/corrupt load, and unsaved in-memory recovery.
- [ ] **Step 5: Commit.** Stage storage and tests; commit `feat: persist and restore validated foundation plans`.

### Task 16: Household, income, expense/debt, and investment record forms

**Files:** Create `foundation/src/browser/{main,state,fields}.ts`, `foundation/src/browser/forms/{household,income,expenses-debts,investments}.ts`, `foundation/src/browser/styles.css`, `foundation/tests/helpers/dom.ts`, `foundation/tests/browser/forms.test.ts`; wire `foundation/index.html`.

**Interfaces:** `WorkspaceState = { savedPlan: PlanDocument; drafts: Readonly<Record<string, RecordDraft>>; projection: ProjectionResult; persisted: boolean; issues: readonly Issue[] }`; `RecordDraft` retains original record ID/section and raw string fields/nested rows. `createWorkspace(plan: PlanDocument, storage: StoragePort, ruleSet: RuleSet): WorkspaceController` exposes `getState(): WorkspaceState`, `editDraft(recordId: string, draft: RecordDraft): void`, `saveRecord(recordId: string): SaveRecordResult`, and `removeRecord(section: EditableSection, recordId: string): SaveRecordResult`; `SaveRecordResult = { accepted: boolean; persisted: boolean; issues: readonly Issue[] }`; `EditableSection` is `'household' | 'salaries' | 'otherIncome' | 'expenses' | 'debts' | 'accounts' | 'contributions' | 'properties' | 'rentals'`. Form renderers `renderHouseholdForm`, `renderIncomeForm`, `renderExpensesDebtsForm`, `renderInvestmentsForm` each accept `(root: HTMLElement, controller: WorkspaceController): void`. `parseMoneyInput(text: string): Available<Cents>` and `parseRateInput(text: string): Available<BasisPoints>` reject extra precision/non-finite/exponent forms. `main.ts` exports `mountApp(root: HTMLElement, plan: PlanDocument, storage: StoragePort, rules: RuleSet): WorkspaceController`; test helper `mountWorkspace(doc: PlanDocument, storage?: StoragePort): { root: HTMLElement; controller: WorkspaceController }` calls it. `setField(root: HTMLElement, label: string, value: string): void` in `tests/helpers/dom.ts` finds a labeled control and dispatches native input/change events.

- [ ] **Step 1: Write meaningful form/draft tests.** With labeled DOM queries and native events, enter two salaries, several dated percent/amount raises, annual growth dates, wage-classified other income, monthly/annual expenses, a standalone debt, all five account types, fixed/salary-percent contributions, sponsoring salary, priority, coverage/age/employer history, and tax-payment/index policy. Assert Saved revision increments once per valid record Save, nested rows save together, and calculated output equals a direct engine calculation of the saved document. Invalid drafts preserve text and show record/field messages while prior output retains its saved revision. Assert money `'1.23'` parses to `123`, `'1.234'` is rejected, rate `'7.00'` parses to `700`, `'7.001'` is rejected, and blank required data is not zero. Attempt deletion of a referenced salary/account and assert an actionable rejection. A write failure updates valid in-memory state, exposes Unsaved status, and preserves exportability.

Name the Review Focus browser tests `invalid draft retains saved input revision` and `failed save retains exportable in-memory revision`; assert the retained draft value, saved/calculated revision equality, and persisted flag explicitly.

```ts
it('parses entered decimal units without silently rounding', () => {
  expect(parseMoneyInput('1.23')).toEqual({ status: 'available', value: 123 });
  expect(parseMoneyInput('1.234').status).toBe('needs-data');
  expect(parseRateInput('7.00')).toEqual({ status: 'available', value: 700 });
  expect(parseRateInput('7.001').status).toBe('needs-data');
  expect(parseMoneyInput('').status).toBe('needs-data');
});
```
- [ ] **Step 2: Run `npm --prefix foundation test -- tests/browser/forms.test.ts`.** Expected FAIL for missing workspace/form behavior.
- [ ] **Step 3: Implement the controller, parsers, and four form signatures.** Use labeled native inputs, buttons, fieldsets, editable rows, and explicit per-record Save; retain drafts independently of saved revision. Validate the whole candidate document before committing a record, then recalculate and attempt storage. Do not silently cascade-delete references. Use browser-only current-date formatting to pass today's ISO date to `createPlan`; engine remains clock-free. Include factual coverage questions and ordinary income NIIT selection, opening balances versus annual/monthly units, effective return versus APR, IRA basis unknown/known controls, and contribution priority with cap explanations. Use `textContent` for names/messages from documents. Keep the entrypoint as composition, with storage/form/engine decisions in their owning modules.
- [ ] **Step 4: Run forms/storage tests, typecheck, and build.** Expected PASS; keyboard tab/Enter reaches every Save and nested Add/Edit/Remove control. No financial formulas in forms or controller.
- [ ] **Step 5: Commit.** Stage browser controller/forms/helpers/styles/entrypoint and tests; commit `feat: add native financial forms with revisioned drafts`.

### Task 17: Primary-home, whole-rental, and home/ADU property forms

**Files:** Create `foundation/src/browser/forms/properties.ts`, `foundation/tests/browser/properties.test.ts`; extend browser composition only.

**Interfaces:** `renderPropertiesForm(root: HTMLElement, controller: WorkspaceController): void`, using existing property/rental/loan model contracts and Task 16 controller actions. A property draft includes its nested loans and appreciation overrides; linked rental-history records can be saved together in a single validated candidate revision using `saveProperty(propertyId: string): SaveRecordResult` added to the controller. Other record saves do not silently save this draft.

- [ ] **Step 1: Write property workflow tests.** Enter an existing primary home with purchase price/down payment, known opening mortgage balance/payment, acquisition/proceeds/collateral facts, current combined value, baseline appreciation, and two yearly overrides. Add an available ADU with later lease start, floor areas, direct/shared expense allocations, independent federal/CA/AMT building/depreciation/at-risk/passive histories, participation, QBI qualification/wage/UBIA/loss vintages, and explicit interest allocation. Save once; assert one property asset, one loan liability, matching direct engine output, and one revision increment. Add a whole rental and assert its costs do not enter personal itemization. Unknown history shows required data, future availability is rejected, area/allocation errors preserve draft, and known zero history differs from blank. Assert primary/ADU labels distinguish combined market value from rental basis and property tax/insurance from principal-and-interest payments.

```ts
it('preserves an invalid nested ADU draft and the saved revision', () => {
  const c = loadReferences<PlanDocument, ProjectionResult>('projection')
    .find(c => c.id === 'two-salaries-home-adu')!;
  const { root, controller } = mountWorkspace(c.input);
  const before = controller.getState().savedPlan.revision;
  setField(root, 'ADU living area', '0');
  expect(controller.saveProperty('home').accepted).toBe(false);
  expect(controller.getState().savedPlan.revision).toBe(before);
  expect(getByLabelText(root, 'ADU living area')).toHaveValue(0);
});
```

Import labeled queries from `@testing-library/dom` and the jest-dom matchers in the browser project's setup file.
- [ ] **Step 2: Run `npm --prefix foundation test -- tests/browser/properties.test.ts`.** Expected FAIL for missing property workflows.
- [ ] **Step 3: Implement the form signature and `saveProperty`.** Use expandable native detail sections adjacent to the relevant records. Put appreciation overrides and loan/rental history controls inline, with explicit unknown/known-zero choices and calculated default area allocation displayed. Ordinary purchase loans initialize original principal/payment from entered terms; known opening overrides remain editable and estimates labeled. Reject unsupported future purchase/conversion/refinance/construction/sale before saving. Preserve multiple nested edits as one property draft and validate the entire candidate plan atomically.
- [ ] **Step 4: Run property/forms tests, typecheck, and build.** Expected PASS; saved home/ADU and whole-rental documents reproduce the engine fixtures and remain fully keyboard editable.
- [ ] **Step 5: Commit.** Stage property form/controller composition and tests; commit `feat: add property rental and tax history inputs`.

### Task 18: Traceable projection views, backup controls, and browser acceptance

**Files:** Create `foundation/src/browser/views/{projection,tax-explanation,issues}.ts`, `foundation/tests/browser/reporting.test.ts`, `foundation/tests/e2e/workspace.spec.ts`, `foundation/playwright.config.ts`, `foundation/README.md`, `.github/workflows/foundation.yml`; extend browser composition and package E2E configuration.

**Interfaces:** `renderProjection(root: HTMLElement, result: ProjectionResult): void`, `renderTaxExplanation(root: HTMLElement, year: AnnualProjection): void`, `renderIssues(root: HTMLElement, issues: readonly Issue[]): void`. Views consume output only. Browser backup controls use Task 15 functions, File input, and Blob download. Playwright uses the built Vite preview and fresh browser contexts; CI installs the locked replacement package and Chromium, then runs the replacement `check` gate independently of existing desktop CI.

- [ ] **Step 1: Write reporting and acceptance tests.** Unit/browser assertions check every requested projection column, annual/monthly expand controls, selected standard/itemized methods and comparisons, deductions disallowed with reasons, rental allocations/loss state, requested/eligible/prevented funding, tax components/payment assumptions, source/provisional/projected status, coverage boundaries, saved input revision, and funding gaps. Unavailable values show a reason/action without a numeric placeholder; independent available schedules remain displayed.

```ts
test('saves two salaries, accounts and an ADU; reloads and restores', async ({ page }) => {
  const c = loadReferences<PlanDocument, ProjectionResult>('projection')
    .find(c => c.id === 'two-salaries-home-adu')!;
  const annual = c.expected.years[0].netWorthCents;
  const january = c.expected.months[0].netWorthCents;
  if (annual.status !== 'available' || january.status !== 'available')
    throw new Error('acceptance fixture must have complete scenario values');
  await page.goto('/');
  await enterAcceptancePlan(page, c.input);
  await expect(page.getByRole('heading', { name: 'Projection' })).toBeVisible();
  await expect(page.getByTestId('annual-2026-net-worth'))
    .toHaveText(formatExpectedCents(annual.value));
  await page.getByRole('button', { name: 'Show months for 2026' }).click();
  await expect(page.getByTestId('monthly-2026-01-net-worth'))
    .toHaveText(formatExpectedCents(january.value));
  await page.reload();
  await expect(page.getByTestId('annual-2026-net-worth'))
    .toHaveText(formatExpectedCents(annual.value));
});
```

Define test-local `enterAcceptancePlan(page: Page, plan: PlanDocument): Promise<void>` to enter the fixture through labeled controls and click each record Save, and `formatExpectedCents(cents: Cents): string` using USD Intl formatting only. Name the independent fixture `two-salaries-home-adu`, property ID `home`; it includes two salaries with several raises, all contribution modes, and home/ADU. Add assertions for tax explanations, JSON download/upload round trip, rejected malformed/unsupported restore with unchanged current revision, invalid draft preserving prior results, and quota failure with Unsaved status plus successful backup download. Use Playwright `addInitScript` to simulate storage failure. Include keyboard-only expansion/Save and an imported HTML-like record name rendered as text. Fixture expected numbers remain independent of production formulas.
- [ ] **Step 2: Run reporting tests and `npm --prefix foundation run test:e2e -- --grep 'saves two salaries'`.** Expected reporting FAIL for missing views, then E2E assertion failure for missing workspace/reporting controls after the preview server starts.
- [ ] **Step 3: Implement the three view signatures and backup controls.** Render yearly tables expandable to monthly detail and per-year tax explanations with native controls and readable captions/headings. Explain positive-income weighted income-tax reserves versus cumulative payroll, state taxes paid versus assessed, unrealized growth, and conditional results after cash gaps. Tie displayed calculations to saved revision even during drafts. Surface save/load failures without losing recoverable data. Document localhost run/build/check commands, schema/backup behavior, supported tax coverage and provisional assumptions, source updates with fixture reruns, and the separate legacy integration boundary. Add independent foundation CI; no hosting/publishing step.
- [ ] **Step 4: Run final acceptance.** Run `npm --prefix foundation run check` from a clean install (`npm --prefix foundation ci`) in the isolated implementation workspace. Expected typecheck, all engine/browser fixtures, production build, and Playwright flows PASS. Run legacy `npm test` and `npm run build` once to confirm test isolation and preserved entrypoint/config behavior. Verify `git diff --check`, no edits to user-modified App files/legacy Tauri code, and no imported financial records. Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review` before claiming readiness; review engine purity, primary-source fixture independence, field-level rule provenance, availability propagation, and the five Review Focus cases.
- [ ] **Step 5: Commit.** Stage final views/backup composition, reporting/E2E tests, documentation, and independent CI; commit `feat: explain projections and verify browser backup workflows`.

**Milestone 3 gate:** A user can enter the requested two-salary/account/home-ADU plan, inspect matching annual/monthly/tax results, edit invalid drafts without losing saved results, reload, and recover through portable backups. Keep the legacy application until separate replacement/integration work is agreed. No push is part of completion.

## Source checks to preserve during execution

The design's reference register remains authoritative context. Add edition-specific records for [2026 federal indexed amounts, Revenue Procedure 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [2026 retirement amounts, Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf), [NIIT worksheet instructions](https://www.irs.gov/instructions/i8960), [rental QBI/loss-vintage instructions](https://www.irs.gov/instructions/i8995a), and [California Schedule P](https://www.ftb.ca.gov/forms/2025/2025-540-p-instructions.html). Preserve the relevant publication edition and applicable year rather than assuming a rolling IRS URL is already the 2026 edition.

As of the planning review, [FTB October Tax News](https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/) says complete indexed 2026 amounts arrive in late December and contains an internally inconsistent MFJ bracket expression. Task 2 must resolve that discrepancy against applicable authority or retain an explicit provisional assumption. A default new 2027 plan must remain usable through defined projected/provisional assumptions; it must not await future publication or claim verified future law.

Use decimal.js's [private constructor configuration and rounding API](https://mikemcl.github.io/decimal.js/), Vitest's [explicit test include boundaries](https://vitest.dev/config/include.html) and [test listing command](https://vitest.dev/guide/cli.html), and Playwright's [web-server configuration](https://playwright.dev/docs/test-configuration) for the package/test separation described here. These are tooling references, not independent mathematical/tax expected values.

## Completion and integration boundary

For each task, stage only its named files and required owning contract/source changes; the commit step is local. Add further test cycles only for new failures or unresolved review concerns. Passing the three gates establishes a reviewable replacement package; deleting the legacy application, importing its saved data, changing the root launch default, returning isolated commits to the user's checkout, and publishing are separate work. Any eventual push still needs exact repository/remote/branch confirmation.
