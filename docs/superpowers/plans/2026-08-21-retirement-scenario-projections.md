# Retirement Scenario Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two Retirement overview stories into persistent scenario selectors backed by one multi-year, account-aware projection that reuses Plan and home data.

**Architecture:** Keep `ProjectionEngine` responsible for monthly Plan/property evolution and add focused retirement modules for account ordering, withdrawal tax treatment, home disposition, and annual roll-forward. `calculateRetirementProjection` returns both scenario summaries and annual rows; React renders that result and saves only retirement preferences while home edits update their existing asset or scenario record.

**Tech Stack:** React 18, TypeScript 5.7, Vitest, Testing Library, Tauri 2, Rust, SQLite

**Spec:** `docs/superpowers/specs/2026-08-21-retirement-scenario-projections-design.md`

## Global Constraints

- Retirement years default to 30 and accept integer values from 1 through 60.
- Home sales use the exact projected home value; no sale-price haircut or premium is allowed.
- The active Plan remains authoritative for recurring activity, tax assumptions, appreciation, and housing costs.
- Current and planned homes retain one source of truth; Retirement-specific home overrides are forbidden.
- Surplus and net sale proceeds enter one selected existing taxable investment account; shortfalls draw there first.
- Default account ordering is age-aware, uses age 59½ as the general penalty boundary, and keeps Roth assets last.
- Special statutory early-distribution exceptions, Monte Carlo analysis, RMDs, Social Security optimization, and Roth conversions remain out of scope.
- Both overview values and table rows must come from `calculateRetirementProjection`; React must not reproduce financial formulas.
- Do not push any branch without explicit user confirmation for the exact repository, remote, and branch.

## File Structure

- `src/domain/retirementSettings.ts`: persisted retirement preference types, defaults, and normalization.
- `src/domain/retirementWithdrawals.ts`: pure age calculation, default ordering, account tax classification, and ordered draws.
- `src/domain/retirementProjection.ts`: public multi-year retirement calculation and result types.
- `src/domain/retirementSnapshot.ts`: retained home-resolution and point-in-time sale helpers consumed by the projection.
- `src/domain/projection.ts`: only narrowly extended where retirement needs a longer horizon or a normalized monthly baseline.
- `src/RetirementHomeSaleDetails.tsx`: focused current/planned-home assumption editor.
- `src/RetirementProjectionTable.tsx`: focused annual result and warning presentation.
- `src/RetirementView.tsx`: settings autosave, scenario selection, orchestration, and overview cards.
- `src-tauri/src/lib.rs`: SQLite migration and retirement-setting serialization/validation.
- `src/styles.css`: responsive card-selection, controls, sale details, and table styles.

---

### Task 1: Extend and Normalize Retirement Settings

**Files:**
- Modify: `src/domain/retirementSettings.ts`
- Modify: `src/domain/index.ts`
- Create: `src/domain/retirementSettings.test.ts`

**Interfaces:**
- Produces: `RetirementScenario = "keep-homes" | "sell-all-homes"`.
- Produces: `RetirementSettingsRecord` fields `horizonYears`, `taxableDestinationAccountId`, `withdrawalAccountOrder`, and `selectedScenario`.
- Produces: `NormalizedRetirementSettings = Omit<RetirementSettingsRecord, "householdId">`.
- Produces: `normalizeRetirementSettings(record, accounts, now?)` with safe migration defaults.

- [ ] **Step 1: Write failing normalization tests**

Add tests that call normalization with no record, a legacy-shaped record, one eligible taxable account, and several accounts:

```ts
expect(normalizeRetirementSettings(null, [taxable])).toMatchObject({
  withdrawalRateBps: 300,
  horizonYears: 30,
  taxableDestinationAccountId: "brokerage",
  withdrawalAccountOrder: [],
  selectedScenario: "keep-homes",
});
expect(normalizeRetirementSettings(legacy as RetirementSettingsRecord, [taxable, taxable2]))
  .toMatchObject({ horizonYears: 30, taxableDestinationAccountId: null });
expect(normalizeRetirementSettings({ ...record, horizonYears: 61 }, [taxable]))
  .toMatchObject({ horizonYears: 30 });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/domain/retirementSettings.test.ts`

