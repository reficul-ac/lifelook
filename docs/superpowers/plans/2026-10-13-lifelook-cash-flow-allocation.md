# Cash Flow Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute each forecast year's original cash flow through percentage targets, annual retirement maximums, a selected excess destination and an explained cash fallback.

**Architecture:** An optional saved allocation policy supplements existing contribution rules with total account funding targets. Pure cent accounting and monthly scheduling feed a bounded annual solver that reuses existing retirement and household tax calculations, then posts only the accepted schedule. An independent policy draft drives a live SVG preview and applies the policy atomically through the workspace controller.

**Tech Stack:** TypeScript, Decimal.js, native HTML controls and SVG, Vitest, Testing Library and Playwright. Node 22; no new product dependency.

**Spec:** [Approved allocation design](../specs/2026-10-13-lifelook-cash-flow-allocation-design.md).

## Global Constraints

- Preserve document schema version 1 and storage key `lifelook.foundation.plan.v1`. Absent `cashFlowAllocation` preserves existing behavior and output shape.
- Every percentage uses the same annual cash flow after final modeled taxes and expenses and before investment transfers. Retained RSUs, appreciation and opening reserves are outside the allocation pool.
- Keep the calculation engine independent of browser, persistence and clock access; use Decimal and cumulative cent settlement.
- Count eligible existing deposits toward total account targets. Preserve their saved amounts, dates and existing intentional gap behavior.
- Funding order is existing deposits, percentages and explicit cash, annual maximums, excess destination, then cash fallback. Lower stages must not displace earlier funding.
- Support one entry per account, one explicit cash entry, and one excess destination; excess may reuse a primary account. Cash saving is an earmark of the existing reserve, never a second deposit.
- Maximum mode applies only to supported retirement types. RSUs cannot receive cash allocations. Use current legal resolvers and year rules, including shared caps, compensation, catch up facts and Roth eligibility.
- Limit the annual solve to 128 passes with repeated-state detection and a final verification pass. Never post trial deposits or tax states.
- Recalculate every forecast year. Future legal amounts retain existing projected provenance and coverage limits.
- Per `CLAUDE.md`, develop and commit on `main`; do not create or use a feature branch. Preserve the existing dirty workspace and take a baseline snapshot before product edits.
- Stage only task-owned files or hunks. For already dirty files, inspect `git add -p` selections or construct a reviewed index patch; do not use a path-only commit that includes unrelated working-tree changes. Inspect staged content before each task commit.
- No command, tool or script may push without explicit confirmation for repository `reficul-ac/lifelook`, remote `origin`, branch `main`.

## Review Focus

- An early excess deposit must not consume a later primary deposit's owner limit, joint IRA compensation or employer wages; Task 3 tests both month ordering and traditional workplace effects on an IRA.
- A one-cent budget with two 50% targets must allocate only one cent, including when one target is cash; Task 2 tests joint rounding and protected cash.
- Recovery of an independent salary or loan must not retain a policy reference to a filtered-out sponsor; Task 4 tests recovery clones under unavailable tax inputs.
- Rapid edits, year selection and an unrelated save must not let an older queued preview replace the newest draft; Task 5 tests generation and saved-input guards.
- An account with existing deposits above its percentage target must not be funded again or normalized into a misleading pie; Tasks 4 and 6 test the deviation and a legacy funding conflict.

## File Structure and Dependencies

| Task | Files and responsibility | Depends on |
| --- | --- | --- |
| 1 | `src/engine/model/plan.ts`, `src/engine/cash/allocation-types.ts`, `src/engine/projection-types.ts`, `src/engine/validation.ts`, `src/engine/index.ts`: saved contract, report types and validation. `src/browser/state.ts`: optional draft type declaration. `tests/helpers/allocations.ts`: synthetic builders. | Approved spec |
| 2 | New `src/engine/cash/allocation-funding.ts`: exact targets, liquidity ceilings and monthly scheduling. | 1 |
| 3 | New `src/engine/cash/allocation-adapter.ts`, `src/engine/cash/cash-flow-allocation.ts`, `src/engine/cash/tax-timing.ts`: legal funding stages and coupled annual solve. | 1, 2 |
| 4 | `src/engine/projection.ts`, `src/engine/reporting.ts` only if necessary, `src/engine/index.ts`: post accepted funding once and expose yearly reports. | 3 |
| 5 | `src/browser/state.ts`, new `src/browser/allocation-preview.ts`: policy drafts, atomic transactions and guarded preview scheduling. | 1, 4 |
| 6 | New `src/browser/views/cash-flow-allocation.ts`, `src/browser/issue-presentation.ts`, `src/browser/views/projection.ts`, allocation styles: pie, annual table and disclosures. | 1, 4 |
| 7 | New `src/browser/forms/cash-flow-allocation.ts`, `src/browser/forms/investments.ts`, `src/browser/main.ts`, localized feedback and styles: native editor and lifecycle. | 5, 6 |
| 8 | New `tests/e2e/cash-flow-allocation.spec.ts`, README and plan progress: acceptance, final review and required checks. | 7 |

