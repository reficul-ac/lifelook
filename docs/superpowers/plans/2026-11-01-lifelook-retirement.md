# LifeLook Retirement Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Overview-style Retirement workspace that compares after-tax income by retirement year, supports visual multi-property reallocation, and projects each retirement path through 2100.

**Architecture:** Capture complete working-forecast checkpoints, then run separately validated retirement branches with explicit property/distribution ledgers and the shared household tax calculation. Persist an optional retirement definition in each scenario's plan; keep retirement drafts, workers and reports separate from ordinary forecast publication. Build one integrated feature in independently testable stages; the runtime, tax and GUI stages depend on shared financial contracts rather than being independent projects.

**Tech Stack:** Existing Node >=22, TypeScript 5.7.3, decimal.js 10.6.0, Vite 6.4.4, Vitest 4.1.11 and Playwright 1.58.2; native DOM/SVG and Web Workers. Add no runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-lifelook-retirement-design.md`. Read it before this plan. The user accepted that design as the planning basis by invoking writing-plans; execution still needs plan review/method selection.

## Global Constraints

- “Analyze each retirement path through **2100 inclusive**. Ignore inflation.”
- “Both household filers retire in the selected year.” Retirement starts January 1; candidates are configured working-forecast years through 2100.
- “Enter the **down payment as a percentage**, not dollars.” Save basis points and derive cash/principal.
- “A new property's entered purchase price is **fixed across candidate retirement years**.”
- “Use clearly labeled, editable planning assumptions when financial/tax history is incomplete.” Known entered history takes precedence; do not invent birth dates.
- “Keep the visual language close to **Overview**.” Graph first, assumptions rail, full-width allocation GUI, independent property cards.
- “Keep plan and workspace schema version 1 with additive validated fields so old backups load and omitted definitions round-trip without invented defaults.”
- “Retain the existing 1–40-year saved-plan validation.” Validate retirement's longer calendar separately; no cast to an overlong `ValidatedPlan`.
- “Retirement results publish to a separate slot.” Preserve ordinary calculation values and its revision/publication contract.
- Use existing integer USD cents, integer basis points, Decimal arithmetic, ISO dates, availability/provenance and sourced 2026/future-rule conventions.
- Preserve original nonemployment dates/growth, child budgets and debt schedules; add no CPI uplift. Personal surplus remains cash; show spending gaps instead of silently raising the withdrawal rate.
- Compare four named strategies through 2100; say **best of modeled strategies**, not globally optimal.
- Preserve raw drafts, Apply/Discard, one-write publication, per-scenario ownership, recovery and stale-result protection.
- No product code, dependencies or worktree is created while writing this plan. At execution, use the worktree skill before implementation.
- Never invoke `git push` without the user's explicit confirmation of the exact repository, remote and branch. Task commits below are local only.

## Review Focus

1. A restored scenario can reuse plan ID/revision while old workers finish: reject old results, preserve the restored inputs and show only the current owner's report — Tasks 11/12/17.
2. A property is not yet owned in an earlier candidate, or has several loans/rental units: never invent proceeds, release all losses, pay principal twice or duplicate the asset — Tasks 3/4/5/9.
3. A birthday, Roth clock or RMD year falls at a date boundary: use exact dates, prior-December balances and the right account rule in both timezones — Tasks 6/7.
4. Invalid/large property percentages or one unavailable tax book appear among otherwise valid assets: retain raw text, isolate affected results and keep correct independent amounts — Tasks 1/4/8/15.
5. Rapidly switching between two rental cards, chart years or portfolio modes must retain each draft and readable phone chart geometry; stale dollars must never appear current — Tasks 13/14/15/17.

---

## File structure and locked interfaces

Existing anchors below refer to the planning baseline `7a7779a`; follow symbol names after earlier tasks move code.

| Files | Responsibility |
| --- | --- |
| `src/engine/retirement/definition.ts`, `validation.ts`, `assumptions.ts` | Saved input types, source references, effective defaults and estimate provenance. |
| `src/engine/forecast/types.ts`, `context.ts`, `checkpoint.ts`, `prepare-year.ts`, `post-month.ts`, `step-year.ts` | Shared resumable ordinary/retired state; annual resolution before accepted monthly posting. |
| `src/engine/retirement/calendar.ts`, `snapshot.ts`, `commitments.ts` | January-1 branches, original anchors, employment stop and future commitments. |
| `src/engine/retirement/property-transition.ts`, `property-basis.ts`, `property-disposition.ts` | Purchase/payoff/conversion cash/debt/basis events and characterized sale facts. |
| `src/engine/retirement/account-ledger.ts`, `distributions.ts`, `required-distributions.ts` | Brokerage/traditional/Roth balances, basis, access and mandatory/planned draws. |
| `src/engine/retirement/tax-facts.ts`, `tax-attribution.ts`, `funding.ts`, `settle-year.ts` | Generated facts, fixed-facts A/B/C tax, funding solve and verified annual posting. |
| `src/engine/retirement/results.ts`, `strategies.ts`, `analysis.ts` | Candidate/path reports, four-policy comparison and summary/detail entry points. |
| `src/browser/retirement-draft.ts`, `retirement-state.ts`, `retirement-analysis.ts`, `retirement-analysis-worker.ts` | Raw transaction, authorized Apply, scheduling, streaming and caches. |
| `src/browser/retirement-chart-model.ts`, `retirement-report-model.ts` | Availability-safe candidate/calendar charts, totals, transitions and allocation denominators. |
| `src/browser/views/annual-series-chart.ts`, existing `growth-chart.ts` | Reusable responsive chart kernel with existing Overview wrapper preserved. |
| `src/browser/views/retirement.ts`, `retirement-portfolio.ts`, `retirement-property-editor.ts`, `retirement-report.ts`, `src/browser/styles/retirement.css` | Retirement composition, visual multi-property GUI and detailed reports. |

Modify existing `model/plan.ts`, `model/tax-state.ts`, `validation.ts`, `projection.ts`, tax/rule files, controller/session/routing files and their named tests where tasks specify. Keep new helpers beside their domain. Do not move unrelated forms or rewrite `state.ts` wholesale.

Input contracts are owned by Task 1; runtime/checkpoint contracts by Task 2; property events by Tasks 4/5; distribution facts by Tasks 6/7; annual tax by Task 8; settled-year reports by Task 9; public comparison/path reports by Task 10. Later task Interfaces blocks name these contracts exactly. Internal helper bodies and private state decomposition remain the implementer's choice.

### Task 1: Saved retirement definition, planning presets and validation

**Files:** Create `src/engine/retirement/{definition,validation,assumptions}.ts`, `tests/helpers/retirement.ts`, `tests/engine/retirement-definition.test.ts`; modify `src/engine/model/plan.ts`, `src/engine/validation.ts`, `src/engine/index.ts` and `tests/browser/scenario-backups.test.ts`.

**Interfaces:** Consume existing `PlanDocument`, `History<T>`, `Issue`, `RuleProvenance`, `validatePlan`. Produce:

```ts
declare function createDefaultRetirementAnalysis(source: PlanDocument): RetirementAnalysisDefinition;
declare function validateRetirementAnalysis(raw: unknown, source: PlanDocument):
  {ok:true; definition:ValidatedRetirementAnalysis} | {ok:false; issues:readonly Issue[]};