Expected: FAIL because the settings fields and account-aware normalization do not exist.

- [ ] **Step 3: Add the exact settings model**

Implement and export:

```ts
export type RetirementScenario = "keep-homes" | "sell-all-homes";

export interface RetirementSettingsRecord {
  householdId: string;
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  horizonYears: number;
  taxableDestinationAccountId: string | null;
  withdrawalAccountOrder: readonly string[];
  selectedScenario: RetirementScenario;
  revision: number;
}

export type NormalizedRetirementSettings = Omit<RetirementSettingsRecord, "householdId">;

export type RetirementSettingsInput = Omit<RetirementSettingsRecord, "householdId" | "revision"> & {
  expectedRevision: number;
};

export const isTaxableInvestmentAccount = (account: Account) =>
  account.kind === "investment" &&
  (account.subtype == null || account.subtype === "taxable-brokerage");
```

Update the signature to `normalizeRetirementSettings(value: unknown, accounts: readonly Account[] = [], now = new Date()): NormalizedRetirementSettings`. Preserve valid saved values, select the sole taxable account when no valid selection exists, use an empty override for automatic ordering, filter unknown/duplicate account IDs, and default an invalid selected scenario to `keep-homes`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- --run src/domain/retirementSettings.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/retirementSettings.ts src/domain/retirementSettings.test.ts src/domain/index.ts
git commit -m "feat: extend retirement projection settings"
```

---

### Task 2: Persist New Retirement Preferences in SQLite

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the camelCase TypeScript fields from Task 1 through Tauri serialization.
- Produces: schema migration 23 columns `horizon_years`, `taxable_destination_account_id`, `withdrawal_account_order_json`, and `selected_scenario`.
- Produces: Rust `RetirementPlanRecord` and `RetirementPlanInput` with matching fields.

- [ ] **Step 1: Write failing Rust migration and round-trip assertions**

Extend `retirement_plan_round_trips_and_enforces_revisions` and add `version_23_adds_retirement_projection_preferences` with assertions equivalent to:

```rust
assert_eq!(loaded.horizon_years, 30);
assert_eq!(loaded.taxable_destination_account_id, None);
assert_eq!(loaded.withdrawal_account_order, Vec::<String>::new());
assert_eq!(loaded.selected_scenario, "keep-homes");

let saved = store_retirement_plan(&mut c, RetirementPlanInput {
    retirement_month: "2042-09".into(),
    withdrawal_rate_bps: 350,
    horizon_years: 45,
    taxable_destination_account_id: Some("brokerage".into()),
    withdrawal_account_order: vec!["brokerage".into(), "401k".into()],
    selected_scenario: "sell-all-homes".into(),
    expected_revision: 1,
}).unwrap();
assert_eq!(saved.horizon_years, 45);
```

Also assert rejection of horizon `0`, horizon `61`, an unknown destination account, duplicate/unknown withdrawal IDs, and an invalid scenario string.

- [ ] **Step 2: Run the focused Rust test and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml retirement_plan -- --nocapture`

Expected: FAIL because Rust structs and schema lack the new fields.

- [ ] **Step 3: Add migration 23 and serialization**

Add idempotent columns with these defaults and constraints:

```sql
ALTER TABLE retirement_plans ADD COLUMN horizon_years INTEGER NOT NULL DEFAULT 30 CHECK(horizon_years BETWEEN 1 AND 60);
ALTER TABLE retirement_plans ADD COLUMN taxable_destination_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE retirement_plans ADD COLUMN withdrawal_account_order_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE retirement_plans ADD COLUMN selected_scenario TEXT NOT NULL DEFAULT 'keep-homes' CHECK(selected_scenario IN ('keep-homes','sell-all-homes'));
```