Tasks 5 and 6 can be implemented independently after Task 4, with separate file ownership. Root coordinates shared styles and issue context changes. Read the existing uncommitted forecast files as part of the current workspace rather than replacing them with the committed versions.

### Task 1: Persisted Policy and Report Contract

**Files:** Modify `src/engine/model/plan.ts`, `src/engine/projection-types.ts`, `src/engine/validation.ts`, `src/engine/index.ts`, and type declarations only in `src/browser/state.ts`. Create `src/engine/cash/allocation-types.ts`, `tests/helpers/allocations.ts`, `tests/engine/cash-flow-allocation-validation.test.ts`; extend `tests/browser/storage.test.ts`.

**Interfaces:**

- Produce `AllocationDestination = { kind: 'cash' } | { kind: 'account'; accountId: string; sponsoringSalaryId?: string }`.
- Produce `CashFlowAllocationEntry` with `id`, `priority`, `destination`, and `amount: { kind: 'percent'; percentBps: BasisPoints } | { kind: 'max-annual' }`.
- Produce `CashFlowAllocationPolicy` with `id`, `entries: readonly CashFlowAllocationEntry[]`, `overflow: { id: string; destination: AllocationDestination }`; add optional `PlanDocument.cashFlowAllocation`.
- In `allocation-types.ts`, produce `AccountAllocationFunding` with `accountId`, `targetCents`, `existingCents`, `percentageCents`, `maximumCents`, `excessCents`, `actualCents`, `shortfallCents`, `share: Available<number>` and `reasons: readonly Issue[]`. Shares are fractions, not stored basis points.
- Produce `CashFlowAllocationYear` with `year`, `status: 'funded' | 'no-surplus' | 'funding-conflict'`, `originalCashFlowCents`, `accounts: readonly AccountAllocationFunding[]`, `explicitCashCents`, `excessOfferedCents`, `excessAcceptedCents`, `excessRetainedCents`, `retainedCashCents`, and `reasons: readonly Issue[]`. All amount fields are `Cents`. Add optional `AnnualProjection.cashFlowAllocation: Available<CashFlowAllocationYear>` without requiring it on legacy rows.
- Test builders: `makeAllocationPolicy(overrides?: Partial<CashFlowAllocationPolicy>): CashFlowAllocationPolicy` and `makeAllocationPlan(overrides?: Partial<PlanDocument>): PlanDocument`, using unique synthetic IDs, zero account growth and answered history. Use existing `makePlan` and `mustValidate`; never read the private profile as a fixture.
- Declare `CashFlowAllocationDraft` in browser state with `recordId: string`, `value: RawObject`, `baseSnapshot: string`, and optional `WorkspaceState.allocationDraft`; implement its runtime behavior in Task 5. This gives Tasks 5 and 6 a shared type before their independent changes.

- [x] **Step 1: Write failing contract and restore tests.** Include valid empty and populated policies; 0 and 10,000 basis points; negative, fractional and >10,000 values; percentage sum >10,000; duplicate nested IDs, including `constructor`; duplicate account or cash rows; cash/brokerage maximum rejection; RSU rejection; invalid and owner-mismatched sponsors; conflicting primary/excess sponsors; account and salary deletion; old backup acceptance and invalid policy restore retention. Pin nested field paths.

