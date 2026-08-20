# Retirement Snapshot Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy retirement forecast with a month-specific, active-Plan snapshot comparing keeping all homes with selling all homes.

**Architecture:** Add an isolated retirement cutoff builder and `calculateRetirementSnapshot` domain calculator, backed by the existing monthly Plan projection and a focused incremental home-sale tax kernel. Persist only retirement month and withdrawal rate, keep React responsible for presentation and autosave, and delete the legacy runway/retirement-ledger stack after the new flow is integrated.

**Tech Stack:** TypeScript 5.7, React 18, Vitest 4, Testing Library, Tauri 2, Rust, rusqlite, SQLite.

**Spec:** `docs/superpowers/specs/2026-08-19-retirement-snapshot-redesign.md`

## Global Constraints

- Retirement is household-wide and begins at the first instant of the selected `YYYY-MM`; use the preceding month-end balance sheet.
- Always evaluate the active Plan scenario; do not persist or render a Retirement scenario selector and do not mutate the Plan scenario.
- The only Retirement inputs are retirement month and one shared withdrawal rate; new records default to January of the next calendar year and 300 basis points.
- Include only RSUs vested before retirement; exclude vesting events in and after the retirement month.
- “Keep homes” income is `max(0, nonHomeNetWorth) * rate + gross monthly home/ADU rent * 12`.
- “Sell all homes” liquidates homes only; all non-home assets and retirement accounts remain at their cutoff face values.
- Liquid net worth must be unavailable—not partially estimated—when any home lacks required sale-tax metadata.
- Headline income is pre-tax, rental income is gross revenue, and both limitations must be explicit in UI copy.
- Remove the old runway, readiness, retirement budget/income schedule, withdrawal sequencing, detailed retirement tax ledger, chart, and annual table.
- Do not add individual retirement dates, scenario comparison, post-tax income, spending power, portfolio longevity, selectable home sales, non-home liquidation tax, vacancy, or property-expense modeling.
- Work directly on `main`; do not create a branch. Never run `git push` without fresh explicit user confirmation for this repository, remote, and branch.
- Preserve unrelated working-tree changes, including the uncommitted approved spec and `.superpowers/` brainstorming artifacts.

## File Map

- Create `src/domain/retirementSettings.ts`: lean persisted settings, defaults, legacy normalization.
- Create `src/domain/retirementCutoff.ts`: validate the month, run a retirement-aware Plan projection, and normalize the prior month-end balance sheet.
- Create `src/domain/homeSaleTax.ts`: compute simultaneous-home gains and incremental federal, California, recapture, and NIIT tax.
- Create `src/domain/retirementSnapshot.ts`: pure keep/sell scenario formulas and structured missing-data results.
- Create `src/domain/retirementCutoff.test.ts`, `src/domain/homeSaleTax.test.ts`, and `src/domain/retirementSnapshot.test.ts`: focused domain coverage.
- Create `src/RetirementView.test.tsx`: inputs, autosave, cards, disclosures, unavailable state, and projection errors.
- Modify `src/domain/types.ts`: retirement projection options, home-sale metadata, and tax-ledger AGI fields.
- Modify `src/domain/projection.ts` and `src/domain/projection.test.ts`: stop household employment and future vesting at the retirement month.
- Modify `src/domain/tax.ts` and `src/domain/tax.test.ts`: expose reusable progressive-tax behavior and AGI needed by sale-tax comparison.
- Modify `src/domain/index.ts`: export the new modules and stop exporting deleted retirement forecast modules.
- Modify `src/repository.ts`: lean retirement record and home-sale metadata transport types.
- Modify `src-tauri/src/lib.rs`: SQLite migration, Rust DTOs, validation, bootstrap, and persistence tests.
- Modify `src/ScenarioPlanningDialog.tsx` and `src/ScenarioPlanningDialog.test.tsx`: collect sale assumptions for planned homes.
- Modify `src/App.tsx`: collect current-home sale assumptions, pass the active scenario to Retirement, and remove legacy Retirement projection state.
- Modify `src/App.test.tsx`: replace the legacy scheduled-income persistence test with integration and migration assertions.
- Replace `src/RetirementView.tsx`: approved two-story snapshot UI only.
- Modify `src/styles.css`: dedicated responsive retirement snapshot styles; delete obsolete retirement rules.
- Modify `e2e/specs/acceptance.e2e.js`: add the retirement snapshot navigation and content assertions.
- Delete `src/domain/retirement.ts`, `src/domain/retirementOutlook.ts`, `src/domain/retirementTax.ts`, `src/domain/retirement.test.ts`, and `src/domain/retirementTax.test.ts` after all consumers have moved.

---

### Task 1: Replace legacy retirement persistence with lean settings

**Files:**
- Create: `src/domain/retirementSettings.ts`
- Modify: `src/domain/index.ts`
- Modify: `src/repository.ts`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `RetirementSettingsRecord`, `RetirementSettingsInput`, `defaultRetirementSettings(now?)`, and `normalizeRetirementSettings(value, now?)`.
- Produces: repository method `updateRetirementPlan(input: RetirementSettingsInput): Promise<RetirementSettingsRecord>`; retain the command name to avoid an unnecessary Tauri permission/API rename.
- Consumes later: `RetirementView` initializes and autosaves through these exact types.

- [ ] **Step 1: Add failing Rust migration and round-trip tests**

Add tests beside `retirement_plan_round_trips_and_enforces_revisions` that assert an old row migrates to the lean schema and preserves only January plus the rate:

```rust
#[test]
fn version_22_rebuilds_retirement_plans_as_monthly_settings() {
    let mut c = seeded();
    c.execute(
        "INSERT INTO retirement_plans(household_id,selected_scenario_id,retirement_year,runway_years,withdrawal_rate_bps,expense_buckets_json,selected_source_ids_json,portfolio_items_json,withdrawal_order_json,revision) VALUES('test','base',2040,50,425,'[]','[]','[]','[]',3)",
        [],
    ).unwrap();
    c.execute("DELETE FROM schema_migrations WHERE version >= 22", []).unwrap();

    migrate(&mut c).unwrap();

    let columns = c.prepare("PRAGMA table_info(retirement_plans)").unwrap()
        .query_map([], |row| row.get::<_, String>(1)).unwrap()
        .collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(columns, vec!["household_id", "retirement_month", "withdrawal_rate_bps", "revision", "updated_at"]);
    let loaded = bootstrap(&c).unwrap().retirement_plan.unwrap();
    assert_eq!(loaded.retirement_month, "2040-01");
    assert_eq!(loaded.withdrawal_rate_bps, 425);
    assert_eq!(loaded.revision, 3);
}

#[test]
fn retirement_settings_round_trip_and_enforce_revisions() {
    let mut c = seeded();
    let saved = store_retirement_plan(&mut c, RetirementPlanInput {
        retirement_month: "2042-09".into(),
        withdrawal_rate_bps: 300,
        expected_revision: 1,
    }).unwrap();
    assert_eq!(saved.retirement_month, "2042-09");
    assert_eq!(saved.revision, 1);
    assert_eq!(store_retirement_plan(&mut c, RetirementPlanInput {
        retirement_month: "2042-10".into(), withdrawal_rate_bps: 350, expected_revision: 1,
    }).unwrap().revision, 2);
    assert!(matches!(store_retirement_plan(&mut c, RetirementPlanInput {
        retirement_month: "2042-11".into(), withdrawal_rate_bps: 350, expected_revision: 1,
    }), Err(AppError::Conflict)));
}
```

- [ ] **Step 2: Run the targeted Rust tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml version_22_rebuilds_retirement_plans_as_monthly_settings -- --nocapture && cargo test --manifest-path src-tauri/Cargo.toml retirement_settings_round_trip_and_enforce_revisions -- --nocapture`

Expected: FAIL because version 22 and `retirement_month` DTO fields do not exist.

- [ ] **Step 3: Implement schema version 22 and lean Rust DTOs**

Replace `RetirementPlanRecord`/`RetirementPlanInput` fields with:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetirementPlanRecord {
    household_id: String,
    retirement_month: String,
    withdrawal_rate_bps: i64,
    revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetirementPlanInput {
    retirement_month: String,
    withdrawal_rate_bps: i64,
    expected_revision: i64,
}
```

Add migration 22 using a table rebuild so legacy columns are truly discarded:

```sql
CREATE TABLE retirement_plans_v22(
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE RESTRICT,
  retirement_month TEXT NOT NULL CHECK(retirement_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  withdrawal_rate_bps INTEGER NOT NULL CHECK(withdrawal_rate_bps BETWEEN 1 AND 10000),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO retirement_plans_v22(household_id,retirement_month,withdrawal_rate_bps,revision,updated_at)
SELECT household_id,printf('%04d-01',retirement_year),withdrawal_rate_bps,revision,updated_at FROM retirement_plans;
DROP TABLE retirement_plans;
ALTER TABLE retirement_plans_v22 RENAME TO retirement_plans;
INSERT INTO schema_migrations(version) VALUES(22);
```

Validate `retirement_month` by parsing `YYYY-MM-01` and round-tripping the year/month; validate `withdrawal_rate_bps` in `1..=10_000`. Rewrite bootstrap SELECT and the upsert to use only the five lean columns.

- [ ] **Step 4: Add the TypeScript settings contract and legacy normalizer**

Create:

```ts
import type { BasisPoints } from "./types";

export interface RetirementSettingsRecord {
  householdId: string;
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  revision: number;
}

export type RetirementSettingsInput = Omit<RetirementSettingsRecord, "householdId" | "revision"> & {
  expectedRevision: number;
};

const januaryNextYear = (now: Date) => `${now.getUTCFullYear() + 1}-01`;

export const defaultRetirementSettings = (now = new Date()): Omit<RetirementSettingsRecord, "householdId"> => ({
  retirementMonth: januaryNextYear(now),
  withdrawalRateBps: 300,
  revision: 1,
});

export function normalizeRetirementSettings(value: unknown, now = new Date()): Omit<RetirementSettingsRecord, "householdId"> {
  const row = (value ?? {}) as Record<string, unknown>;
  const legacyYear = Number(row.retirementYear);
  return {
    retirementMonth: typeof row.retirementMonth === "string"
      ? row.retirementMonth
      : Number.isInteger(legacyYear) ? `${legacyYear}-01` : januaryNextYear(now),
    withdrawalRateBps: Number.isInteger(row.withdrawalRateBps) ? Number(row.withdrawalRateBps) : 300,
    revision: Number.isInteger(row.revision) ? Number(row.revision) : 1,
  };
}
```

Export this module from `src/domain/index.ts` and point bootstrap's `retirementPlan` field at `RetirementSettingsRecord`. To keep the legacy screen functional until Task 6 replaces it, temporarily accept the old UI payload in the repository adapter and send only the lean command input:

```ts
updateRetirementPlan: (input) => invoke("update_retirement_plan", { input: {
  retirementMonth: "retirementMonth" in input ? input.retirementMonth : `${input.retirementYear}-01`,
  withdrawalRateBps: input.withdrawalRateBps,
  expectedRevision: input.expectedRevision,
} }),
```

Type this as a temporary union of `RetirementSettingsInput` and the existing legacy input. `RetirementView` only consumes the returned revision after a save, so the lean response is safe. Remove this adapter and union in Task 6; neither is allowed in the final tree.

In `App.tsx`, adapt the lean bootstrap record into the legacy view's expected shape until Task 6 replaces that view:

```ts
const legacyRetirementPlan = retirementSettings ? {
  ...defaultRetirementPlan(Number(retirementSettings.retirementMonth.slice(0, 4))),
  householdId: retirementSettings.householdId,
  withdrawalRateBps: retirementSettings.withdrawalRateBps,
  revision: retirementSettings.revision,
} : null;
```

Pass `legacyRetirementPlan` only to the old `RetirementView`; keep `retirementSettings` as the authoritative App state. Temporarily translate `onPlanChange` back with `retirementMonth: `${plan.retirementYear}-01`, withdrawalRateBps: plan.withdrawalRateBps, revision: plan.revision`, preserving the current household ID. This compatibility object and callback disappear in Task 6.

- [ ] **Step 5: Run persistence tests and type-check**

Run: `cargo test --manifest-path src-tauri/Cargo.toml retirement -- --nocapture && npm run build`

Expected: Rust retirement tests and TypeScript build PASS. The temporary repository adapter keeps the legacy screen compiling until Task 6.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add src/domain/retirementSettings.ts src/domain/index.ts src/repository.ts src/App.tsx src-tauri/src/lib.rs
git commit -m "refactor: simplify retirement settings persistence"
```

### Task 2: Add a retirement-aware monthly Plan cutoff

**Files:**
- Create: `src/domain/retirementCutoff.ts`
- Create: `src/domain/retirementCutoff.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/projection.ts`
- Modify: `src/domain/projection.test.ts`
- Modify: `src/domain/tax.ts`
- Modify: `src/domain/tax.test.ts`

**Interfaces:**
- Produces: `ProjectionOptions { stopEmploymentMonth?: string }` accepted as the fourth argument to `ProjectionEngine.calculate`.
- Produces: `buildRetirementCutoff(input: RetirementCutoffInput): RetirementCutoff`.
- Produces: `TaxLedger.federalAgiCents` and `TaxLedger.modifiedAgiCents` for incremental-sale-tax stacking.
- Consumes: existing `FinancialSnapshot`, `Scenario`, `AnnualProjection`, and vested-equity helpers.

- [ ] **Step 1: Write failing projection-policy tests**

Add cases to `projection.test.ts` using a salary, taxable non-wage income, a one-time wage event, and an RSU vest on the boundary:

```ts
it("stops household wages and RSU vesting at the retirement month", () => {
  const result = ProjectionEngine.calculate(financialWithSeptemberWagesAndVests, scenario, "2026-01-01", {
    stopEmploymentMonth: "2026-09",
  });
  expect(result[0].months.find(m => m.month === "2026-08")!.incomeCents).toBeGreaterThan(0);
  expect(result[0].months.find(m => m.month === "2026-09")!.incomeCents).toBe(nonWageSeptemberCents);
  expect(result[0].taxLedger!.employees.every(e => e.salaryCents === wagesThroughAugust[e.personId])).toBe(true);
  expect(result[0].months.find(m => m.month === "2026-09")!.balances!.privateStock.rsu.vestedCents)
    .toBe(vestedValueBeforeSeptember);
});
```

Also assert an `incomeType: "ordinary"`/`incomeTaxCategory: "taxable-nonwage"` recurring entry continues and that a `one-time-income` categorized as `wages` on `2026-09-01` is excluded.

- [ ] **Step 2: Run the projection test and verify failure**

Run: `npm test -- src/domain/projection.test.ts`

Expected: FAIL because `ProjectionOptions` and the fourth argument do not exist and September wages/vesting remain.

- [ ] **Step 3: Implement the projection stop policy**

Add to `types.ts`:

```ts
export interface ProjectionOptions {
  stopEmploymentMonth?: string;
}
```

Change the signature to:

```ts
calculate(
  snapshot: FinancialSnapshot,
  scenario: Scenario,
  asOfDate: string,
  options: ProjectionOptions = {},
): readonly AnnualProjection[]
```

Use one predicate everywhere projected recurring income, one-time wages, and vest events are accumulated:

```ts
const employmentActive = (month: string) =>
  !options.stopEmploymentMonth || month < options.stopEmploymentMonth;
const isEmploymentIncome = (entry: RecurringEntry) =>
  entry.incomeTaxCategory === "wages" || entry.incomeType === "salary";