Deserialize `withdrawal_account_order_json` into `Vec<String>`. Validate that every ID belongs to an account in the household, IDs are unique, the destination is an `investment` account with null or `taxable-brokerage` subtype, and the destination appears first only when the explicit override says so—not by mutation in persistence.

- [ ] **Step 4: Update bootstrap and upsert queries**

Select all new columns in `bootstrap`, serialize them in `RetirementPlanRecord`, and update `store_retirement_plan` to insert/update every preference atomically while retaining optimistic revision checks.

- [ ] **Step 5: Run Rust formatting and tests**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml retirement_plan -- --nocapture`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: persist retirement projection preferences"
```

---

### Task 3: Implement Age-Aware Withdrawal Ordering and Draws

**Files:**
- Create: `src/domain/retirementWithdrawals.ts`
- Create: `src/domain/retirementWithdrawals.test.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Produces: `ageOnDate(birthDate: string | undefined, date: string): number | null` for display.
- Produces: `isAtLeastAge59AndHalf(birthDate: string | undefined, date: string): boolean` for penalty classification.
- Produces: `defaultRetirementAccountOrder(snapshot, date): readonly string[]`.
- Produces: `resolveRetirementAccountOrder(snapshot, date, override): readonly string[]`.
- Produces: `drawRetirementFunds(input): RetirementDrawResult`.

- [ ] **Step 1: Write failing ordering tests**

Cover exact birthday handling, missing owner birth dates, taxable-first behavior below 59½, pre-tax eligibility at 59½, Roth-last behavior, stable account order, and override completion:

```ts
expect(ageOnDate("1970-07-02", "2030-01-01")).toBe(59);
expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-01")).toBe(false);
expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-02")).toBe(true);
expect(defaultRetirementAccountOrder(snapshot, "2029-01-01")).toEqual([
  "brokerage", "checking", "401k", "roth",
]);
expect(resolveRetirementAccountOrder(snapshot, "2029-01-01", ["401k"])).toEqual([
  "401k", "brokerage", "checking", "roth",
]);
```

Use an owner born `1970-07-02` and assert the pre-tax account remains penalty-sensitive on `2030-01-01` and becomes eligible on `2030-01-02`.

- [ ] **Step 2: Run ordering tests and verify failure**

Run: `npm test -- --run src/domain/retirementWithdrawals.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure ordering**

Classify accounts into ordered buckets:

```ts
type WithdrawalClass =
  | "taxable"
  | "cash"
  | "eligible-pre-tax"
  | "penalty-pre-tax"
  | "roth";
```

Use account subtype and owner age. Unknown owner age keeps retirement accounts in the penalty-sensitive bucket. Preserve source-array order within a bucket. Apply unique valid override IDs first, then append all omitted accounts in automatic order.

- [ ] **Step 4: Write failing draw and tax-character tests**

Assert partial depletion, fallback across accounts, taxable gain based on proportional cost basis, ordinary income for pre-tax distributions, Roth contribution-basis-first draws, 10% early penalty, and uncovered amounts:

```ts
expect(drawRetirementFunds({
  amountCents: 150_000,
  date: "2030-01-01",
  order: ["brokerage", "401k"],
  accounts,
  balances: { brokerage: 100_000, "401k": 100_000 },
})).toMatchObject({
  fundedCents: 150_000,
  unfundedCents: 0,
  ordinaryIncomeCents: 50_000,
  earlyPenaltyCents: 5_000,
});
```

- [ ] **Step 5: Implement `drawRetirementFunds`**

Use immutable returned balances and this result contract:

```ts
export interface RetirementDrawSource {
  accountId: string;
  amountCents: Cents;
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
}

export interface RetirementDrawResult {
  fundedCents: Cents;
  unfundedCents: Cents;
  balances: Readonly<Record<string, Cents>>;
  taxableBasis: Readonly<Record<string, Cents>>;
  rothContributionBasis: Readonly<Record<string, Cents>>;
  sources: readonly RetirementDrawSource[];
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
}
```