```ts
it('rejects percentage totals above 100%', () => {
  const doc = makeAllocationPlan({ cashFlowAllocation: makeAllocationPolicy({ entries: [
    { id: 'stocks-row', priority: 1, destination: { kind: 'account', accountId: 'brokerage' }, amount: { kind: 'percent', percentBps: 5000 } },
    { id: 'cash-row', priority: 2, destination: { kind: 'cash' }, amount: { kind: 'percent', percentBps: 5001 } },
  ] }) });
  expect(validatePlan(doc).ok).toBe(false);
});
```

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run tests/engine/cash-flow-allocation-validation.test.ts tests/browser/storage.test.ts`; expected FAIL for unsupported policy validation or missing new contract.
- [x] **Step 3: Implement the contract and validator.** Register all nested IDs, reject invalid combinations and references, and preserve the unchanged stored `ContributionAmount` union. Export browser-facing policy and report types. Implement the builders and backup assertions without adding a new storage format.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run tests/engine/cash-flow-allocation-validation.test.ts tests/engine/core.test.ts tests/browser/storage.test.ts` and `npm run typecheck`; expected all pass, including no-policy restore cases.
- [x] **Step 5: Review task-owned staging and commit.** `git diff --cached --check`; `git commit -m 'feat: define cash flow allocation policies'` after staging only this task's changes.

### Task 2: Exact Targets and Monthly Funding

**Files:** Create `src/engine/cash/allocation-funding.ts` and `tests/engine/cash-flow-allocation-funding.test.ts`.

**Interfaces:** Consume Task 1 policy types. Produce:

```ts
settleAllocationTargets(total: Cents, entries: readonly CashFlowAllocationEntry[]): readonly SettledAllocationTarget[];
allocationFundingCeilings(cashAfterExisting: readonly Cents[], explicitCash: Cents): readonly Cents[];
scheduleAllocationFunding(targets: readonly FundingTarget[], ceilings: readonly Cents[], employers: readonly EmployerFundingBudget[]): FundingSchedule;
```

`SettledAllocationTarget` has `entryId`, `targetCents`; only percentage rows appear, ordered by priority then stable ID. `FundingTarget` has `ruleId`, `stage: 'percent' | 'max' | 'overflow'`, `priority`, `requestedCents`, `allowedMonths: readonly number[]`, optional `employerKey`. `EmployerFundingBudget` has `key`, `monthlyCents`. `FundingSchedule` has `requestsByRule: ReadonlyMap<string, readonly Cents[]>` and `fundedByRule: ReadonlyMap<string, Cents>`; each monthly array has 12 entries.

- [x] **Step 1: Write failing arithmetic and scheduling tests.** Assert 50% plus 50% on 10,000,000 cents yields 5,000,000 each; 93% on 20,000,000 yields 18,600,000; two 50% rows on one cent sum to one. Include total <=0, signed monthly cash, overflow range errors, explicit cash shortfalls and annual cash ceilings.

```ts
it('protects future expenses and explicit cash', () => {
  const cash = [10000, -8000, ...Array(10).fill(0)];
  expect(allocationFundingCeilings(cash, 500)).toEqual(Array(12).fill(1500));
});
```

Also assert a flexible brokerage target can be scheduled later to leave an earlier salary window available for a retirement target, while preserving the higher stage's annual funded amount. Test shared employer monthly wages and an ended salary with later income.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project engine tests/engine/cash-flow-allocation-funding.test.ts`; expected FAIL for missing helpers or unmet accounting assertions.
- [x] **Step 3: Implement pure funding helpers.** Use cumulative Decimal settlement. Compute ceiling `max(0, min(future cumulative cash, December cumulative cash - actual explicit cash))`. For scheduling, use deterministic residual capacity routing over the twelve months so lower stages can reschedule flexible earlier deposits without reducing their annual totals. Reserve shared monthly employer budgets; do not greedily consume every early month with brokerage deposits when a later stage has a payroll deadline. Keep this module free of tax rules.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run --project engine tests/engine/cash-flow-allocation-funding.test.ts tests/engine/cash.test.ts`; expected exact cent and schedule assertions pass without changing legacy request scheduling.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: add exact allocation funding schedules'`.

### Task 3: Legal Funding Stages and Annual Tax Solve

**Files:** Create `src/engine/cash/allocation-adapter.ts`, `src/engine/cash/cash-flow-allocation.ts`, `src/engine/cash/tax-timing.ts`, `tests/engine/cash-flow-allocation-solver.test.ts`. Move the pure annual tax timing helper from `src/engine/projection.ts` and retain its public re-export.

**Interfaces:**