```

Exclude wage entries and wage events when `employmentActive(key)` is false. Exclude RSU/private-stock vest income and new vested units when the vest month is at or after `stopEmploymentMonth`. Do not suppress ordinary taxable non-wage or nontaxable income.

- [ ] **Step 4: Add and expose tax-ledger AGI fields**

Extend `TaxLedger` with `federalAgiCents` and `modifiedAgiCents`. In `estimateHouseholdTax`, set both to `agi` for the currently supported wage/non-wage model. Add this assertion to `tax.test.ts`:

```ts
expect(estimateHouseholdTax(args)).toEqual(expect.objectContaining({
  federalAgiCents: expectedAgi,
  modifiedAgiCents: expectedAgi,
}));
```

Update any literal `TaxLedger` fixtures to include the fields.

- [ ] **Step 5: Write failing cutoff-normalization tests**

Create `retirementCutoff.test.ts` with a fixture whose August month has account, ordinary asset, vested/private-stock, liability, and property rows. Assert:

```ts
const cutoff = buildRetirementCutoff({
  snapshot,
  scenario,
  retirementMonth: "2026-09",
  asOfDate: "2026-01-15",
});
expect(cutoff.balanceMonth).toBe("2026-08");
expect(cutoff.accounts.cash).toBe(augustAccountCents);
expect(cutoff.assets.rsu).toBe(augustVestedRsuCents);
expect(cutoff.liabilities.card).toBe(augustCardDebtCents);
expect(cutoff.taxLedger.year).toBe(2026);
expect(cutoff.properties[0]).toEqual(expect.objectContaining({ assetId: "home", monthlyGrossRentCents: rentPlusAdu }));
```

Add a January test asserting `retirementMonth: "2027-01"` reads `2026-12`, and an error test for a missing/null balance row.

- [ ] **Step 6: Implement `buildRetirementCutoff`**

Define:

```ts
export interface RetirementCutoffInput {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  retirementMonth: string;
  asOfDate: string;
}

export interface RetirementCutoffProperty {
  assetId: string;
  name: string;
  valueCents: Cents;
  mortgageCents: Cents;
  monthlyGrossRentCents: Cents;
  projectedDepreciationCents: Cents;
  source: "current" | "planned";
}

export interface RetirementCutoff {
  retirementMonth: string;
  balanceMonth: string;
  accounts: Readonly<Record<string, Cents>>;
  assets: Readonly<Record<string, Cents>>;
  liabilities: Readonly<Record<string, Cents>>;
  properties: readonly RetirementCutoffProperty[];
  taxLedger: TaxLedger;
}
```

Compute the previous month with UTC date arithmetic, extend the active scenario horizon only through that month (maximum 1200 months, matching the existing retirement extension allowance), run `ProjectionEngine.calculate(..., { stopEmploymentMonth: retirementMonth })`, and select the exact prior-month row. Merge ordinary assets with `balances.privateStock[*].vestedCents`; never use `unvestedCents`. Sum each property's monthly `depreciationCents` through the cutoff into `projectedDepreciationCents`. Throw a `RangeError` naming the missing month when balances or the retirement-year tax ledger are absent.

- [ ] **Step 7: Run cutoff and projection tests**

Run: `npm test -- src/domain/projection.test.ts src/domain/tax.test.ts src/domain/retirementCutoff.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the cutoff slice**

```bash
git add src/domain/types.ts src/domain/projection.ts src/domain/projection.test.ts src/domain/tax.ts src/domain/tax.test.ts src/domain/retirementCutoff.ts src/domain/retirementCutoff.test.ts
git commit -m "feat: build retirement-aware plan cutoff"
```

### Task 3: Capture defensible home-sale metadata

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/repository.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/ScenarioPlanningDialog.tsx`
- Modify: `src/ScenarioPlanningDialog.test.tsx`

**Interfaces:**
- Produces: `HomeSaleAssumptions` on current assets and planned-property details.
- Produces: persisted `Asset.homeSaleAssumptions` / `AssetInput.homeSaleAssumptions`.
- Consumes later: `calculateRetirementSnapshot` resolves these assumptions for each cutoff property.

- [ ] **Step 1: Add failing Rust asset metadata tests**

Extend `assets_and_mortgages_round_trip_update_and_delete` to create and update:

```rust
home_sale_assumptions: Some(serde_json::json!({
    "sellingCostBps": 600,
    "primaryResidenceExclusionEligible": true,
    "accumulatedFederalDepreciationCents": 0,
    "accumulatedCaliforniaDepreciationCents": 0
})),
```

Assert bootstrap returns the same camelCase JSON. Add rejection cases for selling cost outside `0..=10_000`, negative depreciation, and California depreciation above the asset's rental tax basis.

- [ ] **Step 2: Run targeted Rust asset tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml assets_and_mortgages_round_trip_update_and_delete -- --nocapture`

Expected: FAIL because `home_sale_assumptions` is not a DTO or database field.

- [ ] **Step 3: Add the shared TypeScript metadata type**

Add:

```ts
export interface HomeSaleAssumptions {
  sellingCostBps: BasisPoints;
  primaryResidenceExclusionEligible: boolean;
  accumulatedFederalDepreciationCents: Cents;
  accumulatedCaliforniaDepreciationCents: Cents;
}
```

Add `homeSaleAssumptions?: HomeSaleAssumptions | null` to domain `Asset`, repository `Asset`, `AssetInput`, and `HomeInput`. Add `purchasePriceCents?: Cents | null` and `purchaseDate?: string | null` to repository `AssetInput` so existing homes can repair missing acquisition data. Add the same optional nested sale-assumptions field to `PlannedPropertyDetails` so planned homes carry their sale assumptions in the Plan event. Remove the currently unused root-level `accumulatedFederalDepreciationCents` and `accumulatedCaliforniaDepreciationCents` declarations from domain `Asset` to avoid two sources of truth.

- [ ] **Step 4: Persist and validate current-home metadata**