For taxable accounts, reduce cost basis proportionally to balance sold. For Roth accounts, reduce contribution basis before treating remaining distributions as taxable. Return warnings to the projection layer through source facts rather than generating UI strings here.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- --run src/domain/retirementWithdrawals.test.ts && npm run build`

Expected: PASS.

```bash
git add src/domain/retirementWithdrawals.ts src/domain/retirementWithdrawals.test.ts src/domain/index.ts
git commit -m "feat: add age-aware retirement withdrawals"
```

---

### Task 4: Add the Multi-Year Retirement Projection Boundary

**Files:**
- Create: `src/domain/retirementProjection.ts`
- Create: `src/domain/retirementProjection.test.ts`
- Modify: `src/domain/retirementSnapshot.ts`
- Modify: `src/domain/projection.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes: `buildRetirementCutoff`, `calculateRetirementSnapshot`, `ProjectionEngine.calculate`, and Task 3 withdrawal functions.
- Produces: `calculateRetirementProjection(input): RetirementProjectionResult`.
- Produces: exact result types used by Tasks 6 and 7.

- [ ] **Step 1: Write failing result-shape and horizon tests**

Create fixtures with a 12-month Plan horizon and request a 30-year retirement projection. Assert two summaries, 30 complete annual rows per available scenario, exact first/last years, and no mutation of the supplied scenario:

```ts
const result = calculateRetirementProjection({
  snapshot,
  scenario,
  asOfDate: "2026-01-15",
  settings,
});
expect(result.keepHomes.years).toHaveLength(30);
expect(result.keepHomes.years[0].year).toBe(2042);
expect(result.keepHomes.years.at(-1)?.year).toBe(2071);
expect(JSON.stringify(scenario)).toBe(before);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/domain/retirementProjection.test.ts`

Expected: FAIL because `calculateRetirementProjection` does not exist.

- [ ] **Step 3: Define the public calculation contract**

Implement these stable interfaces:

```ts
export interface RetirementProjectionInput {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  asOfDate: string;
  settings: NormalizedRetirementSettings;
}

export interface RetirementProjectionWarning {
  code: "missing-destination" | "missing-home-data" | "early-withdrawal" |
    "account-depleted" | "unfunded-spending" | "activity-ended" | "calculation-error";
  year?: number;
  entityId?: string;
  message: string;
}

export interface RetirementProjectionYear {
  year: number;
  ages: readonly { personId: string; name: string; age: number | null }[];
  startingPortfolioCents: Cents;
  withdrawalTargetCents: Cents;
  withdrawalFundedCents: Cents;
  otherPreTaxIncomeCents: Cents;
  rentalIncomeCents: Cents;
  estimatedTaxCents: Cents;
  earlyPenaltyCents: Cents;
  afterTaxIncomeCents: Cents;
  planExpenseCents: Cents;
  housingExpenseCents: Cents;
  surplusCents: Cents;
  shortfallCents: Cents;
  destinationBalanceCents: Cents;
  endingNetWorthCents: Cents;
  endingBalances: {
    accounts: Readonly<Record<string, Cents>>;
    assets: Readonly<Record<string, Cents>>;
    liabilities: Readonly<Record<string, Cents>>;
  };
  housing: {
    principalCents: Cents;
    interestCents: Cents;
    propertyTaxCents: Cents;
    insuranceCents: Cents;
    hoaCents: Cents;
    maintenanceCents: Cents;
  };
  homeSale?: {
    grossSaleValueCents: Cents;
    sellingCostsCents: Cents;
    mortgagePayoffCents: Cents;
    incrementalSaleTaxCents: Cents;
    netProceedsCents: Cents;
  };
  withdrawalSources: readonly RetirementDrawSource[];
  warnings: readonly RetirementProjectionWarning[];
}

export interface AvailableRetirementScenarioProjection<TSummary> {
  available: true;
  summary: TSummary;
  years: readonly RetirementProjectionYear[];
}

export interface UnavailableRetirementScenarioProjection {
  available: false;
  issues: readonly RetirementMissingData[];
  warnings: readonly RetirementProjectionWarning[];
}

export interface RetirementProjectionResult {
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  netWorthCents: Cents;
  keepHomes: AvailableRetirementScenarioProjection<RetirementSnapshotResult["keepHomes"]>;
  sellHomes: AvailableRetirementScenarioProjection<Extract<SellHomesResult, { available: true }>> |
    UnavailableRetirementScenarioProjection;
  effectiveWithdrawalOrder: readonly string[];
  warnings: readonly RetirementProjectionWarning[];
}
```