- `createAllocationAdapter(plan: ValidatedPlan, year: number): AllocationAdapter`, where the adapter has a validated internal `plan` and `sourceMap: ReadonlyMap<string, AllocationSource>`. `AllocationSource` has `policyId: string`, `sourceId: string`, `fieldPrefix: string`, and `destination: AllocationDestination`, identifying the entry or excess source and its path within the policy.
- `allocateAnnualTax(liabilityCents: Cents, positiveGrossCashByMonth: readonly Cents[]): readonly Cents[]` retains its existing signature and behavior in `tax-timing.ts`.
- `resolveAllocationYear(input: AllocationYearInput, resolveHousehold?: typeof resolveHouseholdYear): Available<ResolvedAllocationYear>`.
- `AllocationYearInput` has `plan: ValidatedPlan`, `cash: CashYear`, `legacyRequests: readonly ContributionRequest[]`, `property: PropertyYearFacts`, `loans: readonly LoanSchedule[]`, `opening: HouseholdTaxState`, `rules: YearRules`, and 12-element `cashIncomeByMonth`, `expensesByMonth`, `debtPaymentsByMonth`, `rsuWithholdingByMonth`, `taxWeightsByMonth` arrays of `Cents`. The year comes from `cash.year`; `cash` includes tax-relevant RSU wages.
- `ResolvedAllocationYear` has `household: HouseholdYear`, `requests: readonly ContributionRequest[]`, `report: CashFlowAllocationYear`, `incomeTaxByMonth: readonly Cents[]`, and `preTransferCashByMonth: readonly Cents[]`.

- [x] **Step 1: Write failing solver tests.** Use an explicitly synthetic $7,000 IRA capacity for the approved $100,000/$200,000 illustration; actual tax tests use existing sourced rules. Assert targets of 9,300,000/18,600,000 cents, maximum 700,000 cents each year and excess 0/700,000 cents. Add same destination aggregation; 600,000 cents of excess with 200,000 cents of capacity produces 200,000 accepted and 400,000 retained; 80% plus a synthetic 30% maximum produces only 20% maximum funding; existing 400,000 toward a 1,000,000 target tops up 600,000.

Pin January excess versus later primary capacity, traditional 401(k) excess versus protected IRA compensation, shared traditional/Roth owner limits, multiple maximum priorities, mandatory Roth catch up, employer facts by year and IRA phaseout boundaries. Set workplace coverage true in funded workplace fixtures; `makePlan` defaults it false.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project engine tests/engine/cash-flow-allocation-solver.test.ts`; expected FAIL for missing resolver or new funding behavior.
- [x] **Step 3: Implement adapter, staged funding and solve.** Remove policy IDs before validating synthetic descriptors; generate requests explicitly, never through the legacy scheduler. Reuse `resolveWorkplaceContributions`, `resolveHouseholdYear` and IRA budgets instead of copying legal formulas. Reserve existing funding and each earlier stage across the entire year and across compensation dependencies. Use Task 2 scheduling and reduce the lower stage if its final tax or legal effects displace protected funding.

Start with existing contributions only; repeat targets, eligibility, monthly timing and taxes from the identical opening state. Compare integer cash totals, requests, eligible deposits and tax totals; detect repeated nonstable signatures and stop at 128 passes. Verify the accepted result once more before returning it. A plain `HouseholdYear` can contain unavailable tax or contribution amounts: inspect those fields before numeric arithmetic. Omit unresolved excess requests from accepted taxes and put their reason in report metadata; unresolved primary inputs or nonconvergence return unavailable dependent results.

- [x] **Step 4: Verify green and failure behavior.** Run `npm exec vitest -- run --project engine tests/engine/cash-flow-allocation-solver.test.ts tests/engine/cash-flow-allocation-funding.test.ts tests/engine/tax/ira.test.ts tests/engine/tax/payroll.test.ts tests/engine/tax/comparison.test.ts`. Include traditional percentage, maximum and excess tax-feedback cases with independent expected tax arithmetic, a deliberately cycling evaluator, the 128-pass bound, overflow with missing history, unchanged opening state, and trial states never accumulated. Assert annual and monthly conservation with exact cents.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: resolve tax aware yearly allocations'`.

### Task 4: Forecast Integration and Availability