declare function resolveRetirementAssumptions(source: ValidatedPlan, definition: ValidatedRetirementAnalysis): ResolvedRetirementAssumptions;
// tests/helpers/retirement.ts
declare function makeRetirementPlan(overrides?: Partial<PlanDocument>): ValidatedPlan;
declare function makeRetirementDefinition(overrides?: Partial<RetirementAnalysisDefinition>, source?: PlanDocument): ValidatedRetirementAnalysis;
declare function makeRetirementTarget(overrides?: Partial<NewRetirementProperty>): NewRetirementProperty;
```

`PlanDocument.retirementAnalysis?` is additive. Definition fields: `schemaVersion:1`, `mode:'projected'|'reallocate'`, `withdrawalBps`, optional `stockGrowthBps`, `existingProperties`, `newProperties`, `assumptions`, `commitments`. Existing choices contain `propertyId`, `action:'keep'|'convert-to-rental'|'sell'`, `payoffLoanIds`, and action-specific sale/conversion inputs. `NewRetirementProperty` contains unique `id`, `name`, `use:'personal'|'rental'`, fixed `purchasePriceCents`, `appreciationBps`, cost/rental inputs and `financing:{kind:'cash'}|{kind:'mortgage';downPaymentBps;aprBps;termMonths}`. Defaults: projected mode, 300 withdrawal bps, no target records; stock growth inherits configured stock default only, otherwise must be entered in reallocate mode. Presets: selling 600 bps, buying 200 bps, building 8000 bps; mortgage setup 2000 bps/360 months, APR not invented. Validate withdrawal/down-payment/vacancy percentages in 0..10000 bps; growth −9999..100000 bps, loan APR 0..100000 bps and term 1..1200 months as in existing validation. Assumptions preserve estimate versus entered-history provenance and apply only to unanswered facts. Make per-property/account/owner overrides typed; never save arbitrary unvalidated dictionaries.

Test helper defaults are explicit synthetic data: start 2026, horizon 2, zero cash/other flows, $1m taxable brokerage with $1m known basis and zero growth, and the existing helper's two owners with known DOB/senior eligibility. Target helper defaults are a named $600k cash rental, $2,800 monthly rent, $7,200 annual operating costs, zero growth/vacancy, with generated stable IDs. These are fixtures, not application presets. Input overrides take precedence.

Lock target budget keys as `annualOperatingCostsCents`, optional `monthlyRentCents`, `vacancyBps` and `rentGrowthBps`; a personal-use target's operating budget is household spending, not rental income or a presumed deduction. Test personal-home fixtures explicitly set its operating cost to zero when asserting zero spending.

- [ ] **Step 1: Add failing tests and synthetic helpers.** Helpers wrap existing `makePlan`/`mustValidate`, use known synthetic DOB/SSN eligibility, and never read personal backups. Assert:

```ts
it('keeps omission and independent fixed-price rentals', () => {
  const old = makeRetirementPlan();
  expect(old).not.toHaveProperty('retirementAnalysis');
  expect(createDefaultRetirementAnalysis(old)).toMatchObject({mode:'projected',withdrawalBps:300});
  const definition = makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[
    makeRetirementTarget({id:'rental-a',purchasePriceCents:60_000_000,
      financing:{kind:'mortgage',downPaymentBps:2000,aprBps:600,termMonths:360}}),
    makeRetirementTarget({id:'rental-b',purchasePriceCents:40_000_000}),
  ]},old);
  expect(validatePlan({...old,retirementAnalysis:definition}).ok).toBe(true);
  expect(definition.newProperties.map(p=>p.purchasePriceCents)).toEqual([60_000_000,40_000_000]);
  expect(definition.newProperties[0]!.financing).toMatchObject({downPaymentBps:2000});
  expect(JSON.parse(JSON.stringify(old))).not.toHaveProperty('retirementAnalysis');
});
```

Also assert duplicate target/source IDs, dangling property/account/owner/loan references, down payments −1/10001/fractional bps, 0%/100% boundaries, unknown-vs-zero and an explicitly invalid known history. Extend applied-only backup assertions for the optional field.
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-definition.test.ts`. Expected FAIL on missing retirement APIs/validation.
- [ ] **Step 3: Implement the declared types, resolver and validator.** Integrate optional validation without injecting defaults or adding retirement coverage to ordinary `checkCoverage`. Permit numeric zero when meaningful; reject malformed amounts. Referenced source removal must require an explicit resolution instead of silently orphaning the definition.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-definition.test.ts` and `npm run test:browser -- tests/browser/scenario-backups.test.ts`, then `npm run typecheck`. Expected all pass; omission still round-trips.
- [ ] **Step 5: Commit** the named files with `git commit -m "feat: define persisted retirement analysis inputs"` after explicit `git add` of this task's files.

### Task 2: Complete forecast checkpoints and ordinary-projection equivalence

**Files:** Create `src/engine/forecast/{types,context,checkpoint,prepare-year,post-month,step-year}.ts`, `tests/engine/forecast-checkpoint.test.ts`; modify `src/engine/projection.ts:67`, `src/engine/projection-types.ts`, `src/engine/equity/rsu.ts`, `src/engine/property/{adu-lifecycle,adu-loans,adu-tax}.ts` and `tests/helpers/projection.ts` only if an additive trace requires an explicit legacy comparison projection.

**Interfaces:** Consume Task 1 and existing year-resolved tax/allocation/math functions. Produce:

```ts
declare function createForecastContext(source: ValidatedPlan, rules: RuleSet): ForecastContext;
declare function initializeForecast(context: ForecastContext): ForecastCheckpoint;
declare function stepForecastYear(context: ForecastContext, opening: ForecastCheckpoint, policy: ForecastYearPolicy): ForecastYearStep;
declare function serializeForecastCheckpoint(checkpoint: ForecastCheckpoint): string;
declare function restoreForecastCheckpoint(context: ForecastContext, json: string): Available<ForecastCheckpoint>;
declare function projectWithCheckpoints(source: ValidatedPlan, rules: RuleSet): ForecastTrace;
```

`ForecastYearStep={projection:ProjectionResult;closing:ForecastCheckpoint}`; its projection contains exactly one year/12 months and that year's schedules/traces. `ForecastTrace={projection:ProjectionResult;checkpoints:readonly ForecastCheckpoint[]}` includes initial and each next-January checkpoint. Checkpoint is versioned JSON-safe state with `year`, source/rule binding, exact Decimal strings, all account balances/basis, owner Roth/IRA history, RSU exact shares and cumulative rounding, property/original-home values, market completeness, loans/payment provenance, ADU capital/activation/earmarks, cash/gap state and complete `HouseholdTaxState`. Runtime holds original source/date anchor; it must not reset opening history. Define `ForecastYearPolicy` in runtime types, initially `{kind:'working'}`; Task 3 adds the retirement branch without changing this function signature.

- [ ] **Step 1: Add failing split-run tests.** Reuse `makeAduPlan`, RSU/future-purchase helpers and existing reference fixtures. For every January checkpoint, JSON round-trip then step the suffix; compare all existing report amounts/traces and the final exact checkpoint with uninterrupted execution. Include fractional RSU grants, a December unfinished ADU/draw, an independent unavailable rental book, a cash gap and a later purchase funded by prior brokerage deposits. Assert an unselected brokerage's contributed basis is carried too.

```ts
expect(resumedSuffix.months).toEqual(full.projection.months.filter(m => m.year >= splitYear));
expect(serializeForecastCheckpoint(resumedClosing)).toBe(serializeForecastCheckpoint(full.checkpoints.at(-1)!));
expect(restoreForecastCheckpoint(otherContext, serialized).status).not.toBe('available');
```

Fixture `resumedSuffix`/`resumedClosing` are obtained by repeatedly calling this task's `stepForecastYear(...,{kind:'working'})`; no alternative calculator supplies expected results. Existing independent worksheets remain authoritative for arithmetic.
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/forecast-checkpoint.test.ts`. Expected FAIL on missing checkpoint/resume support.
- [ ] **Step 3: Extract annual preparation and accepted monthly posting into the declared runtime.** Keep annual household/allocation solve before posting. Generalize basis tracking to every taxable account and known Roth contributions/conversion layers; preserve unknown provenance. `calculateProjection` delegates to the runtime and retains its public signature/output semantics. Do not re-amortize carried loans over a fresh original term or reconstruct exact RSU state from rounded reports.
- [ ] **Step 4: Run** `npm run test:engine` and `npm run typecheck`. Expected all legacy independent worksheets and new split-run tests pass. Additive trace fields must not mask changes to existing numeric expectations; no regenerating financial fixtures from implementation output.
- [ ] **Step 5: Commit** explicit runtime/projection/helper/test files with `git commit -m "refactor: make forecast state resumable by year"`.

### Task 3: January-1 retirement snapshots, long calendar and scheduled commitments

**Files:** Create `src/engine/retirement/{calendar,snapshot,commitments}.ts`, `tests/engine/retirement-snapshot.test.ts`; modify Task 2 runtime types/stepping, `src/engine/property/adu-planning-estimates.ts:81`, `src/engine/property/adu-loans.ts:31`, `src/engine/equity/rsu.ts` and `tests/helpers/retirement.ts` for absolute-date/resumable retirement schedules and snapshot fixtures.

**Interfaces:** Produce `validateRetirementCalendar(source:ValidatedPlan,startYear:number):Available<ValidatedRetirementCalendar>`, `createRetirementSnapshot(context:ForecastContext,opening:ForecastCheckpoint,definition:ValidatedRetirementAnalysis,calendar:ValidatedRetirementCalendar):Available<RetirementSnapshot>`, and `compileRetirementYearPolicy(snapshot:RetirementSnapshot,year:number):ForecastYearPolicy`. Calendar has `startYear` and `endYear:2100`. Snapshot retains `context`, `opening`, `definition`, `assumptions`, `retirementYear` and `endYear:2100`. Extend the runtime policy with this validated calendar, employment suppression, active inventory and commitment decisions; no unvalidated `PlanDocument` cast. Add `makeRetirementSnapshot(source?:ValidatedPlan,definition?:ValidatedRetirementAnalysis,year?:number):RetirementSnapshot` to `tests/helpers/retirement.ts`; it uses actual checkpoint/calendar APIs and throws on invalid synthetic setup.

- [ ] **Step 1: Add failing tests:** first candidate uses opening cash/basis; later candidate uses its own previous December; source horizon 2 with start 2099 yields retirement years 2099/2100 and last posted month `2100-12`; a saved horizon 75 remains invalid. Both salaries/wage other income/contributions/new service vesting stop while held RSUs, dated nonwage income, child budgets and original expense growth remain. Unowned future property supplies no sale proceeds. Keep mode continues future commitments; reallocate excludes unstarted commitments with a visible decision, continues in-progress ADUs and rejects an unsettled sold-host WIP case. Unknown age requires an explicit assumption.

Inherit source funding/coverage conditions, including omitted pre-retirement distributions or unresolved minimum-tax-credit history. Never silently declare that source complete or invent catch-up distributions; retain conditional/located results.