If the union intersection becomes awkward, define separate named keep/sell available types while preserving the public field names above.

- [ ] **Step 4: Extend Plan calculation only at the narrow seam**

Add a pure `extendScenarioHorizon(scenario, retirementMonth, horizonYears): Scenario` helper in `retirementProjection.ts`. It clones the active scenario and sets a horizon starting from the existing scenario start through the final retirement month, capped only by the validated 60-year retirement setting. Do not alter recurring end dates or event dates.

Use `ProjectionEngine.calculate` with `stopEmploymentMonth: settings.retirementMonth`. Add exported monthly balance/cash-flow data to existing result types only if the retirement layer cannot derive it from current `MonthlyProjection` fields. Do not add retirement branching inside the Plan loop.

- [ ] **Step 5: Write failing keep-home cash-flow tests**

Cover fixed annual withdrawal recalculation, account returns, rental revenue, recurring Plan expenses, property tax, insurance, HOA, maintenance, mortgage principal/interest, mortgage balance reduction, surplus deposit, shortfall draw, forced fallback, and net-worth reconciliation.

Use explicit assertions such as:

```ts
expect(year.withdrawalTargetCents).toBe(Math.round(year.startingPortfolioCents * 300 / 10_000));
expect(year.housingExpenseCents).toBe(
  property.principalCents + property.interestCents + property.propertyTaxCents +
  property.insuranceCents + property.hoaCents + property.maintenanceCents
);
expect(year.endingNetWorthCents).toBe(
  Object.values(year.endingBalances.accounts).reduce((sum, value) => sum + value, 0) +
  Object.values(year.endingBalances.assets).reduce((sum, value) => sum + value, 0) -
  Object.values(year.endingBalances.liabilities).reduce((sum, value) => sum + value, 0)
);
```

- [ ] **Step 6: Implement keep-home annual roll-forward**

Seed year one from `buildRetirementCutoff`. For each year, use monthly Plan deltas for outside income, expenses, returns, home appreciation, rent, and mortgage activity. Calculate the withdrawal target from starting non-home eligible portfolio, draw it through Task 3, estimate taxes from actual tax character with existing tax rule packs, then deposit surplus or fund shortfall according to the spec. Keep home equity outside eligible withdrawal capital.

Store internal ending account/asset/liability maps in a private year-state type so every public number is derived from one state transition.

- [ ] **Step 7: Write failing sell-home tests**

Assert simultaneous exact-value sales in the retirement month, selling costs, mortgage payoff, incremental sale tax, proceeds deposited to the chosen taxable account, and zero subsequent home asset, mortgage, rent, appreciation, or housing expense values. Assert incomplete sale data makes Sell unavailable without affecting Keep.

- [ ] **Step 8: Implement sell-home roll-forward**

Refactor `retirementSnapshot.ts` to export a normalized resolved-home/sale helper rather than duplicating its rules. Apply `calculateIncrementalHomeSaleTax` once to all retirement-month sales, remove sold asset and linked liability balances, and seed net proceeds into the destination account before subsequent returns and withdrawals.

- [ ] **Step 9: Add warning and ended-activity tests**

Assert warnings for missing destination, early withdrawal, depleted accounts, unfunded spending, explicit recurring-entry end dates, and year-specific calculation errors. Verify failure never reuses a prior scenario result.

- [ ] **Step 10: Run domain suites and commit**

Run: `npm test -- --run src/domain/retirementProjection.test.ts src/domain/retirementSnapshot.test.ts src/domain/projection.test.ts src/domain/tax.test.ts src/domain/homeSaleTax.test.ts && npm run build`