**Files:** Modify `src/engine/projection.ts`, `src/engine/index.ts`; change `src/engine/reporting.ts` only if required. Create `tests/engine/cash-flow-allocation-projection.test.ts`; extend `tests/engine/public-api.test.ts`.

**Interfaces:** Consume `resolveAllocationYear` and Task 1 reports. Keep `calculateProjection(plan: ValidatedPlan, ruleSet: RuleSet): ProjectionResult` unchanged. Attach each active policy's `cashFlowAllocation` report to its annual row after ordinary monthly summarization.

- [x] **Step 1: Write failing projection tests.** Cover two and three years with changed cash flow/rule values, account growth after deposits, one-time posting of same-account primary/excess deposits, explicit cash retention, legacy over-target deviations and legacy funding conflicts. Compare report total to cash salary + other income + rent + RSU withholding - all taxes - expenses - all debt payments; compare account and reserve movements independently.

Include personal debt payments outside property facts, noncash RSU compensation, a later unavailable tax year with earlier available results, and independent recovery of salaries whose filtered clone would otherwise retain a dangling policy sponsor. Assert no-policy projections omit the optional report and preserve `numericProjectionView` expectations.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project engine tests/engine/cash-flow-allocation-projection.test.ts`; expected FAIL for absent allocation reports or unchanged deposits.
- [x] **Step 3: Integrate only accepted results.** Collect all twelve monthly cash inputs, including unlinked debt schedules, and reuse current positive cash income plus taxable RSU income weights. Post the accepted combined requests and closing tax state once. Make derived requests available to account sums and contribution schedule reporting, without inserting them into saved inputs. Strip policies from recovery-only derived documents that filter referenced records. Use existing interrupted tax state and independent schedule recovery for failed dependent calculations; never post speculative trial values.
- [x] **Step 3a: Resolve measured preview latency.** A 30-year ordinary forecast measured about 2.08 seconds and a mixed-employer catch-up forecast about 10.42 seconds. Profile repeated authoritative search evaluations, add bounded year-local reuse without caching explicit outer or final verification calls, and compare complete outputs with the captured synthetic baselines. Preserve immutable trials, exact cents, legal chronology, availability and provenance. Measure both scenarios again; resolve any remaining interactive-preview latency through a focused correction before wiring slider calculations.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run tests/engine/cash-flow-allocation-projection.test.ts tests/engine/public-api.test.ts tests/engine/projection.test.ts tests/engine/reporting.test.ts tests/engine/rsu-projection.test.ts tests/engine/projection-summary.test.ts`; expected conservation and legacy numeric fixtures pass. Run `npm run test:engine` and `npm run typecheck`.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: apply allocation policies to forecasts'`.

### Task 5: Atomic Policy Drafts and Guarded Preview

**Files:** Modify `src/browser/state.ts`; create `src/browser/allocation-preview.ts`, `src/browser/allocation-preview-worker.ts`, `tests/browser/cash-flow-allocation-state.test.ts`, `tests/browser/allocation-preview.test.ts`.

**Interfaces:**

- Consume Task 1's `CashFlowAllocationDraft` and optional `WorkspaceState.allocationDraft`, separately from record `drafts` and `EditableSection`.
- Add controller methods `getAllocationDraft(): CashFlowAllocationDraft`, `editAllocationDraft(draft: CashFlowAllocationDraft): void`, `discardAllocationDraft(): void`, `previewAllocation(): CashFlowAllocationPreview`, `applyAllocation(): SaveRecordResult`.
- `CashFlowAllocationPreview` is `{ status: 'calculated'; projection: ProjectionResult; inputRevision: number }` or `{ status: 'invalid' | 'failed'; issues: readonly Issue[]; inputRevision: number }`.
- `createAllocationPreviewScheduler(controller: WorkspaceController, publish: (preview: CashFlowAllocationPreview) => void): AllocationPreviewScheduler`, with `request(): void`, `invalidate(): void`, `dispose(): void`.

- [x] **Step 1: Write failing state and preview tests.** Use `createWorkspace`, memory storage and existing draft decoders. Assert a getter's inert empty default does not activate a policy or change revision; IDs remain stable and avoid saved and open draft IDs. Apply updates revision once, calculates before publishing and writes once; invalid policy or unexpected throw retains inputs/projection/draft/bytes. Include exportable storage failure, unrelated drafts, policy-only staleness, permitted unrelated saves, link revalidation, discard and restore.