Add schema migration 23 with nullable `home_sale_assumptions_json TEXT`. Extend Rust `Asset`, `AssetInput`, bootstrap SELECT mapping, and `save_asset`. Validate all four exact fields and serialize the JSON unchanged. Accept and validate `purchase_price_cents` and ISO `purchase_date` in `AssetInput`, and include them in asset UPDATE statements so an existing home can repair those fields. Extend `create_home` so a newly created home can store the same metadata. Do not infer missing basis in the generic asset flow.

- [ ] **Step 5: Add failing current-home form tests**

In `App.test.tsx`, open create/edit home/asset flows and assert the repository receives:

```ts
homeSaleAssumptions: {
  sellingCostBps: 600,
  primaryResidenceExclusionEligible: true,
  accumulatedFederalDepreciationCents: 0,
  accumulatedCaliforniaDepreciationCents: 0,
}
```

Use labels `Selling costs (%)`, `Eligible for primary-home gain exclusion`, `Federal depreciation claimed`, and `California depreciation claimed`. Add a validation assertion that negative depreciation blocks saving.

- [ ] **Step 6: Implement current-home form fields**

Add a collapsed `Sale and tax details` fieldset only for assets recognized as homes. Include editable `Purchase date` and `Tax basis` controls there when those values are missing. Default selling costs to blank for existing homes (so Retirement remains unavailable until confirmed), and to `6` only when the user creates a new home and explicitly saves the form. Keep the eligibility checkbox false by default. Send integer basis points and cents through `HomeInput`/`AssetInput`.

- [ ] **Step 7: Add failing planned-home dialog tests**

In `ScenarioPlanningDialog.test.tsx`, edit an `asset-purchase` and assert submission includes:

```ts
propertyDetails: expect.objectContaining({
  homeSaleAssumptions: {
    sellingCostBps: 600,
    primaryResidenceExclusionEligible: true,
    accumulatedFederalDepreciationCents: 0,
    accumulatedCaliforniaDepreciationCents: 0,
  },
})
```

Also assert missing selling costs remain `undefined` rather than silently becoming zero.

- [ ] **Step 8: Implement planned-home sale fields and validation**

Add the same four controls under the existing planned-property tax details. Parse blank selling cost as `undefined`; parse saved values into basis points/cents. Planned properties start with zero accumulated depreciation unless the user explicitly edits it. Keep metadata inside `propertyDetails`; no separate persistence table is required because scenario events already round-trip as JSON.

- [ ] **Step 9: Run metadata tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml assets_and_mortgages_round_trip_update_and_delete -- --nocapture && npm test -- src/App.test.tsx src/ScenarioPlanningDialog.test.tsx`

Expected: PASS.

- [ ] **Step 10: Commit the metadata slice**

```bash
git add src/domain/types.ts src/repository.ts src-tauri/src/lib.rs src/App.tsx src/App.test.tsx src/ScenarioPlanningDialog.tsx src/ScenarioPlanningDialog.test.tsx
git commit -m "feat: capture home sale tax assumptions"
```

### Task 4: Extract a simultaneous-home incremental tax kernel

**Files:**
- Create: `src/domain/homeSaleTax.ts`
- Create: `src/domain/homeSaleTax.test.ts`
- Modify: `src/domain/tax.ts`
- Modify: `src/domain/index.ts`
- Test: `src/domain/tax.test.ts`

**Interfaces:**
- Consumes: `TaxLedger`, `FilingStatus`, `projectedTaxRules`, and home disposition inputs.
- Produces: `calculateIncrementalHomeSaleTax(input: HomeSaleTaxInput): HomeSaleTaxResult`.
- Produces: exported `progressiveTax(cents, brackets)` from `tax.ts` (rename the existing private `progressive` helper and update its internal callers).

- [ ] **Step 1: Write the failing tax-kernel tests**

Create table-driven tests for single and simultaneous sales:

```ts
const baseline = {
  federalTaxableCents: 100_000_00,
  californiaTaxableCents: 100_000_00,
  modifiedAgiCents: 120_000_00,
};

it("taxes simultaneous homes against one household baseline", () => {
  const result = calculateIncrementalHomeSaleTax({
    year: 2035,
    filingStatus: "married-joint",
    thresholdInflationBps: 250,
    baseline,
    sales: [primaryHomeSale, rentalHomeSale],
  });
  expect(result.sales).toHaveLength(2);
  expect(result.federalLongTermGainCents).toBe(expectedCombinedLongGain);
  expect(result.unrecaptured1250GainCents).toBe(rentalDepreciation);
  expect(result.totalIncrementalTaxCents).toBe(
    result.federalIncomeTaxCents + result.californiaIncomeTaxCents + result.niitCents,
  );
});
```

Add exact cases for: selling costs reducing proceeds and gain; mortgage not reducing gain; $250,000/$500,000 primary-residence exclusion; exclusion never covering depreciation recapture; short-term holding taxed as ordinary; rental depreciation recapture; NIIT threshold; two-home bracket interaction; primary-home loss not creating a tax benefit; and total incremental tax floored at zero.

- [ ] **Step 2: Run the tax tests and verify failure**

Run: `npm test -- src/domain/homeSaleTax.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the home-sale tax types and gain normalization**

Define:

```ts
export interface HomeSaleTaxItem {
  id: string;
  name: string;
  acquiredOn: string;
  disposedOn: string;
  salePriceCents: Cents;
  sellingCostCents: Cents;
  federalBasisCents: Cents;
  californiaBasisCents: Cents;
  accumulatedFederalDepreciationCents: Cents;
  accumulatedCaliforniaDepreciationCents: Cents;
  primaryResidenceExclusionEligible: boolean;
}

export interface HomeSaleTaxInput {
  year: number;
  filingStatus: FilingStatus;
  thresholdInflationBps: BasisPoints;
  baseline: Pick<TaxLedger, "federalTaxableCents" | "californiaTaxableCents" | "modifiedAgiCents">;
  sales: readonly HomeSaleTaxItem[];
}

export interface HomeSaleTaxResult {
  sales: readonly { id: string; netSalePriceCents: Cents; federalGainCents: Cents; californiaGainCents: Cents; exclusionCents: Cents }[];
  federalShortTermGainCents: Cents;
  federalLongTermGainCents: Cents;
  unrecaptured1250GainCents: Cents;
  californiaGainCents: Cents;
  federalIncomeTaxCents: Cents;
  californiaIncomeTaxCents: Cents;
  niitCents: Cents;
  totalIncrementalTaxCents: Cents;
}
```

For eligible primary homes, cap the exclusion at `$500,000` only for `married-joint` and `$250,000` for all other statuses. Apply it only to positive non-recapture gain. Treat holdings of one year or less as short-term. Ignore a personal-residence loss; allow rental losses to offset household property gains only up to the gains in this simultaneous transaction, never producing negative incremental tax.

- [ ] **Step 4: Implement stacked federal, California, recapture, and NIIT deltas**

Export the existing progressive bracket helper from `tax.ts` as `progressiveTax`. Calculate ordinary short-term delta against `baseline.federalTaxableCents`, preferential long-term delta stacked above ordinary taxable income, the additional amount needed to bring recapture up to at most 25%, California ordinary-tax delta on combined taxable gains, and NIIT on investment gain above the filing-status threshold. Round each cents result and floor the total incremental liability at zero.

- [ ] **Step 5: Run tax suites**

Run: `npm test -- src/domain/homeSaleTax.test.ts src/domain/tax.test.ts src/domain/investment.test.ts`

Expected: PASS, including unchanged investment tax behavior after the helper rename.

- [ ] **Step 6: Commit the tax slice**

```bash
git add src/domain/homeSaleTax.ts src/domain/homeSaleTax.test.ts src/domain/tax.ts src/domain/tax.test.ts src/domain/index.ts
git commit -m "feat: calculate incremental tax for home sales"
```

### Task 5: Implement the dedicated retirement snapshot calculator

**Files:**
- Create: `src/domain/retirementSnapshot.ts`
- Create: `src/domain/retirementSnapshot.test.ts`
- Modify: `src/domain/retirementCutoff.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes: `RetirementCutoff`, `FinancialSnapshot`, active `Scenario`, `HomeSaleAssumptions`, and `calculateIncrementalHomeSaleTax`.
- Produces: `calculateRetirementSnapshot(input: RetirementSnapshotInput): RetirementSnapshotResult`.
- Produces structured `RetirementMissingData` entries; UI must not parse error strings.

- [ ] **Step 1: Write failing balance-sheet and keep-homes tests**

Create fixtures containing cash, a retirement account, vested RSUs, an ordinary asset, a home/mortgage, a credit-card liability, and rent/ADU income. Assert exact reconciliation:

```ts
expect(result.netWorthCents).toBe(accountTotal + vestedAssetTotal + homeValue - mortgage - cardDebt);
expect(result.keepHomes).toEqual({
  homeEquityCents: homeValue - mortgage,
  nonHomeNetWorthCents: expectedNetWorth - (homeValue - mortgage),
  withdrawalIncomeCents: Math.round(Math.max(0, expectedNonHomeNetWorth) * 300 / 10_000),
  grossRentalIncomeCents: (monthlyRent + monthlyAduRent) * 12,
  annualPreTaxIncomeCents: expectedWithdrawal + expectedGrossRent,
});
```

Add cases for multiple homes, non-mortgage debt, a negative non-home base producing zero withdrawal income, and future/unvested RSUs absent from cutoff assets.

- [ ] **Step 2: Write failing sell-homes and unavailable tests**

Assert the sell result replaces total home equity with after-cost, after-mortgage, after-incremental-tax proceeds and applies the same rate. Add one table case per missing field code:

```ts
expect(result.sellHomes).toEqual({
  available: false,
  issues: [{ assetId: "home", assetName: "Home", field: "sellingCostBps", message: "Add selling costs for Home." }],
});
```

Required codes are `purchaseDate`, `taxBasis`, `sellingCostBps`, `mortgageBalance`, `primaryResidenceEligibility`, `federalDepreciation`, and `californiaDepreciation`. A home with no mortgage is valid only when no liability links to it; a linked mortgage with no cutoff balance is unavailable.

- [ ] **Step 3: Run calculator tests and verify failure**

Run: `npm test -- src/domain/retirementSnapshot.test.ts`

Expected: FAIL because the calculator does not exist.

- [ ] **Step 4: Define the snapshot result contract**

Use this discriminated union:

```ts
export interface RetirementSnapshotInput {
  cutoff: RetirementCutoff;
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  withdrawalRateBps: BasisPoints;
}

export interface RetirementMissingData {
  assetId: string;
  assetName: string;
  field: "purchaseDate" | "taxBasis" | "sellingCostBps" | "mortgageBalance" |
    "primaryResidenceEligibility" | "federalDepreciation" | "californiaDepreciation";
  message: string;
}