```ts
it('permits the retirement calendar without widening saved horizons',()=>{
  const source=makeRetirementPlan({startYear:2099,horizonYears:2});
  expect(validateRetirementCalendar(source,2099)).toMatchObject({status:'available',value:{startYear:2099,endYear:2100}});
  expect(validatePlan({...source,horizonYears:75}).ok).toBe(false);
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-snapshot.test.ts`. Expected FAIL on missing calendar/policy behavior.
- [ ] **Step 3: Implement the snapshot/policy APIs and runtime calendar support.** Keep original source anchors, resolve future ADU estimates by actual requested year and retain already-committed books/draws. January-1 transition precedes withdrawal target calculation. Retained assets keep January growth; new acquisitions use the existing purchase convention of appreciation/regular interest beginning in February, with first normal mortgage payment in February, displayed as a planning assumption. January rental use still uses residential mid-month depreciation. Closing boundary may be `2101-01-01`; no 2101 month is simulated.

Disable the source's ordinary contribution rules/cash-flow allocation after retirement; retirement reinvestments are explicit ledger transfers. Cancel dependent rent/expense/draw schedules with an excluded unstarted purchase/project, not just its asset-value event.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-snapshot.test.ts tests/engine/adu-loans.test.ts tests/engine/adu-lifecycle.test.ts tests/engine/adu-tax.test.ts tests/engine/adu-projection.test.ts tests/engine/rsu-projection.test.ts tests/engine/future-purchase-projection.test.ts` and `npm run typecheck`. Expected passing, with source input JSON unchanged.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: branch retirement forecasts through 2100"`.

### Task 4: Property purchase, payoff and conversion ledger

**Files:** Create `src/engine/retirement/{property-transition,property-basis}.ts`, `tests/engine/retirement-property-transition.test.ts`, `fixtures/tax/retirement-conversion-basis.json`; modify `src/engine/forecast/{types,prepare-year,post-month}.ts` and `src/engine/model/tax-state.ts` for active inventory/lifecycle history.

**Interfaces:** Produce `compilePropertyTransition(snapshot:RetirementSnapshot):PropertyTransitionDraft`, `applyPropertyTransition(opening:ForecastCheckpoint,events:readonly PropertyTransitionEvent[]):PropertyTransitionResult`, and `resolveConversionBasis(input:ConversionBasisInput):Available<ConversionBasisResult>`. Basis input has `adjustedBuildingBasisCents` and `buildingFmvCents`, resolved separately for each book; result has `gainBuildingBasisCents` and `depreciationBuildingBasisCents`. Event discriminator `kind` is `sale|payoff|conversion|purchase` for whole-property sale intent, retained-loan payoff, personal-to-rental conversion and cash/mortgaged purchase. Each event has stable ID/date/property ID and distinct cash, asset, liability and basis movements. Draft/result expose `events`, result also exposes `opening`, `fundingNeedCents:Available<Cents>`, `issues`; purchase event exposes derived `downPaymentCents`, `mortgagePrincipalCents`, `buyingCostsCents`. Actual sale tax is supplied by Task 5, not estimated with a flat rate here.

- [ ] **Step 1: Add failing independent accounting tests.** A $600,000 target at 20% down requires $120,000 down, $480,000 mortgage and, at 2%, $12,000 purchase costs. 0%/100% and zero APR remain valid; malformed percentages fail Task 1. Keep another loan without re-amortization. Paying a retained $200,000 loan removes cash/debt once and stops its payments; retained equity is not deducted a second time. Two rentals retain independent cost/rent/tax-unit records. Conversion $500,000 adjusted basis/$400,000 FMV at 80% building gives $400,000 historical gain-building basis and $320,000 depreciation-building basis; full subsequent-year depreciation is $11,636.36. Preserve separate unavailable CA/AMT book state.

```ts
it('preserves gain basis while limiting conversion depreciation basis',()=>{
  expect(resolveConversionBasis({adjustedBuildingBasisCents:40_000_000,buildingFmvCents:32_000_000})).toMatchObject({
    status:'available',value:{gainBuildingBasisCents:40_000_000,depreciationBuildingBasisCents:32_000_000},
  });
});
it('derives mortgage cash needs from a percentage down payment',()=>{
  const source=makeRetirementPlan();
  const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[
    makeRetirementTarget({financing:{kind:'mortgage',downPaymentBps:2000,aprBps:600,termMonths:360}}),
  ]},source);
  const purchase=compilePropertyTransition(makeRetirementSnapshot(source,definition)).events.find(e=>e.kind==='purchase');
  expect(purchase).toMatchObject({downPaymentCents:12_000_000,mortgagePrincipalCents:48_000_000,buyingCostsCents:1_200_000});
});
```

Create fixture worksheet metadata using `loadReferences`/`assertReference`, not engine-generated expectations. Add the Review Focus multi-loan/unowned-property cases explicitly.
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-property-transition.test.ts`. Expected FAIL on missing property events.
- [ ] **Step 3: Implement the declared compiler/basis/posting APIs.** Preserve one property asset across multiple rental units/ADU areas, fixed new prices across candidates, existing appreciation and new-loan schedules. End only correctly linked old expenses/rent/loans; preserve unlinked household expenses and historical books. Retained payoff and conversion never imply a sale or loss release.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-property-transition.test.ts tests/engine/property-input-defaults.test.ts tests/engine/loans.test.ts tests/engine/adu-allocation-projection.test.ts` and `npm run typecheck`. Expected reconciled cash/assets/debt and no changed ordinary results.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: model retirement property transitions"`.

### Task 5: Characterized property-sale tax facts and activity disposition

**Files:** Create `src/engine/retirement/property-disposition.ts`, `tests/engine/retirement-property-disposition.test.ts`, `fixtures/tax/retirement-property-dispositions.json`; modify `src/engine/property/{facts,depreciation}.ts`, `src/engine/tax/rental-losses.ts`, `src/engine/model/tax-state.ts`, `src/engine/rules/{federal-2026,california-2026,types,registry}.ts` and `sources/register.md`.

**Interfaces:** Produce `calculatePropertyDisposition(input:PropertyDispositionInput):Available<PropertyDispositionResult>` and `PropertyDispositionTaxFacts`. Facts have event/property/activity IDs, `purpose:'transition'`, independent `TaxBook` results containing ordinary recapture, unrecaptured-1250 gain, remaining long-term/1231 gain, recognized loss, excluded-121 gain and passive-disposition income; `releasesEntireActivity:Available<boolean>`. Cash settlement remains in Task 4's ledger. Result includes known/estimated ownership/use, basis and depreciation provenance.

- [ ] **Step 1: Add failing sourced worksheet cases.** $800,000 price −$48,000 selling costs −$450,000 adjusted basis = $302,000 gain; changing payoff from $200,000 to $300,000 changes cash from $552,000 to $452,000, never gain. Test full home exclusion eligibility, unknown exclusion/no assumed benefit, nonexcludable depreciation, conversion gain/loss bases, nondeductible personal loss, supported rental loss and an entire unrelated taxable disposition's passive releases. Include disposal-year mid-month depreciation before final gain basis: a nonexhausted building otherwise recovering $12,000/year gets $500 for January disposal, not $12,000. Multi-unit property disposal must not release losses of an unrelated/grouped retained activity. Unsupported partial/exchange/reduced-exclusion facts remain located unavailable results.