For queued preview tests, edit 10% then 50%, select a later year and save an unrelated income input before callbacks run. Assert only the latest draft against latest applied inputs is published, and Apply/Discard/restore/dispose invalidate pending work. A preview never replaces applied `projection`.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-state.test.ts tests/browser/allocation-preview.test.ts`; expected FAIL for absent APIs.
- [x] **Step 3: Implement the independent draft transaction.** Reuse `toDraftValue`, `fromDraftValue`, `publish` and operation notifications. Keep the first policy snapshot, use the latest saved plan on Apply, and clear only allocation draft state after accepted publication. Use collision-safe IDs and include allocation drafts in ID scans. Cache inert defaults without treating rendering as an edit. Coalesce previews per animation frame with a generation token and saved-plan identity; accept only matching results and cancel lifecycle callbacks on disposal.
- [x] **Step 3a: Keep queued previews off the main thread.** The reviewed engine optimization retains about 0.97 seconds ordinary / 2.59 seconds catch-up-heavy cost for 30-year forecasts. Centralize pure candidate preparation so the synchronous controller preview and background scheduler use the same latest validated policy and exact workspace rule set. Use a native module worker for queued calculation where supported, without changing synchronous Apply semantics or publishing previews into saved state. Guard and cancel stale generations; keep at most the latest queued work and terminate worker work on lifecycle invalidation/disposal. Handle worker errors explicitly and use the synchronous path only where workers are unavailable. Test controlled delayed/out-of-order replies, latest saved inputs, restored plans, failure and disposal; verify real Chromium preview calculation uses the worker and inputs remain interactive. Add no dependency.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-state.test.ts tests/browser/allocation-preview.test.ts tests/browser/state.test.ts tests/browser/storage.test.ts tests/browser/review-transactions.test.ts`; expected atomic and no-policy behavior pass. Run `npm run typecheck`.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: add allocation drafts and previews'`.

### Task 6: Pie Chart and Annual Allocation Reports

**Files:** Create `src/browser/views/cash-flow-allocation.ts` and `tests/browser/cash-flow-allocation-reporting.test.ts`; modify `src/browser/views/projection.ts`, `src/browser/issue-presentation.ts` and narrowly scoped `src/browser/styles.css` rules. Also narrowly correct `src/engine/cash/cash-flow-allocation.ts` and its solver tests for the discovered partial-funding status mismatch.

**Interfaces:** `renderAllocationPie(root: HTMLElement, report: Available<CashFlowAllocationYear>, plan: PlanDocument, context: IssueViewContext): void`; `renderAllocationYears(root: HTMLElement, years: readonly AnnualProjection[], context: IssueViewContext): void`. Extend `IssueViewContext.readState` to include optional allocation draft access while keeping existing presentation fixtures valid.

- [x] **Step 1: Write failing report and review tests.** Use `mountPresentation`, synthetic report data and captured review targets. Verify one slice per account plus cash, amount-derived angles, readable actual shares/component totals, one-cent rounding, and text states for no surplus, conflict or unavailable results. Assert legacy over-target funding shows the actual amount without a duplicate top up or normalized conflict chart.