Expected: PASS.

```bash
git add src/domain/retirementProjection.ts src/domain/retirementProjection.test.ts src/domain/retirementSnapshot.ts src/domain/projection.ts src/domain/types.ts src/domain/index.ts
git commit -m "feat: calculate annual retirement scenarios"
```

---

### Task 5: Add Shared-Source Home Sale Editing

**Files:**
- Create: `src/RetirementHomeSaleDetails.tsx`
- Create: `src/RetirementHomeSaleDetails.test.tsx`
- Modify: `src/RetirementView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: resolved home issues from `calculateRetirementProjection`.
- Produces: `RetirementHomeSaleDetails` with callbacks `onUpdateCurrentHome` and `onUpdatePlannedHome`.
- Produces: `HomeSaleSourcePatch` shared by both authoritative update callbacks.
- Produces: refreshed bootstrap data through existing App mutation flow.

Define the patch without duplicating appreciation or sale value:

```ts
export interface HomeSaleSourcePatch {
  purchaseDate: string;
  purchasePriceCents: Cents;
  homeSaleAssumptions: HomeSaleAssumptions;
}
```

- [ ] **Step 1: Write failing current-home editor tests**

Render one complete and one incomplete current home. Assert inherited values are shown without required interaction, issue controls appear only for missing facts, and saving calls:

```ts
expect(onUpdateCurrentHome).toHaveBeenCalledWith("home", {
  purchaseDate: "2020-06-01",
  purchasePriceCents: 450_000_00,
  homeSaleAssumptions: {
    sellingCostBps: 600,
    primaryResidenceExclusionEligible: true,
    accumulatedFederalDepreciationCents: 0,
    accumulatedCaliforniaDepreciationCents: 0,
  },
});
```

- [ ] **Step 2: Run the editor test and verify failure**

Run: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement focused current-home fields**

Render per-home status plus a collapsed `Edit sale details` form. Use existing money/rate validation limits. Label projected sale value and appreciation as Plan-derived and read-only. Do not create Retirement-only state beyond the unsaved form draft.

- [ ] **Step 4: Write failing planned-home and derived-eligibility tests**

Assert planned-home save produces a cloned scenario event with updated `propertyDetails.homeSaleAssumptions`; all unrelated events and fields remain byte-for-byte equivalent. Assert eligibility is displayed as inferred when purchase/primary-residence/history data proves it and asks for confirmation only when derivation returns unknown.

- [ ] **Step 5: Wire authoritative persistence**

In `App.tsx`, provide callbacks that call existing `repository.updateAsset` or `repository.updateScenario` with current revision data, then refresh bootstrap through the existing mutation/reload path. For planned homes, update only the matching `asset-purchase` event. Pass errors back to the editor so it retains the draft and offers retry.

Use callback contracts:

```ts
onUpdateCurrentHome: (assetId: string, patch: HomeSaleSourcePatch) => Promise<void>;
onUpdatePlannedHome: (eventId: string, patch: HomeSaleSourcePatch) => Promise<void>;
```

- [ ] **Step 6: Run component and App tests and commit**

Run: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx src/RetirementView.test.tsx src/App.test.tsx && npm run build`

Expected: PASS.

```bash
git add src/RetirementHomeSaleDetails.tsx src/RetirementHomeSaleDetails.test.tsx src/RetirementView.tsx src/App.tsx
git commit -m "feat: edit retirement home sales at source"
```

---

### Task 6: Upgrade Retirement Settings and Selectable Overview Cards