```ts
it.each(loadReferences<PropertyDispositionInput,Available<PropertyDispositionResult>>('retirement-property-dispositions'))('$id',c=>{
  const result=calculatePropertyDisposition(c.input);
  assertReference(result,c.expected,c.toleranceCents);
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-property-disposition.test.ts`. Expected FAIL on absent disposition characterization/release support.
- [ ] **Step 3: Implement the fact calculation and activity-aware loss-state changes.** Preserve four books and prior use/depreciation; never infer tax basis from equity or apply 25% to all depreciation. Source ordinary §1231/§1250/§121 treatment from IRS Publications 523/544/925 and California differences; store a labeled zero lookback/grouping assumption only where history is unanswered. Do not remove a sold rental before generating its disposition facts.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-property-disposition.test.ts tests/engine/tax/rental-losses.test.ts tests/engine/property.test.ts tests/engine/adu-tax.test.ts` and `npm run typecheck`. Expected independent worksheet outputs and preserved unrelated loss pools.
- [ ] **Step 5: Commit** source/rule/fixture/test files with `git commit -m "feat: characterize retirement property sale taxes"`.

### Task 6: Account movements, brokerage basis and traditional distributions

**Files:** Create `src/engine/retirement/{account-ledger,distributions}.ts`, `tests/engine/retirement-distributions.test.ts`, `fixtures/tax/retirement-distributions.json`; modify `src/engine/model/tax-state.ts`, `src/engine/rules/retirement-2026.ts` and owner/account history support from Task 1.

**Interfaces:** Produce `resolveRetirementDistributions(input:DistributionYearInput):DistributionYearResult`, `RetirementDistributionTaxFacts`, `DistributionAccountState`, `AcceptedDistributionSchedule` and `WithdrawalStrategyId='taxable-first'|'traditional-first'|'roth-first'|'annual-tax-aware'`. Distribution facts have event/account/owner/date, `purpose:'recurring'|'mandatory-excess'|'transition'`, gross, federal/CA taxable amounts, basis recovered, additional tax and RMD-eligible amounts, all availability-preserving. Input contains immutable opening accounts, proposed dated gross legs, accepted year-end owner IRA values and sourced year rules; result contains accepted schedule, closing basis/state, tax facts and issues.

Add optional `HouseholdTaxState.retirementAccountState` for independent federal/CA owner IRA basis and account-specific Roth contribution/conversion/clock history. Preserve the legacy `iraBasisByOwner` federal contract and synchronize its closing value; do not change old fixture shapes to a different record type. Store distribution facts as `DistributionYearResult.taxFacts`.

- [ ] **Step 1: Add failing cases.** Brokerage $100,000 value/$60,000 basis with $10,000 sold consumes $6,000 basis and realizes $4,000; full liquidation consumes remaining basis exactly; new taxable deposits add basis. Unknown basis stays unknown in saved history. IRA owner has $15,000 basis, $30,000 distributed and $90,000 year-end aggregate value: recover $3,750 basis, taxable $26,250, closing basis $11,250. Splitting the same owner across two IRAs must not choose one account's basis first. Separate CA basis can change CA taxable amount without changing gross cash. Withheld/generated vest gains must not become new wages a second time.

In reallocate mode, held employer shares worth $10,000 with $6,000 basis diversify into taxable stocks: report $4,000 generated gain, remove those held shares once and add basis only for net cash actually reinvested. Existing ordinary brokerage holdings are not fully sold merely to relabel the portfolio; rebalancing inside a retirement wrapper does not create taxable cash or change its owner/type.

```ts
it.each(loadReferences<DistributionYearInput,DistributionYearResult>('retirement-distributions'))('$id',c=>{
  const before=structuredClone(c.input);
  const result=resolveRetirementDistributions(c.input);
  assertReference(result,c.expected,c.toleranceCents);
  expect(c.input).toEqual(before);
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-distributions.test.ts`. Expected FAIL on missing distribution/basis support.
- [ ] **Step 3: Implement account ledger and traditional/brokerage distribution resolution.** Reuse aggregate long-term brokerage conventions, preserve actual wrapper/owner, carry exact balances and basis, cap draws at availability and never encode them as negative contributions. Freeze a proposed gross schedule before owner pro-rata resolution; later tax views consume its facts without consuming basis again.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-distributions.test.ts tests/engine/brokerage-funding.test.ts tests/engine/backdoor-roth.test.ts tests/engine/rsu-projection.test.ts` and `npm run typecheck`. Expected exact gross/basis/balance reconciliation and unchanged working calculations.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: resolve retirement account distribution basis"`.

### Task 7: Roth access, early-distribution taxes and required distributions

**Files:** Create `src/engine/retirement/required-distributions.ts`, `tests/engine/retirement-distribution-rules.test.ts`, `fixtures/tax/retirement-distribution-rules.json`; modify `src/engine/retirement/{distributions,definition,assumptions}.ts`, `src/engine/model/tax-state.ts`, `src/engine/rules/{retirement-2026,types,registry}.ts` and `sources/register.md`.

**Interfaces:** Extend `resolveRetirementDistributions` without changing its signature. Produce `calculateRequiredDistributions(input:RmdYearInput):Available<RmdYearRequirement>` and `resolveDistributionAccess(input:DistributionAccessInput):Available<DistributionAccessResult>`. Inputs explicitly include owner/spouse DOB, account kind/beneficiary facts, prior-December balances, distribution date, Roth first-contribution year/conversion layers and supported separation exception. RMD result is per account and per permitted owner aggregation group; never aggregate 401(k) requirements as freely as IRAs.

- [ ] **Step 1: Add failing date/rule cases.** At age 50, $20,000 fully taxable traditional distribution/no exception adds federal $2,000 and CA $500 beyond ordinary tax. Test exact 59½ date in both timezones, no guessed exception, supported age-55 employer-plan exception not transferred to IRA, Roth IRA contribution-first/FIFO conversion ordering and designated-Roth pro-rata differences. Under-59½ $25,000 draw consumes $20,000 regular basis plus $5,000 seasoned 2019 conversion without inventing an earnings draw. Born 1960: no RMD merely at 73 in 2033; first year 2035, prior $246,000 /24.6 = $10,000 at 75. Test spouse >10-years-younger table, age-120+ endpoint, no Roth-owner lifetime RMD and unknown DOB located needs-data. Repeated trial evaluation must leave basis/history unchanged.

```ts
it.each(loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules').filter(c=>c.id.startsWith('rmd-')))('$id',c=>{
  const result=calculateRequiredDistributions(c.input);
  assertReference(result,c.expected,c.toleranceCents);
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-distribution-rules.test.ts`. Expected FAIL on missing access/RMD behavior.
- [ ] **Step 3: Implement sourced rules and resolve access/mandatory draws.** Use DOB cohort final regulations, IRS 590-B tables and designated-Roth rules, FTB additional taxes. Store factors as exact tenths/Decimal, never indexed tax brackets. Preserve different Roth clocks and no automatic rollover. First RMD is satisfied in its calendar year. Take required amounts before discretionary order; Task 9 handles excess reinvestment.
- [ ] **Step 4: Run** `TZ=UTC npm run test:engine -- tests/engine/retirement-distribution-rules.test.ts` and the same command with `TZ=America/Los_Angeles`, then `npm run typecheck`. Expected identical date/amount assertions and passing rule provenance fixtures.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: enforce retirement distribution access and RMD rules"`.

### Task 8: Full household tax evaluation and fixed-facts A/B/C attribution

**Files:** Create `src/engine/retirement/{tax-facts,tax-attribution}.ts`, `tests/engine/retirement-household-tax.test.ts`, `fixtures/tax/retirement-household-tax.json`; modify `src/engine/tax/{comparison,facts,modified-income,federal,california,itemized}.ts`, `src/engine/coverage.ts`, `src/engine/rules/{federal-2026,california-2026,retirement-2026,types,registry}.ts` and `sources/register.md`.

**Interfaces:** Consume Tasks 5–7 characterized facts. Produce:

```ts
declare function buildRetirementTaxFacts(input:RetirementTaxYearInput): ResolvedRetirementTaxYear;
declare function evaluateFixedHouseholdTaxYear(input:FixedHouseholdTaxYearInput): FixedHouseholdTaxYearResult;
declare function attributeRetirementTax(input:AcceptedRetirementTaxYear): RetirementTaxAttribution;
```

`RetirementTaxAttribution` has available `recurringCents`, `mandatoryExcessCents`, `transitionCents`, `totalCents`, accepted complete-C closing state/provenance. `FixedHouseholdTaxYearInput` contains resolved facts, property/mortgage deduction facts, opening tax state, year rules and state-paid policy; result retains all four legal deduction candidates and selected tax. Extract this seam from `resolveHouseholdYear` while preserving its existing public signature/working behavior. `AcceptedRetirementTaxYear` holds one already-resolved gross/basis schedule and three fixed-facts views; attribution never reruns funding.

- [ ] **Step 1: Add failing fixtures/assertions.** Ordinary IRA taxable amounts enter regular/AMT AGIs and every affected MAGI once, not compensation or NIIT income; gain categories retain federal stacking/1250 treatment and CA character. Compare all four legal deduction pairs. Resolve schedules/basis once, evaluate A recurring, B plus mandatory excess, C plus transition. Assert signed differences, including an independent case A=1000/B=900/C=1500 cents giving `1000,-100,600,1500`, and a real household worksheet. Commit only C closing state. Preserve unrelated unsupported minimum-tax-credit/household coverage and isolate one unavailable book.

```ts
it.each(loadReferences<RetirementTaxYearInput,ResolvedRetirementTaxYear>('retirement-household-tax'))('$id',c=>{
  assertReference(buildRetirementTaxFacts(c.input),c.expected,c.toleranceCents);
});
```

In test `attributes signed tax increments without repeating basis recovery`, use a test-only annual evaluator spy with totals A=1000, B=900, C=1500. Assert available attribution fields `recurringCents=1000`, `mandatoryExcessCents=-100`, `transitionCents=600`, `totalCents=1500`, exactly one gross/basis resolution, three tax evaluations and only C's closing state committed. The sourced household cases exercise the production evaluator.
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-household-tax.test.ts`. Expected FAIL on missing generated facts/1250/additional-tax/attribution support.
- [ ] **Step 3: Implement declared tax seams and characterized facts.** Do not route sales through wages or rental operating profit. Track CA ordinary liability and early-distribution additional tax separately from deductible state-paid input. Official sources do not settle the additional tax's federal SALT classification in this design: use a visible editable **“No federal SALT benefit modeled for California early-distribution additional tax”** estimate, not a claim about law. Pin ordinary CA tax 1_000_000 plus additional 50_000 cents → total 1_050_000 and prospective deductible-state input 1_000_000 under that estimate. Source IRS Schedule A/FTB 3805P and retain actual state-paid overrides. Extend coverage only for generated supported retirement circumstances.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-household-tax.test.ts tests/engine/tax` and `npm run typecheck`. Expected all old tax worksheets pass, A+(B−A)+(C−B)=C exactly, and basis is not consumed three times. Include independent regular/AMT special-gain worksheets with ordinary rates below the 25% ceiling.
- [ ] **Step 5: Commit** explicit tax/rule/fixture/test files with `git commit -m "feat: integrate retirement cash flows with household taxes"`.

### Task 9: Verified transition funding and retired-year settlement

**Files:** Create `src/engine/retirement/{funding,settle-year,results}.ts`, `tests/engine/retirement-funding.test.ts`, `tests/engine/retirement-year.test.ts`; modify `src/engine/forecast/{types,prepare-year,post-month,step-year}.ts` for accepted retirement posting. New results define `RetirementYear`, `RetirementTransitionReport`, `RetirementYearSettlement`.

**Interfaces:** Consume Tasks 3–8. Produce `solveRetirementFunding(input:RetirementFundingInput):RetirementFundingResult` and `settleRetirementYear(snapshot:RetirementSnapshot,opening:ForecastCheckpoint,strategy:WithdrawalStrategyId):RetirementYearSettlement`. Funding input has immutable opening assets/events plus a full-year evaluation callback; result separates verified, genuine shortfall and nonconvergent states. Settlement exposes `year:RetirementYear`, `closing:ForecastCheckpoint`, optional transition report and issues. Monetary report fields retain `Available<Cents>`; an unavailable field must not discard independent amounts. Extend `ForecastYearPolicy` to post this accepted settlement through the shared runtime, keeping the ordinary branch unchanged.

`RetirementYear` period field names are `year`, `rentalCashCents`, `plannedWithdrawalCents`, `otherCashIncomeCents`, `afterTaxIncomeCents`, `personalExpensesCents`, `personalDebtPaymentsCents`, `surplusCents`, `cashBalanceCents`, `stockBalanceCents`, `propertyValueCents`, `debtBalanceCents`, `netWorthCents`, plus separate required/excess/reinvested amounts, tax attribution and funding/provenance. Monetary fields are `Available<Cents>`. `RetirementAllocationSnapshot` records opening stable property/account IDs, use/status, asset/debt/equity/cash-needed values and stock/cash totals. Transition report and later Task 10 path detail share this opening snapshot; it is not a December balance sheet.

- [ ] **Step 1: Add failing reconciliation tests.** With $1m all-basis taxable stocks, zero growth and no tax, a $600k cash target plus 2% buying cost leaves $388k opening stocks; 3% draws $11,640, monthly $970. Year-end stocks $376,360 + cash $11,640 + home $600k = $988k, showing only $12k transaction cost lost. The same home at 20% down requires $132k cash and opens a $480k mortgage, not $612k cash. Assert annual 100-cent withdrawal splits to `[8,9,8,8,9,8,8,9,8,8,9,8]`; zero rate and depletion cap correctly. Test required $40k versus planned $30k: $10k excess less its attributed tax enters taxable brokerage/basis once. A transition distribution satisfying part of an RMD never also supplies recurring spendable income. Test tax gross-up including tax on the tax-covering draw, signed increments, final replay, one-cent lower sufficient boundary, insufficient assets and deliberate evaluator nonconvergence.

Include a January purchase that cannot spend December rent, restricted ADU cash that cannot become the stock remainder, and an underwater sale that requires extra payoff funding rather than clearing debt for free. Retained payoff followed by a changed Sell action must settle the same loan only once.

```ts
it('draws the rate from assets left after a cash home purchase',()=>{
  const source=makeRetirementPlan();
  const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,
    newProperties:[makeRetirementTarget({id:'home',use:'personal',purchasePriceCents:60_000_000,appreciationBps:0,annualOperatingCostsCents:0})]},source);
  const snapshot=makeRetirementSnapshot(source,definition);
  const settled=settleRetirementYear(snapshot,snapshot.opening,'taxable-first');
  expect(settled.year.plannedWithdrawalCents).toEqual({status:'available',value:1_164_000});
  expect(settled.year.stockBalanceCents).toEqual({status:'available',value:37_636_000});
  expect(settled.year.cashBalanceCents).toEqual({status:'available',value:1_164_000});
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-funding.test.ts tests/engine/retirement-year.test.ts`. Expected FAIL on missing coordinated funding/settlement.
- [ ] **Step 3: Implement the declared solver and settlement.** Apply transition before the first-year rate base; evaluate complete annual tax and owner basis with every proposed schedule; verify immutable replay and each ledger dimension. Bound iterations using a named tested constant, preserve signed attribution and account caps, and distinguish `conditional-on-gap` from calculation failure. Retain ordinary personal spending surplus in cash and report deficits. Reinvest only mandatory excess and transition remainder as specified; do not make unrestricted IRA contributions or repeat property events in later years.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-funding.test.ts tests/engine/retirement-year.test.ts tests/engine/forecast-checkpoint.test.ts tests/engine/retirement-household-tax.test.ts tests/engine/adu-brokerage-projection.test.ts` and `npm run typecheck`. Expected all accounting identities and old funding behavior pass.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: settle retirement transitions withdrawals and taxes"`.

### Task 10: Full-horizon strategies and public comparison/detail APIs

**Files:** Create `src/engine/retirement/{strategies,analysis}.ts`, `tests/engine/retirement-analysis.test.ts`; finish `src/engine/retirement/results.ts` and export public types/functions from `src/engine/index.ts`.

**Interfaces:** Produce:

```ts
declare function prepareRetirementAnalysis(source:ValidatedPlan,rules:RuleSet,definition:ValidatedRetirementAnalysis):Available<RetirementAnalysisContext>;
declare function calculateRetirementPath(snapshot:RetirementSnapshot,strategy:WithdrawalStrategyId):RetirementPath;
declare function calculateRetirementCandidate(context:RetirementAnalysisContext,retirementYear:number):RetirementCandidateSummary;
declare function calculateRetirementDetails(context:RetirementAnalysisContext,retirementYear:number,strategy:WithdrawalStrategyId):RetirementPath;
```

Context contains source/rules/definition fingerprints, candidate years and shared working checkpoints. `RetirementPath` contains `years:readonly RetirementYear[]`, monthly detail, `openingAllocation:RetirementAllocationSnapshot`, transition report, closing state, issues/provenance, `completion:'complete'|'conditional'|'unavailable'` and objective values. Period/opening-allocation fields use Task 9's contract. `RetirementCandidateSummary` has `retirementYear`, `strategyId`, `firstYear:RetirementYear`, `totalAfterTaxIncomeCents`, `endingNetWorthCents`, `additionalDistributionTaxCents`, completion/funding status and issues/provenance. `RetirementComparison` carries `planId`, `inputRevision`, `definitionFingerprint` and `candidates:readonly RetirementCandidateSummary[]`; it contains no trial monthly traces.

- [ ] **Step 1: Add failing tests.** A 2099/2100 zero-growth, all-basis $1m stock path at 3% pays $30,000 then $29,100; ends `2100-12`, stocks $940,900 and retained cash $59,100. Every candidate starts from its own working checkpoint. Four policy IDs use identical percentage/spending rules, respect balances/required draws and rank by total after-tax income, then ending net assets, then fewer additional taxes, then lexicographic ID. Assert identical/tied results choose `annual-tax-aware`; a controlled real-tax household where current-year cheapest differs from cumulative-best uses the full path. An incomplete/conditional path is not ranked as a proven winner, but valid earlier annual fields remain inspectable. Reordering input records does not alter tie-breaking.

```ts
it('keeps the full two-year path ending in 2100',()=>{
  const source=makeRetirementPlan({startYear:2099,horizonYears:2});
  const path=calculateRetirementPath(makeRetirementSnapshot(source,makeRetirementDefinition({},source),2099),'taxable-first');
  expect(path.years.map(y=>y.plannedWithdrawalCents)).toEqual([
    {status:'available',value:3_000_000},{status:'available',value:2_910_000}]);
  expect(path.years.at(-1)!.stockBalanceCents).toEqual({status:'available',value:94_090_000});
  expect(path.years.at(-1)!.cashBalanceCents).toEqual({status:'available',value:5_910_000});
});
```
- [ ] **Step 2: Run** `npm run test:engine -- tests/engine/retirement-analysis.test.ts`. Expected FAIL on missing full-path selection/comparison.
- [ ] **Step 3: Implement public analyzer and four strategies.** `annual-tax-aware` tests feasible mixes at remaining-account caps, rate target and resolved ordinary/capital-gain bracket breakpoints using the authoritative annual evaluator; bounded deterministic search is not advertised as a mathematical global optimum. Other strategies order eligible wrappers then stable account ID, satisfying mandatory draws first. Generate working checkpoints once; compare complete policy paths, retain summaries and recompute/cache selected detail separately. Also calculate `RetirementCandidateSummary.projectedComparison` with `{firstYear:RetirementYear;strategyId;completion;issues}`: same source/withdrawal rule/assumptions, projected use/growth and no target transactions. Reuse checkpoints and the active result when already in projected mode. This supplies the dashed comparison without mixing in working salary income. Never discount nominal dollars or extend working candidate years silently.
- [ ] **Step 4: Run** `npm run test:engine -- tests/engine/retirement-analysis.test.ts tests/engine/public-api.test.ts`, then `npm run typecheck`. Expected exact horizon/objective/tie assertions and JSON-safe public reports.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: compare retirement strategies through 2100"`.

### Task 11: Independent retirement draft and atomic persistence transaction

**Files:** Create `src/browser/{retirement-draft,retirement-state}.ts`, `tests/browser/retirement-state.test.ts`; modify `src/browser/state.ts:13,37,77`, `src/browser/scenario-session.ts`, `src/browser/scenario-app.ts:31`, source-reference removal handling and `tests/browser/scenario-backups.test.ts`.

**Interfaces:** Produce `RetirementDraft={baseSnapshot:string;generation:number;value:RawObject}`, `createRetirementDraft(plan:ValidatedPlan):RetirementDraft`, `decodeRetirementDraft(draft:RetirementDraft,source:ValidatedPlan):{definition?:ValidatedRetirementAnalysis;issues:readonly Issue[]}`. Extend controller with `getRetirementDraft():RetirementDraft`, `editRetirementDraft(draft:RetirementDraft):void`, `discardRetirementDraft():void`. Separate bridge APIs:

```ts
declare function prepareRetirementEdit(controller:WorkspaceController):PreparedRetirementEdit;
declare function prepareRetirementWorkspace(controller:WorkspaceController,scope:'applied'|'draft'):PreparedRetirementWorkspace;
declare function completeRetirementEdit(controller:WorkspaceController,prepared:ReadyRetirementEdit,
  result:RetirementCompletedCalculation):RetirementReceipt|null;
declare function applyRetirementEdit(controller:WorkspaceController,receipt:RetirementReceipt):SaveRecordResult;
```

`PreparedRetirementEdit` is ready/unchanged/invalid/stale. Ready captures exact source/candidate plan, rules, epoch, definition snapshot and draft generation. Completed calculation contains the candidate's ordinary `ProjectionResult` with matching revision and final `RetirementComparison`; receipt is single-use and privately authorized. Do not add retirement to ordinary `EditTarget` or publish retirement into `WorkspaceState.projection`.

`prepareRetirementWorkspace` is the read/preview bridge: ready captures `plan`, `ruleSet`, effective `definition` and optional authorized `edit:ReadyRetirementEdit`. Applied scope works with an absent definition's passive defaults; unchanged drafts fall back to applied calculation. Draft scope validates current raw values and returns invalid/stale with issues when necessary. Only the optional edit can produce an Apply receipt. An unconfigured/read-only tab must not depend on a financial mutation.

Define `RetirementViewSelection` on the session: `candidateYear:number|null`, `calendarYear:number|null`, `candidateHorizon:5|10|15|'all'`, `showProjectedComparison:boolean`, optional `selectedPropertyId`, and `pathMetric:'after-tax-income'|'stock-balance'|'net-worth'`; expansion/scroll are session-only maps. Initial candidate uses the valid current Overview selection or final candidate. Normalize path years into candidate..2100; no overlap means null selection and an empty-state explanation.

- [ ] **Step 1: Add failing controller tests.** Passive defaults/year selection and formatting-only/reversed changes cause no revision/write. Two rental raw drafts retain independent input and percent down payment; invalid raw text survives rejected Apply. A current completed receipt changes only definition/revision, preserves other drafts, saves once and keeps ordinary financial amounts. Replayed/tampered/stale receipts fail. Unrelated source Apply rebases raw retirement inputs; changed applied retirement definition marks the draft stale. Fork/export copy applied definition only; replace/restore clear old receipts/session state even with reused IDs/revisions. Storage failure leaves applied retirement inputs exportable and marked unsaved. Removing referenced property/account/loan must show a dependency.

```ts
it('does not apply merely by reading default retirement fields',()=>{
  const {controller}=mountWorkspace(makeRetirementPlan());
  const before=controller.getState().savedPlan;
  controller.getRetirementDraft();
  expect(controller.getState().savedPlan).toBe(before);
  expect(controller.getState().savedPlan).not.toHaveProperty('retirementAnalysis');
});
```
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/retirement-state.test.ts tests/browser/scenario-backups.test.ts`. Expected FAIL on absent transaction methods/retention.
- [ ] **Step 3: Implement the raw decoder and private receipt bridge through existing `commitProjection`/`EditorPublicationPort`.** Extend per-scenario view with retirement selection/draft-result slots and header draft indicator. Use explicit decoding for percent/term/date/history keys; inactive caches remain draft-only until validly applied. Structural validity can be applied with located financially unavailable results; a missing number is not converted to zero. Keep normal applied result metadata aligned with the new revision.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/retirement-state.test.ts tests/browser/scenario-backups.test.ts tests/browser/scenario-manager.test.ts tests/browser/editor-publication.test.ts tests/browser/edit-receipts.test.ts` and `npm run typecheck`. Expected one-write publication and unchanged ordinary preview ownership.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: persist scenario retirement drafts atomically"`.

### Task 12: Cancellable worker, streamed summaries and selected-detail cache

**Files:** Create `src/browser/{retirement-analysis,retirement-analysis-worker}.ts`, `tests/helpers/retirement-worker.ts`, `tests/browser/retirement-analysis.test.ts`; extend Task 11 retirement state/session result types.

**Interfaces:** Produce `createRetirementAnalysisScheduler(controller:WorkspaceController,publish:(state:RetirementAnalysisViewState)=>void,ownership:RetirementBindingOwnership):RetirementAnalysisScheduler`. Ownership is `{owner:RetirementBindingOwner;isCurrent(owner:RetirementBindingOwner):boolean}`; binding owner extends existing `PreviewOwner` with `workspaceGeneration:number`. Scheduler exposes `request(scope?:'applied'|'draft'):void`, `selectYear(year:number):void`, `invalidate():void`, `dispose():void`; scope defaults to its current selection, initially applied, and uses Task 11's read/preview bridge. Requests are discriminated `kind:'comparison'|'detail'`; replies are `kind:'progress'|'candidate'|'complete'|'detail'|'failed'`. Every message includes workspace/scenario/session/activation, immutable source/candidate binding, input revision, definition fingerprint/generation, rule version and request/detail generations. View state is inactive/pending/calculated/invalid/stale/failed with explicitly owned retained results; progress is not a completed comparison. Test helper `createRetirementWorkerHarness()` captures real scheduler requests/publications with a controlled Worker and restores the manager; it must not implement ownership decisions itself.

- [ ] **Step 1: Add failing controlled-worker tests.** Deliver batches out of order, complete after source Apply, switch scenario during a tax solve, restore identical IDs/revisions, detach a listener and finish an old detail request. All obsolete publications must be ignored. Input changes cancel old work; repeated hover/select uses summary data/cache without recalculating the full comparison; a detail cache cannot cross sources/rules. A partially processed set never says best/complete, and the final receipt needs current complete comparison plus matching ordinary projection. Fatal worker error differs from a candidate with unavailable financial fields.

```ts
it('ignores a completed reply after a same-id revision restore',()=>{
  const h=createRetirementWorkerHarness();
  const old=h.requests[0]!;
  h.restoreSameIds();
  const count=h.publications.length;
  h.deliver(h.completedReply(old));
  expect(h.publications).toHaveLength(count);
});
```
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/retirement-analysis.test.ts`. Expected FAIL on missing worker/scheduler authority.
- [ ] **Step 3: Implement protocol/scheduler using Task 10 APIs and the ADU scheduler's generation pattern.** Export pure `runRetirementAnalysisRequest(request:RetirementWorkerRequest,post:(reply:RetirementWorkerReply)=>void):void` from the worker module. Build context once per request; stream only a candidate whose active and projected-baseline policies are fully processed. Keep separate comparison/detail workers: year selection never cancels the main comparison; debounce uncached detail requests by 150ms and cancel only obsolete detail work. Bound completed-summary caches to the current controller/source/definition/rules and selected path cache to 2 candidates. On a comparison request, calculate the candidate ordinary projection for authorized Apply; never send all trial monthly ledgers. Keep progress/checking labels honest and terminate both workers on source invalidation/disposal. Missing `Worker` yields an explicit calculation-unavailable/retry state, not a long main-thread forecast. Unit tests invoke the pure runner directly; integration tests use the controlled Worker. Fake-timer tests must prove rapid year changes preserve the comparison and request only the final uncached detail after 150ms.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/retirement-analysis.test.ts tests/browser/adu-comparison.test.ts tests/browser/edit-preview.test.ts` and `npm run typecheck`. Expected all owner/race assertions pass.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: calculate retirement comparisons in owned workers"`.

### Task 13: Reusable accessible annual-series chart, preserving Overview

**Files:** Create `src/browser/views/annual-series-chart.ts`, `tests/browser/annual-series-chart.test.ts`; modify `src/browser/views/growth-chart.ts` and its chart-specific styles. Keep `src/browser/growth-chart-model.ts`/Overview public behavior.

**Interfaces:** Produce `mountAnnualSeriesChart(root:HTMLElement,model:AnnualSeriesChartModel,options:AnnualSeriesChartOptions):{update(model:AnnualSeriesChartModel):void;dispose():void}`. Model defines `title`, `ariaLabel`, help/x-axis label, available years/windows, selected year, series `{id,label,lineStyle:'solid'|'dashed'}` and points `{year,values:Readonly<Record<string,Available<Cents>>>}`. Options provide `onSelectYear`, `onWindowChange` and `onComparisonChange`; geometry never calculates financial values. Existing `mountGrowthChart` signature remains a wrapper adapting its current net-worth model/labels/readout to this kernel.

- [ ] **Step 1: Add failing chart tests.** Retire-year labels must not read Net worth/Applied plan. Assert keyboard Home/End/Arrows, pointer/touch exact-year selection, zero/negative values, unavailable gaps, hidden comparison sharing the same domain, reduced-motion behavior and focused select retention. At 320/390/1440 widths the SVG viewBox follows actual width and axis text stays readable, not a scaled-down desktop drawing. Existing growth-chart tests retain their current exact assertions.

```ts
it('selects candidate years with the keyboard',()=>{
  const onSelectYear=vi.fn();
  // Local chartFixture has 2026..2028, values 0/−10000/needs-data,
  // semantic retirement labels and the required model controls.
  const view=mountAnnualSeriesChart(root,chartFixture(),{onSelectYear,onWindowChange:vi.fn(),onComparisonChange:vi.fn()});
  fireEvent.keyDown(root.querySelector('svg')!,{key:'Home'});
  expect(onSelectYear).toHaveBeenLastCalledWith(2026);
  view.dispose();
});
```
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/annual-series-chart.test.ts tests/browser/growth-chart.test.ts`. Expected new chart imports fail while legacy tests initially pass.
- [ ] **Step 3: Extract drawing/selection/animation into the semantic kernel.** Reuse current responsive geometry and controls; retain Overview wrapper's source/comparison labels, CSS landmarks and original year-window behavior. Display available cents through existing money formatters; no finance arithmetic in SVG code. Preserve existing visual baselines instead of regenerating them to hide unrelated changes.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/annual-series-chart.test.ts tests/browser/growth-chart.test.ts tests/browser/growth-overview-integration.test.ts tests/browser/growth-chart-model.test.ts` and `npm run typecheck`. Expected no Overview behavior regression.
- [ ] **Step 5: Commit** named files with `git commit -m "refactor: share accessible annual forecast chart rendering"`.

### Task 14: Retirement report models and the two distinct year axes

**Files:** Create `src/browser/{retirement-chart-model,retirement-report-model}.ts`, `src/browser/views/retirement-report.ts`, `tests/browser/retirement-report-model.test.ts`, `tests/browser/retirement-chart.test.ts`.

**Interfaces:** Produce `buildRetirementChartModel(report:RetirementReportSnapshot,selection:RetirementViewSelection):AnnualSeriesChartModel`, `buildRetirementPathChartModel(path:RetirementPath,selection:RetirementViewSelection):AnnualSeriesChartModel`, `buildRetirementReportModel(report:RetirementReportSnapshot,year:number|null):RetirementReportModel`, and `mountRetirementReport(root:HTMLElement,model:RetirementReportModel):{update(model:RetirementReportModel):void;dispose():void}`. Snapshot fields are `sourcePlan`, `definition`, `status`, optional `comparison`/`detail`, and captured `owner`; it is not ordinary `ReportSnapshot`. Model exposes `selectedYear`, `status`, `candidateRows`, `totals`, `allocation`, `issues`, `provenance`; null year yields the explicit empty model. `allocation` has `properties` entries keyed by `propertyId` with `marketValueCents`, `debtCents`, `equityCents`, `cashNeededCents`, plus stock/cash/gross-asset totals. Period amounts keep Task 9 names. Include recurring/mandatory/transition tax, spending, strategy objective and visible assumptions. Allocation shares use gross after-transition asset value including inherited cash; debt/equity and actual purchase cash are separate amounts. Use matching selected detail's `openingAllocation`; until that arrives, show allocation updating instead of the previous candidate's values.

- [ ] **Step 1: Add failing tests.** Candidate graph compares first-full-year income; calendar graph reaches 2100. Projected comparison also stops employment and uses the same gross withdrawal rule, not Overview's salary income. Main point/readout/table/allocation agree on selection. Pending/invalid retained reports say Updating/Paused and hide stale deltas; estimated source assumptions reach the point/readout. A $600k property with $480k debt is $600k gross asset/$120k equity, not $120k of gross assets. Include inherited cash, a negative reserve, a zero-stock allocation and one missing candidate without inventing/bridging values.

Negative cash is a separate unfunded gap, not a negative pie/bar slice or invented borrowing. The graphic's stated denominator includes positive gross assets/positive cash; show the signed cash gap alongside it and include it in net worth. If a required asset value is unavailable, suppress the reconciled bar while retaining independent card amounts.

```ts
it('keeps property debt separate from gross allocation value',()=>{
  // Local retirementReportFixture uses the sourced 600k/20%-down opening allocation.
  const {report,selection}=retirementReportFixture();
  const model=buildRetirementReportModel(report,selection.candidateYear!);
  expect(model.allocation.properties[0]).toMatchObject({marketValueCents:{status:'available',value:60_000_000},
    debtCents:{status:'available',value:48_000_000},equityCents:{status:'available',value:12_000_000}});
});
```
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/retirement-report-model.test.ts tests/browser/retirement-chart.test.ts`. Expected FAIL on absent models/report.
- [ ] **Step 3: Implement models and report view with Task 13 kernel.** Keep first-year recurring income separate from one-time property proceeds and mandatory excess. Selected year is view state; scrub updates cached figures without new full analysis. Use existing report focus/region reconciliation and disclosures for actual tax details. State selected strategy as **best of modeled strategies** with its full-horizon objective.

Set candidate chart title `After-tax income by retirement year` and SVG accessible name `Annual after-tax income by candidate retirement year`. Path disclosure is `Income after retiring in <year>, through 2100` with `data-retirement-path`; calendar table rows use `data-retirement-calendar-year`. These describe actual report semantics, not hidden implementation diagnostics.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/retirement-report-model.test.ts tests/browser/retirement-chart.test.ts tests/browser/overview-model.test.ts tests/browser/reporting.test.ts` and `npm run typecheck`. Expected distinct axis semantics and exact accounting columns.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: present retirement income and allocation reports"`.

### Task 15: Full-width visual portfolio GUI with independent property editors

**Files:** Create `src/browser/views/{retirement-portfolio,retirement-property-editor}.ts`, `src/browser/styles/retirement.css`, `tests/browser/retirement-portfolio.test.ts`; reuse existing `fields.ts`, numeric/date/switch controls and record IDs.

**Interfaces:** Produce `mountRetirementPortfolio(root:HTMLElement,model:RetirementReportModel,draft:RetirementDraft,actions:RetirementPortfolioActions):RetirementPortfolioView`. View exposes `update(model,draft):void`, `reveal(field:string):void`, `dispose():void`. Actions expose `edit(path:readonly(string|number)[],raw:unknown):void`, `addProperty(use:'personal'|'rental'):void`, `removeTarget(id:string):void`, `moveTarget(id:string,direction:-1|1):void`, `selectProperty(id:string):void`, `apply():void`, `discard():void`. Stable IDs own raw fields/card selection; resolve a current array path from that ID at event time, never use array position or name as identity. Ignore detached/removed-target actions.

- [ ] **Step 1: Add failing DOM tests.** Two rentals + personal home + stocks show separate dollars/shares, use, debt/paid-off state, rent/cost summaries and a remainder; costs are outside the asset bar. Select rental A, leave invalid rent `2.`, edit B's 20% down and switch back: A's raw text/focus remain, B's values are independent. Add/remove a new target without selling a source property. Existing choices expose keep/convert/sell plus per-loan payoff; show unowned/pending source status. Cash/mortgage switching restores raw percent/APR/term. Zero/100% down works; `100.01` stays editable and blocks Apply. Fixed target price stays fixed on year changes; source mortgage amounts refresh. Unknown historical facts get editable estimate/history controls with known facts preserved.

Reorder two same-name rentals with accessible Move up/down actions, retain their distinct raw drafts and financing, then deliver an event from the removed old card; it must not edit the property now at that array position.

```ts
it('retains unfinished rent on a different rental card',()=>{
  // mountPortfolioFixture mounts this view with real Task 11 draft actions and two targets.
  const {root}=mountPortfolioFixture();
  fireEvent.click(within(root).getByRole('button',{name:'Edit Rental A'}));
  fireEvent.input(within(root).getByLabelText('Monthly rent ($)'),{target:{value:'2.'}});
  fireEvent.click(within(root).getByRole('button',{name:'Edit Rental B'}));
  fireEvent.click(within(root).getByRole('button',{name:'Edit Rental A'}));
  expect(within(root).getByLabelText('Monthly rent ($)')).toHaveValue('2.');
});
```

Give each card's edit action an explicit accessible name `Edit <property name>`; editors use the existing exact field labels within the active card region.
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/retirement-portfolio.test.ts`. Expected FAIL on absent visual editor.
- [ ] **Step 3: Implement the views using existing control parsing and Task 11 transaction.** Keep the allocation summary visible, open a roomy selected-card editor, use text labels with colors and stack cards on phones. Show full price, derived down-payment dollars, mortgage principal/payment, upfront costs and cash required. Keep tax assumptions, scheduled commitments and source-reference review accessible. Permit several rental units/properties without sharing state. Render from completed reports plus raw drafts, never calculate retirement taxes in the view.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/retirement-portfolio.test.ts tests/browser/numeric-control.test.ts tests/browser/date-control.test.ts tests/browser/property-editor.test.ts` and `npm run typecheck`. Expected unchanged active DOM controls across completed previews and no lost raw inputs.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: add visual retirement property allocation editor"`.

### Task 16: Retirement destination, composition and scenario lifecycle

**Files:** Create `src/browser/views/retirement.ts`, `tests/browser/retirement-workspace.test.ts`; modify `src/browser/{workspace-route,workspace-shell,editor-view,scenario-session,scenario-app}.ts`, `src/browser/styles.css` and `tests/helpers/{workspace-ui,dom}.ts` where required.

**Interfaces:** Produce `mountRetirementWorkspace(root:HTMLElement,session:ScenarioEditorSession,ownership:RetirementBindingOwnership):{update():void;dispose():void}` using Tasks 11–15. Add `Destination='retirement'` to the existing union and an explicit shell retirement host, separate from record collections/Overview/focused editor. Add test helper `openRetirement(root:HTMLElement):HTMLElement` and `applyRetirement(root:HTMLElement):Promise<void>`; do not reuse focused-record helpers that assume ordinary `EditTarget`.

- [ ] **Step 1: Add failing integration tests.** Navigate Overview→Retirement without writing, mount main graph/rail/totals/full-width portfolio/table, inspect a year without a revision. Edit retirement, switch scenario, return and retain raw fields/selection; ordinary record/growth drafts stay independent. Apply once, verify saved definition plus unchanged ordinary financial values and matching ordinary revision metadata. Source Apply invalidates/rebases results; retirement-owned conflicts become stale. Source issue links open their original editor; retirement assumption links reveal the correct card/field. Dispose prevents detached buttons/workers publishing. Fresh/reloaded tabs still open Overview.

```ts
it('inspects a retirement year without applying inputs',()=>{
  const {root,controller}=mountWorkspace(makeRetirementPlan());
  const before=controller.getState().savedPlan;
  const retirement=openRetirement(root);
  fireEvent.change(within(retirement).getByLabelText('Chart year'),{target:{value:'2027'}});
  expect(controller.getState().savedPlan).toBe(before);
});
```
- [ ] **Step 2: Run** `npm run test:browser -- tests/browser/retirement-workspace.test.ts tests/browser/workspace-shell.test.ts`. Expected FAIL on missing destination/composition.
- [ ] **Step 3: Wire the dedicated surface and lifecycle.** Capture the existing manager owner/generations; dispose/rebind per scenario activation. Keep ordinary report/coordinator authority separate, preserve focus/scroll and header draft/save status, and import the Overview-derived retirement styles. Candidate selection must not fire an Apply or mutate applied source inputs.
- [ ] **Step 4: Run** `npm run test:browser -- tests/browser/retirement-workspace.test.ts tests/browser/workspace-shell.test.ts tests/browser/growth-overview-integration.test.ts tests/browser/scenario-review-regressions.test.ts tests/browser/editor-publication.test.ts` and `npm run typecheck`. Expected all navigation, ownership and applied-only data assertions pass.
- [ ] **Step 5: Commit** named files with `git commit -m "feat: integrate scenario retirement workspace"`.

### Task 17: End-to-end acceptance, documented assumptions and final verification

**Files:** Create `tests/e2e/{retirement-analysis,retirement-portfolio}.spec.ts`, `docs/superpowers/reviews/2026-11-01-lifelook-retirement-verification.md`; modify `tests/e2e/helpers/workspace.ts`, `README.md`, `sources/register.md` and financial reference fixtures only for independently sourced cases uncovered by acceptance.

**Interfaces:** Consume the complete UI/API. Add e2e helper `openRetirement(page:Page):Promise<Locator>` and `applyRetirement(page:Page):Promise<void>`. Fixtures use `makeRetirementPlan`/`makeRetirementDefinition`; never import personal profiles. No new runtime API.

- [ ] **Step 1: Add acceptance tests before final fixes.** One synthetic flow retains/pays off a home, converts it to rental, retains another mortgaged rental, sells a third, and buys two targets with cash/20%-down mortgage. Verify independent cards, fixed prices across years, percent entry, transaction ledger, after-tax chart/readout/table agreement and selected path ending in 2100. A second flow changes invalid raw input, switches/restores a scenario with reused IDs, rejects late results, applies current data once and round-trips applied definition through plain/workspace backups. At 320/390/768/1180/1440 pixels cover both themes, 200% text, keyboard/touch, readable axes, accessible names, reduced motion and active input retention. Include zero surplus, insufficient funding, unknown basis estimates and a nonnumeric candidate. Acceptance should fail if any integration is missing; if it already passes, record that and do not manufacture a failure.

```ts
test('keeps the retirement path inclusive of 2100',async({page})=>{
  await preloadWorkspace(page,makeRetirementPlan({startYear:2099,horizonYears:2}));
  const retirement=await openRetirement(page);
  await expect(retirement.getByRole('img',{name:'Annual after-tax income by candidate retirement year'})).toBeVisible();
  await retirement.getByLabel('Chart year',{exact:true}).selectOption('2100');
  const path=retirement.locator('details[data-retirement-path]');
  await expect(path).toBeVisible();
  if(!await path.evaluate(node=>(node as HTMLDetailsElement).open))await path.locator('summary').click();
  await expect(retirement.locator('[data-retirement-calendar-year="2100"]')).toBeVisible();
  await expect(retirement.locator('[data-retirement-calendar-year="2101"]')).toHaveCount(0);
});
```

Use the small 2099 two-candidate fixture for automated integrated arithmetic; exercise the full 40-candidate horizon in the separate responsiveness observation. Expose the calendar-year row data attribute on real report rows, and open the path disclosure before visibility assertions if collapsed.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/retirement-analysis.spec.ts tests/e2e/retirement-portfolio.spec.ts --project=chromium`. Record exact failures; repair only acceptance gaps in the task that owns the behavior, with a focused regression first.
- [ ] **Step 3: Document the delivered behavior and source assumptions.** README explains the two year axes, 2100 horizon, visual multi-property allocation, percentage down payments, payoff/equity/cash distinctions, fixed purchase prices, gross monthly draws, four-policy objective, required excess reinvestment, estimated/unsupported results and applied-only backups. Register IRS/FTB source snapshots/versions, including the explicit early-distribution SALT estimate. Record responsiveness observations for 40 candidate years to 2100 and selected-detail/cancellation behavior; do not assert a brittle millisecond limit.
- [ ] **Step 4: Run final checks:**

```bash
TZ=UTC npm run check
TZ=America/Los_Angeles npm run check
git diff --check
```

Expected: every required available check passes, legacy financial fixtures stay unchanged, no whitespace errors and only intended files changed. These are the repository's exact CI timezone runs; `check` already includes engine/browser, typecheck/build, full Chromium and targeted WebKit. Do not repeat passing suites without a new change/failure. If a required browser/platform is unavailable, state the exact limitation in the verification record; do not say it passed. Run a fresh whole-branch review before integration, checking the five Review Focus cases and the spec acceptance list.
- [ ] **Step 5: Commit** acceptance tests/docs and any verified final fixes with `git commit -m "test: verify retirement planning workflows and recovery"`. Use the finishing-branch workflow only after implementation/review/checks pass; obtain separate exact push confirmation before any push.

## Execution sequence and review gates

Tasks 1–3 establish the shared runtime and schema. Tasks 4–8 add independently testable accounting/tax capabilities. Tasks 9–10 combine verified retirement paths and policy comparison. Tasks 11–12 add authorized persistence/workers; Tasks 13–16 deliver the Overview-style charts and portfolio GUI. Task 17 validates the integrated app.

Execute in order unless a selected subagent workflow can isolate a truly independent task without editing shared state. Chart extraction (Task 13) can be prepared independently after its contracts are agreed, but must be reviewed against unchanged Overview tests before integration. No UI should present placeholder financial calculations as implemented results.

At execution start, create/confirm an isolated worktree and run baseline checks before code changes. Use TDD red/green evidence for behavioral changes, task-local commits and fresh verification before completion claims. Do not run the plan's future commands merely while reviewing this document.

## Self-review record

Author review completed against the accepted design on 2026-11-01. No product code or future test commands were executed while writing this plan.

| Spec area | Implementing tasks |
| --- | --- |
| Intent, selected approach, compatibility and saved inputs | 1, 11, 16 |
| Complete handoff, original dates, employment stop and 2100 | 2, 3, 10 |
| Multiple properties, keep/convert/sell/payoff, cash or percent-down mortgage | 4, 5, 9, 15 |
| Depreciation, loss/activity history, sale character and household tax | 4, 5, 8 |
| Brokerage/traditional/Roth access, basis, RMD and automatic strategy objective | 6, 7, 8, 9, 10 |
| Planning assumptions, availability, costs/tax charged once and funding gaps | 1, 3, 8, 9, 14 |
| Future purchases/ADUs, immutable source and separate ordinary results | 2, 3, 11, 16 |
| Overview style, two year axes and visual allocation GUI | 13, 14, 15, 16 |
| Raw drafts, save/recovery, owner generations and responsive calculation | 11, 12, 14, 15, 17 |
| Source register, independent fixtures, accessibility and exact CI checks | 5–8, 13, 17 |

Step scan: every task has a failing behavioral test/fixture, explicit run/failure, a named API implementation, passing checks and a local commit. Corrected the passive analysis versus Apply bridge, comparison/detail-worker cancellation, selected opening allocation versus December balances, signed mandatory-excess tax, disposal-year depreciation and percent/mortgage boundary assertions.

Type scan: period/transition types originate in Task 9, path/comparison in Task 10, selection/receipts in Task 11, ownership/protocol in Task 12 and chart/report/view contracts in Tasks 13–16. Later consumers use those names; no retirement result is passed through ordinary `ProjectionResult` ownership. Each Review Focus line has concrete cases in the listed owning tasks. The plan is comparable in size to the spec, with signatures/assertions rather than implementation bodies; no spec section is left without an owning task.