For fallback, assert partial acceptance shows both accepted excess and retained cash; confirmed caps, timing and missing information have distinct note text. Hover/focus previews, click/Enter/Space and tap-compatible activation, Escape dismissal and exact owner/sponsor review targets must use existing disclosure behavior. Deliberate cash has no failure marker.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-reporting.test.ts`; expected FAIL for missing renderers or policy review targets.
- [x] **Step 3: Implement shared SVG and table views.** Reuse `appendAmount`, `formatCents`, `renderIssueDetails` and `context.disclosures.createTrigger`; add no dependency. Render only when allocation reports exist. Map policy/entry/excess IDs to readable labels and current draft field indexes; route filer eligibility fields to Household and account/sponsor issues to their actual records. Do not change the annual financial overview's existing column order.
- [x] **Step 3a: Correct upstream partial-funding classification.** Spec funding conflicts occur when eligible existing funding alone exceeds the positive annual pool. The current producer also classifies any known primary/explicit-cash shortfall as a conflict, suppressing an honest reconciled pie. Restrict `funding-conflict` to the legacy-over-budget condition; known partial percentage/maximum/cash funding retains its exact target, actual amount, shortfall and reasons within a funded report. Add meaningful RED/GREEN solver status regressions for the approved 80% plus synthetic 30% maximum receiving20%, a capped percentage, explicit cash shortfall, and true existing-over-budget conflict; report/UI tests show actual slices for known partial funding. Preserve no-surplus/unavailable states and all monetary values.
- [x] **Step 3b: Preserve cash percentage priority and explain its shortfall.** Include explicit cash in the same priority/ID ordered percentage stage as account rows. Fund earlier percentages first; when reaching cash, reserve only its settled target up to the annual remainder after eligible existing and already funded earlier deposits. Protect that actual reservation from all later percentages, maximums and excess without reducing earlier annual amounts. Add `explicitCashTargetCents` and `explicitCashShortfallCents` to the ephemeral report contract, preserve `explicitCashCents` as actual, and emit an accurate source-linked cash-shortfall reason. Reports show the deliberate cash target, actual earmark, shortfall and cause distinctly from total retained cash/failed excess. Real-rule regression: original5,136,800c, preserved legacy4,104,000c, two50%targets2,568,400c each; account-first funds1,032,800c brokerage/0cash, cash-first funds0brokerage/1,032,800c cash. Assert exact monthly/annual conservation, unchanged saved schedules, tax-feedback/earlier eligibility and cash protection against later maximum/excess. Add renderer regression for5,000 requested/2,800 actual/2,200 shortfall and current cash-source review target.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-reporting.test.ts tests/browser/disclosures.test.ts tests/browser/issue-presentation.test.ts tests/browser/reporting.test.ts tests/browser/forecast-summary.test.ts` and `npm run typecheck`; expected independent and policy-free views remain valid.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: explain yearly allocation funding'`.

### Task 7: Native Allocation Editor and Lifecycle

**Files:** Create `src/browser/forms/cash-flow-allocation.ts`, `tests/browser/cash-flow-allocation-forms.test.ts`; modify `src/browser/forms/investments.ts`, `src/browser/main.ts`, localized feedback and scoped styles.

**Interfaces:** `mountCashFlowAllocationEditor(root: HTMLElement, controller: WorkspaceController, context: IssueViewContext): { dispose(): void }`. Consume Task 5 controller/scheduler and Task 6 pie renderer. Keep the allocation host stable across ordinary record form rerenders; unmount disposes its subscription and preview scheduler.

- [x] **Step 1: Write failing interaction tests.** Use `mountWorkspace`, `setField`, `fireEvent` and `within`. Verify Add allocation, destination and sponsor selection, Remove, priority controls, percentage input/slider synchronization and retirement-only maximum mode. Assert labels Allocation year, Excess allocation account, Apply allocation and Discard allocation edits. Test year selection changes the preview without changing saved rule scope or persisting computed maximum percentages.

Assert raw invalid text survives, slider focus/cursor remain stable, original total is shared, actual capped shares differ visibly from requested shares, dollars/percentage remaining stay visible before excess routing, and last valid preview is labeled stale after invalid edits. Include latest saved account types and salary links, error reveal and review navigation. A change to forecast start or horizon clamps the selected preview year into the new range without saving or discarding the policy draft.