export type SellHomesResult =
  | { available: true; grossHomeEquityCents: Cents; sellingCostsCents: Cents; incrementalSaleTaxCents: Cents; netHomeProceedsCents: Cents; liquidNetWorthCents: Cents; annualPreTaxIncomeCents: Cents }
  | { available: false; issues: readonly RetirementMissingData[] };

export interface RetirementSnapshotResult {
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  netWorthCents: Cents;
  keepHomes: { homeEquityCents: Cents; nonHomeNetWorthCents: Cents; withdrawalIncomeCents: Cents; grossRentalIncomeCents: Cents; annualPreTaxIncomeCents: Cents };
  sellHomes: SellHomesResult;
}
```

- [ ] **Step 5: Implement current/planned home metadata resolution**

Match `cutoff.properties` by `assetId`. For `source: "current"`, read purchase/basis and `homeSaleAssumptions` from `snapshot.assets`. For `source: "planned"`, read acquisition date/value and `propertyDetails.homeSaleAssumptions` from the matching `asset-purchase` event. Add `cutoffProperty.projectedDepreciationCents` to the stored starting depreciation for both federal and California calculations. Produce all issues first; if any exist, return one unavailable union and do not invoke the tax kernel.

- [ ] **Step 6: Implement keep/sell formulas and simultaneous sale tax**

Sum cutoff accounts and assets exactly once, subtract all cutoff liabilities exactly once, and reconcile each property mortgage against the liabilities map. Compute keep-homes values using the spec formulas. Build all `HomeSaleTaxItem`s and invoke `calculateIncrementalHomeSaleTax` once for the household. Allocate only the total tax to the household breakdown; do not invent per-home tax allocations. Compute sell-homes income as `Math.round(Math.max(0, liquidNetWorthCents) * withdrawalRateBps / 10_000)`.

- [ ] **Step 7: Run snapshot and dependency tests**

Run: `npm test -- src/domain/retirementSnapshot.test.ts src/domain/retirementCutoff.test.ts src/domain/homeSaleTax.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the calculator slice**

```bash
git add src/domain/retirementSnapshot.ts src/domain/retirementSnapshot.test.ts src/domain/retirementCutoff.ts src/domain/index.ts
git commit -m "feat: calculate retirement snapshot scenarios"
```

### Task 6: Replace the Retirement UI with the two-story snapshot

**Files:**
- Replace: `src/RetirementView.tsx`
- Create: `src/RetirementView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `RetirementSettingsRecord`, `defaultRetirementSettings`, `normalizeRetirementSettings`, `buildRetirementCutoff`, and `calculateRetirementSnapshot`.
- Produces: `RetirementView` props `{ initial, repository, bootstrap, snapshot, scenario, onSettingsChange? }` with one active `Scenario`, not arrays of scenarios/projections.

- [ ] **Step 1: Write failing component tests for defaults, active Plan, and autosave**

Create `RetirementView.test.tsx` and mock the domain boundary. Assert a null initial record renders next January and `3`, changing month/rate calls:

```ts
expect(repository.updateRetirementPlan).toHaveBeenLastCalledWith({
  retirementMonth: "2042-09",
  withdrawalRateBps: 350,
  expectedRevision: 1,
});
expect(buildRetirementCutoff).toHaveBeenCalledWith(expect.objectContaining({
  scenario: activeScenario,
  retirementMonth: "2042-09",
}));
```

Assert there is no scenario combobox and no mutation callback for Plan events. Preserve the current first-render no-save behavior, revision updates, and `Saving`/`Saved`/retry-on-error behavior.

- [ ] **Step 2: Write failing story-card and disclosure tests**

Mock an available result and assert visible labels `If you keep your homes`, `Net worth at retirement`, `Estimated annual pre-tax income`, `If you sell all homes`, and `Liquid net worth`. Assert details are collapsed initially and expose exact rows after clicking `View calculation`. Assert the copy includes `Gross rental income`, `Pre-tax estimate`, `Only homes are sold`, and `Retirement accounts remain at face value`.

- [ ] **Step 3: Write failing unavailable and projection-error tests**

Mock `sellHomes.available: false` and assert both sell-card headline outputs say `Unavailable`, net worth/keep figures remain, and the disclosure lists each structured issue. Mock `buildRetirementCutoff` throwing and assert a single page-level `role="alert"` is shown and no currency headline remains from the prior render.

- [ ] **Step 4: Run the component test and verify failure**

Run: `npm test -- src/RetirementView.test.tsx`

Expected: FAIL against the legacy component/API.

- [ ] **Step 5: Replace `RetirementView.tsx`**

Implement a focused component with:

```tsx
<section className="card retirement-snapshot-header">
  <div><p className="eyebrow">Retirement snapshot</p><h2>{scenario.name}</h2></div>
  <label>Retirement month<input type="month" value={settings.retirementMonth} /></label>
  <label>Withdrawal rate<div className="retirement-rate"><input type="number" min="0.01" max="100" step="0.1" /><span>%</span></div></label>
</section>
<section className="retirement-stories">
  <RetirementStory kind="keep" result={result} />
  <RetirementStory kind="sell" result={result} />
</section>
```

Keep money/rate formatting local and small. Use semantic `<details><summary>View calculation</summary>…</details>`. Catch domain calculation failures in `useMemo`, render no stale result on error, and continue to allow settings edits. Clamp saved basis points to `1..=10_000` and use integer cents/basis points at domain boundaries.

- [ ] **Step 6: Integrate the active Plan in `App.tsx`**

Delete `retirementProjections` and the legacy `retirementPlan` projection handoff. Render:

```tsx
<RetirementView
  initial={retirementSettings}
  repository={repository}
  bootstrap={bootstrap}
  snapshot={snapshot}
  scenario={projectedScenario}
  onSettingsChange={setRetirementSettings}