**Files:**
- Modify: `src/RetirementView.tsx`
- Modify: `src/RetirementView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 1 settings and Task 4 `calculateRetirementProjection`.
- Produces: persisted compact controls and selectable overview cards.

- [ ] **Step 1: Update mocks and write failing settings tests**

Assert controls default to 30 years, auto-select one taxable account, require selection among several, show an actionable no-account state, and serialize every field:

```ts
expect(updateRetirementPlan).toHaveBeenLastCalledWith({
  retirementMonth: "2042-09",
  withdrawalRateBps: 300,
  horizonYears: 40,
  taxableDestinationAccountId: "brokerage",
  withdrawalAccountOrder: [],
  selectedScenario: "keep-homes",
  expectedRevision: 1,
});
```

Assert `0`, `61`, decimals, and blank horizon values are invalid and do not autosave.

- [ ] **Step 2: Run focused view tests and verify failure**

Run: `npm test -- --run src/RetirementView.test.tsx`

Expected: FAIL because controls and serialized fields are absent.

- [ ] **Step 3: Extend the serialized autosave draft**

Add horizon, destination, account-order override, and selected scenario to `SettingsDraft`, record fingerprints, replacement handling, retry state, and `SaveValues`. Pass `bootstrap` accounts to settings normalization. Preserve Strict Mode behavior: mounting or receiving an own-save echo must not trigger another save.

- [ ] **Step 4: Add compact controls and withdrawal disclosure**

Render `Years in retirement` as a numeric input, `Taxable destination` as a select only when needed, and a `Withdrawal order` details element. Each ordered account row includes name, owner, tax class, and age-based status with Move up/Move down buttons. Add `Use automatic order` to clear the override.

- [ ] **Step 5: Write failing scenario-card tests**

Assert both cards use buttons with `aria-pressed`, clicking card whitespace selects it, keyboard activation works, selected outline class changes, selection autosaves, and rerendering from persisted data restores Sell selection.

- [ ] **Step 6: Implement accessible selectable cards**

Do not nest interactive form controls inside a `<button>`. Use each card as an `<article>` with a full-card selection button positioned as the primary action and keep disclosures/forms as sibling controls. Apply selected state to the article and `aria-pressed` to the selection button.

- [ ] **Step 7: Add responsive styles**

Add `.retirement-story-selected`, `.retirement-scenario-select`, `.retirement-settings-extra`, and `.retirement-withdrawal-order` styles. Ensure visible focus, at least 44px phone targets, two-column desktop layout, one-column layout below 900px, and no color-only selected indicator.

- [ ] **Step 8: Run view/App tests and commit**

Run: `npm test -- --run src/RetirementView.test.tsx src/App.test.tsx && npm run build`

Expected: PASS.

```bash
git add src/RetirementView.tsx src/RetirementView.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: select and configure retirement scenarios"
```

---

### Task 7: Render the Annual Projection Table and Warnings

**Files:**
- Create: `src/RetirementProjectionTable.tsx`
- Create: `src/RetirementProjectionTable.test.tsx`
- Modify: `src/RetirementView.tsx`
- Modify: `src/RetirementView.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `AvailableRetirementScenarioProjection`, `UnavailableRetirementScenarioProjection`, selected scenario, account names, and warning data.
- Produces: one accessible annual table with expandable row details and explicit unavailable state.

- [ ] **Step 1: Write failing annual-column tests**

Render two deterministic years and assert headings and reconciled cells for year/ages, starting portfolio, pre-tax withdrawal, estimated taxes, after-tax income, Plan and housing expenses, surplus/shortfall, ending destination balance, and ending net worth.

Assert negative values use signed copy and accessible labels rather than color alone.

- [ ] **Step 2: Run the table test and verify failure**

Run: `npm test -- --run src/RetirementProjectionTable.test.tsx`

Expected: FAIL because the table component does not exist.

- [ ] **Step 3: Implement the main table**

Use semantic `<table>`, column scopes, tabular-number formatting, and a caption naming the selected scenario and horizon. Do not calculate totals in React; render only domain result fields.

- [ ] **Step 4: Write failing detail and warning tests**

Assert Keep row details name rental income and full home-cost components. Assert Sell year one names gross proceeds, selling costs, mortgage payoff, and incremental sale tax. Assert early withdrawal, account depletion, ended activity, and unfunded spending appear in the affected row.

- [ ] **Step 5: Add compact row disclosures**