- [x] **Step 2: Verify red.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-forms.test.ts`; expected FAIL for absent controls or interactions.
- [x] **Step 3: Implement the editor and host.** Pair a native 0–100 range slider with an exact two-decimal input; both write basis-point draft values. Preserve the draft's original snapshot and stable IDs. Show automatic maximum amount/share and existing deposits included in targets. Build an allocation-specific feedback path; do not mark its form `data-editable-section` and cast it into `EditableSection`. Use existing reveal/disclosure helpers with policy `data-record-id` and precise nested `data-field` paths. Update main's unsaved draft status and operation announcements without publishing previews.
- [x] **Step 4: Verify green.** Run `npm exec vitest -- run --project browser tests/browser/cash-flow-allocation-forms.test.ts tests/browser/cash-flow-allocation-state.test.ts tests/browser/cash-flow-allocation-reporting.test.ts tests/browser/financial-forms.test.ts tests/browser/review-feedback.test.ts`, then `npm run test:browser` and `npm run build`; expected preserved native form behavior and accessible allocation controls.
- [x] **Step 5: Review staging and commit.** `git diff --cached --check`; `git commit -m 'feat: add contribution allocation editor'`.

### Task 8: Acceptance and Delivery

**Files:** Create `tests/e2e/cash-flow-allocation.spec.ts`; modify README, scoped responsive styles, allocation solver diagnostics and covering tests, existing RSU acceptance selectors, and this plan's progress checkboxes.

**Interfaces:** Consume only public `calculateProjection`, policy contracts and browser controls. Reuse synthetic builders; existing local Playwright helpers are not exported, so define small local preload/backup helpers in this spec.

- [x] **Step 1: Write acceptance cases.** Preload a synthetic two-year plan through `lifelook.foundation.plan.v1`. Apply stocks at 93% with a maximum IRA and choose a brokerage excess account; verify the maximum's share changes with cash flow and excess is transferred once. Switch excess to a capped workplace account and verify cash retention plus the year-specific disclosure. Cover partial capacity, protected cash, shared account destination, keyboard controls, a mobile viewport and export/restore of applied rules without draft/report data. Check balances and displayed denominators against independent engine assertions from Tasks 2–4.
- [x] **Step 2: Run targeted acceptance.** `npm exec playwright -- test tests/e2e/cash-flow-allocation.spec.ts`; expected new Chromium flows pass. If browser installation is missing, use the repository's documented Chromium installation; resolve real failures with targeted regression tests.
- [x] **Step 2a: Fix verified mobile sizing.** The Financial inputs grid item must shrink within the 390px viewport while allocation tables scroll within their own container. Correct its minimum sizing and retain native controls and accessible disclosure bounds; rerun the actual touch/viewport regression. Preserve unrelated initial style hunks when staging.
- [x] **Step 2b: Report the binding excess restriction.** Emit the synthetic compensation/cash timing reason only when selected accepted funding reaches the initial scheduler ceiling and that ceiling is below the desired amount. Known annual shared-cap examples accepting $500/zero instead of much larger schedulable amounts must retain the authoritative limit explanation. Add engine report assertions for both cap variants and preserve a genuine timing-limited explanation; do not alter monetary search or accepted funding. The broader trial-source ownership finding remains for final review.
- [x] **Step 2c: Keep RSU acceptance tied to the created account.** Derive the actual account ID from the native saved account form for annual/monthly value selectors, rather than assuming a private sequence suffix. Preserve all existing independent RSU balances, invalid-input, export/restore and reload assertions. Run the focused RSU flow and the required complete check again; retain the initial failure evidence.
- [x] **Step 3: Document usage and conduct final review.** Explain percentage targets, included existing deposits, yearly maximum recalculation, excess selection and fallback notes in README. Have a fresh reviewer inspect conservation, stage reservations, trial-state isolation, availability, native control lifecycle and save/restore, using the selected execution workflow. Resolve substantive findings and run the owning checks again.
- [x] **Step 4: Run required final checks.** `npm run check`; `TZ=America/Los_Angeles npm run test:engine`; `git diff --check`. Expected typecheck, all engine/browser suites, production build and Chromium flows pass in the current workspace. Report any unrelated baseline failure separately; do not invent a clean baseline or mark unchecked tasks complete.
- [x] **Step 5: Record results and commit only verified task changes.** Mark finished checkboxes, record actual command results, inspect staged hunks and commit with `git commit -m 'test: verify allocation policies across years'`. Report the implemented behavior, evidence and any limitation. Do not push without exact user confirmation.

## Execution Handoff

Review this plan before product implementation. Subagent-driven execution is recommended because the eight tasks cross financial eligibility, tax feedback and persistence, and independent task reviews can catch mistakes before later tasks build on them. Native execution is available for lower orchestration cost, with one independent review at the end. Implementation begins after plan review and execution-method selection.

Final verification (2026-10-13): the complete feature review and its single fix wave are approved through `1db6013`. All four final findings are addressed. `npm run check` passed typecheck, 998 unit tests across 49 files, production build and 25 Chromium flows; the separate `TZ=America/Los_Angeles npm run test:engine` passed 758 tests across 29 files. Eight targeted allocation Chromium flows and 220 covering tests passed. Desktop/mobile/touch controls, fallback disclosures and applied-only backup/restore were checked. All 19 pre-existing dirty paths remain preserved outside feature commits. Work is committed locally on `main`; no push was performed. Synchronous explicit operations and existing rule-pack coverage/provenance remain the reviewed compatibility boundaries.