/>
```

Continue passing only `projectedScenario`, which is already the active selected Plan. Replace the old App test that adds scheduled retirement income with a test that changes the Retirement month, navigates away immediately, and observes the lean save payload. Remove the temporary legacy input union and mapping adapter from Task 1 so `updateRetirementPlan` accepts only `RetirementSettingsInput` in the final tree.

- [ ] **Step 7: Replace obsolete retirement CSS**

Delete `.retirement-header`, `.subtabs`, `.retirement-cards`, `.bucket-row`, `.source-grid`, `.portfolio-editor`, `.priority-list`, `.retirement-tracker`, `.retirement-income-chart`, and chart-specific retirement rules that have no remaining consumers. Add focused rules for `.retirement-view`, `.retirement-snapshot-header`, `.retirement-stories`, `.retirement-story`, `.retirement-story-metrics`, `.retirement-calculation`, and `.retirement-unavailable`. Use two columns above 900px and one column at/below 900px; retain existing CSS variables, focus rings, and 44px mobile control height.

- [ ] **Step 8: Run UI and App tests**

Run: `npm test -- src/RetirementView.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit the UI slice**

```bash
git add src/RetirementView.tsx src/RetirementView.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: replace retirement tab with snapshot stories"
```

### Task 7: Remove legacy retirement engines and verify integration

**Files:**
- Delete: `src/domain/retirement.ts`
- Delete: `src/domain/retirementOutlook.ts`
- Delete: `src/domain/retirementTax.ts`
- Delete: `src/domain/retirement.test.ts`
- Delete: `src/domain/retirementTax.test.ts`
- Modify: `src/domain/index.ts`
- Modify: `e2e/specs/acceptance.e2e.js`

**Interfaces:**
- Consumes: completed new settings, cutoff, sale-tax, calculator, and view contracts.
- Produces: no legacy retirement forecast symbols or UI remain; complete build/test evidence.

- [ ] **Step 1: Scan for legacy consumers before deletion**

Run:

```bash
rg -n "calculateRetirementOutlook|calculateRetirement\(|RetirementOutlook|RetirementReadiness|RetirementTax|scheduledIncome|expenseBuckets|withdrawalAccountOrder|retirementYears|runwayYears|selectedScenarioId" src src-tauri e2e
```

Expected: only the legacy modules/tests and deliberate migration SQL references remain. Resolve any live consumer before proceeding; migration SQL may retain old column names only inside the version-22 copy statement.

- [ ] **Step 2: Delete legacy modules and exports**

Remove the five listed legacy files. Remove their exports from `src/domain/index.ts`. Do not remove shared `projectedTaxRules`, projection helpers, or investment-comparison behavior.

- [ ] **Step 3: Update E2E retirement expectations**

In the existing acceptance flow, open Retirement and assert the month input, `3%` rate, both story headings, and no old `Retirement readiness`, `Portfolio runway`, or `Add retirement item` controls. Where the fixture lacks sale metadata, assert `Unavailable` plus the missing-data disclosure; do not seed fake zero-tax metadata merely to make the number appear.

- [ ] **Step 4: Run the legacy-symbol and dead-style scans**

Run:

```bash
rg -n "calculateRetirementOutlook|Retirement readiness|Portfolio runway|Add retirement item|scheduledIncome|expenseBuckets|withdrawalAccountOrder|retirementYears|runwayYears|selectedScenarioId" src e2e
rg -n "retirement-(tracker|income-chart|cards)|bucket-row|portfolio-editor|priority-list" src
```

Expected: no matches except migration compatibility fixtures explicitly asserting old input removal.

- [ ] **Step 5: Run formatting/static checks**

Run: `git diff --check && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && npm run build`

Expected: PASS with no whitespace errors, Rust formatting differences, TypeScript errors, or Vite build failures.

- [ ] **Step 6: Run the complete automated suite**

Run: `npm run test && cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS; record the exact test counts in the execution handoff.

- [ ] **Step 7: Run the focused native E2E scenario when a display is available**

Run: `npm run test:e2e:native`

Expected: PASS. If the environment lacks a display/runtime prerequisite, record the exact command and error; do not represent the E2E suite as passing.

- [ ] **Step 8: Review working-tree scope**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --check HEAD
```

Expected: only retirement redesign files, the approved spec/plan, and pre-existing `.superpowers/` artifacts are present. Do not stage `.superpowers/` unless the user explicitly asks to retain brainstorming artifacts.

- [ ] **Step 9: Commit the removal and integration slice**

```bash
git add src/domain src/RetirementView.tsx src/RetirementView.test.tsx src/App.tsx src/App.test.tsx src/styles.css src/repository.ts src-tauri/src/lib.rs src/ScenarioPlanningDialog.tsx src/ScenarioPlanningDialog.test.tsx e2e/specs/acceptance.e2e.js docs/superpowers/specs/2026-08-19-retirement-snapshot-redesign.md docs/superpowers/plans/2026-08-19-retirement-snapshot-redesign.md
git commit -m "refactor: remove legacy retirement forecast"
```

- [ ] **Step 10: Stop before any push**

Report the final commit(s), verification evidence, and remaining limitations. Do not run `git push`; obtain explicit confirmation naming repository `reficul-ac/lifelook`, remote `origin`, and branch `main` immediately before any future push.