Use one `View year details` control per row and a following full-width detail row. Map warning codes to concise copy, but preserve domain-provided entity/year context. Do not create permanent extra columns.

- [ ] **Step 6: Write and implement unavailable-state tests**

Assert selecting unavailable Sell renders its per-home issues in the table region, Keep remains selectable and populated, and a new projection exception clears all prior rows and shows a page-level alert.

- [ ] **Step 7: Add responsive table styles**

Add `.retirement-projection`, `.retirement-table-scroll`, `.retirement-year-details`, and warning styles. Use horizontal scrolling, nowrap numeric columns, a sticky first column where supported, and phone-safe disclosure controls.

- [ ] **Step 8: Run table/view tests and commit**

Run: `npm test -- --run src/RetirementProjectionTable.test.tsx src/RetirementView.test.tsx && npm run build`

Expected: PASS.

```bash
git add src/RetirementProjectionTable.tsx src/RetirementProjectionTable.test.tsx src/RetirementView.tsx src/RetirementView.test.tsx src/styles.css
git commit -m "feat: show annual retirement projections"
```

---

### Task 8: Complete Migration, Regression, and Acceptance Coverage

**Files:**
- Modify: `src/domain/retirementProjection.test.ts`
- Modify: `src/RetirementView.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src-tauri/src/lib.rs`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: end-to-end regression evidence and user-facing capability documentation.

- [ ] **Step 1: Add legacy migration and deletion regression tests**

Create a version-22 database row, run migrations twice, and assert defaults remain stable and revision data survives. Delete the selected destination account and assert bootstrap returns null destination without selecting another account when multiple eligible accounts remain.

- [ ] **Step 2: Add integrated React acceptance tests**

Use a real domain calculator with compact fixtures rather than mocks for one Keep and one Sell flow. Assert selecting Sell changes the table, sale details update the shared source callback, returning to Retirement restores selection, and overview/table first-year figures reconcile.

- [ ] **Step 3: Update README capability and limitation copy**

Replace the point-in-time Retirement description with concise text stating that Retirement compares keeping or selling homes, projects annual fixed-rate withdrawals and Plan spending, uses age-aware account ordering, and provides planning estimates rather than tax advice. State that special penalty exceptions and advanced retirement strategies are not modeled.

- [ ] **Step 4: Run formatting and focused verification**

Run:

```bash
npx prettier --check src/RetirementView.tsx src/RetirementHomeSaleDetails.tsx src/RetirementProjectionTable.tsx src/domain/retirementProjection.ts src/domain/retirementWithdrawals.ts
npm test -- --run src/domain/retirementWithdrawals.test.ts src/domain/retirementProjection.test.ts src/domain/retirementSnapshot.test.ts src/domain/projection.test.ts src/domain/tax.test.ts src/domain/homeSaleTax.test.ts src/RetirementHomeSaleDetails.test.tsx src/RetirementProjectionTable.test.tsx src/RetirementView.test.tsx src/App.test.tsx
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: every command exits 0. If this repository has no Prettier configuration or binary, omit only the first command and rely on TypeScript/build checks; do not add a formatting dependency for this feature.

- [ ] **Step 5: Run the complete project check**

Run: `npm run check`

Expected: Vitest, TypeScript/Vite build, and Rust tests all pass.

- [ ] **Step 6: Inspect the final diff for scope and secrets**

Run: `git status --short && git diff --check && git diff --stat && git diff -- src-tauri/src/lib.rs src/domain/retirementProjection.ts src/RetirementView.tsx`

Expected: only feature files, tests, documentation, and the intended migration are changed; no credentials, generated bundles, audit artifacts, or `.superpowers/` files are staged.

- [ ] **Step 7: Commit final acceptance coverage**

```bash
git add README.md src/domain/retirementProjection.test.ts src/RetirementView.test.tsx src/App.test.tsx src-tauri/src/lib.rs
git commit -m "test: verify retirement scenario projections"
```

Do not run `git push`. Report the local branch and commits to the user, then request exact repository/remote/branch confirmation if they want a push.
