# Primary-Home ADU Rental Tax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tax-model an income-producing ADU on an owner-occupied primary home without converting the whole home to rental use.

**Architecture:** Extend `adu-build` events with nested rental-tax assumptions and resolve those assumptions through one pure ADU-tax module. The projection engine owns monthly allocation, depreciation, and tax character; Retirement consumes the resulting property metadata and routes unresolved setup back to the source Plan event.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Rust, Tauri, rusqlite/SQLite JSON payloads

**Spec:** `docs/superpowers/specs/2026-08-21-primary-home-adu-rental-tax-design.md`

## Global Constraints

- The home stays owner-occupied unless a separate `property-rental-start` event explicitly converts it.
- Default shared-expense allocation is `aduSquareFeet / (homeSquareFeet + aduSquareFeet)`.
- Default ADU depreciable basis is `costCents`.
- The ADU event month is its placed-in-service month; rent and depreciation start that month.
- Mortgage principal is never a rental expense.
- Do not create a second ADU asset, separate ADU debt, or hidden rental-conversion event.
- Scenario payloads remain JSON; do not add SQLite columns.
- Legacy `adu-build` events remain readable and tax modeling stays unresolved until the user supplies assumptions.
- Plan, home-sale, Keep Homes, and Sell All Homes must consume the same property projection tax character.
- Missing setup must be specific, actionable, and deduplicated.
- LifeLook remains a deterministic planning estimate, not tax-return preparation.
- Use TDD for every behavior change: write the test, watch the expected failure, implement the minimum, and rerun focused plus neighboring tests.
- Do not push without the user's separate confirmation of the exact repository, remote, and branch.

## File Structure

- Create `src/domain/aduRentalTax.ts`: pure ADU assumption resolution, allocation, depreciation, participation, and allocation-conflict helpers.
- Create `src/domain/aduRentalTax.test.ts`: literal, hand-calculated unit tests for that module.
- Modify `src/domain/types.ts`: persisted `AduRentalTaxDetails`, extended `adu-build`, and projected rental-treatment/setup metadata.
- Modify `src/domain/index.ts`: export the new public ADU types and helpers used by UI and projections.
- Modify `src/domain/projection.ts`: apply ADU rent, shared expenses, depreciation, participation, and no-double-counting rules to current and planned homes.
- Modify `src/domain/projection.test.ts`: projection integration tests for owner-occupied homes, planned homes, conversions, and placed-in-service behavior.
- Modify `src/ScenarioPlanningDialog.tsx`: edit and validate nested ADU rental-tax assumptions.
- Modify `src/ScenarioPlanningDialog.test.tsx`: editor behavior, legacy loading, conditional questions, and saved payload tests.
- Modify `src-tauri/src/lib.rs`: validate and round-trip nested ADU rental-tax JSON.
- Modify `src/domain/retirementProjection.ts`: consume projected rental-treatment/setup metadata and deduplicate scenario-level failures.
- Modify `src/domain/retirementProjection.test.ts`: Keep/Sell, passive classification, sale depreciation, and deduplication tests.
- Modify `src/RetirementView.tsx`: actionable ADU-specific setup callout and Edit ADU action.
- Modify `src/RetirementView.test.tsx`: visible callout and routing tests.
- Modify `src/App.tsx`: route a Retirement ADU action to `ScenarioPlanningDialog` with `focusedEventId`.
- Modify `src/App.test.tsx`: end-to-end Retirement-to-ADU-editor routing test.
- Modify `README.md`: disclose primary-home ADU allocation and depreciation support.

---

### Task 1: Define and Resolve ADU Rental-Tax Assumptions

**Files:**
- Create: `src/domain/aduRentalTax.ts`
- Create: `src/domain/aduRentalTax.test.ts`
- Modify: `src/domain/types.ts:35-90`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes: existing `BasisPoints`, `Cents`, and `ScenarioEvent` primitives.
- Produces: `AduRentalTaxDetails`, `AduBuildEvent`, `ResolvedAduRentalTax`, `resolveAduRentalTax(event)`, `allocateAduSharedExpense(cents, resolved)`, and `combinedRentalUseExceedsFullUse(wholeHomeRentalUseBps, resolved)`.

- [ ] **Step 1: Add failing tests for square-footage allocation, override, basis, participation, and validation**

Add tests equivalent to:

```ts
import { describe, expect, test } from "vitest";
import {
  allocateAduSharedExpense,
  combinedRentalUseExceedsFullUse,
  resolveAduRentalTax,
} from "./aduRentalTax";
import type { AduBuildEvent } from "./types";

const event: AduBuildEvent = {
  id: "garage-adu",
  date: "2028-08-19",
  type: "adu-build",
  assetId: "home",
  name: "Garage ADU",
  costCents: 60_000_00,
  homeSquareFeet: 1_500,
  aduSquareFeet: 500,
  fundingAccountId: "cash",
  monthlyRentalIncomeCents: 2_000_00,
  rentalIncomeGrowthBps: 500,
  rentalTaxDetails: {
    rentalTaxModelingEnabled: true,
    rentalType: "long-term",
    longTermRealEstateProfessional: true,
    longTermMaterialParticipation: true,
  },
};

describe("ADU rental tax assumptions", () => {
  test("uses exact square-footage allocation and construction basis by default", () => {
    const resolved = resolveAduRentalTax(event);
    expect(resolved).toMatchObject({
      enabled: true,
      allocationNumerator: 500,
      allocationDenominator: 2_000,
      allocationBps: 2_500,
      buildingBasisCents: 60_000_00,
      monthlyDepreciationCents: 18_182,
      nonPassive: true,
    });
    expect(allocateAduSharedExpense(1_000_01, resolved)).toBe(25_000);
  });

  test("uses explicit allocation and basis overrides", () => {
    const resolved = resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        ...event.rentalTaxDetails!,
        rentalUseBpsOverride: 3_000,
        buildingBasisCentsOverride: 75_000_00,
      },
    });
    expect(resolved.allocationBps).toBe(3_000);
    expect(resolved.buildingBasisCents).toBe(75_000_00);
    expect(allocateAduSharedExpense(1_000_01, resolved)).toBe(30_000);
  });

  test("detects combined whole-home and ADU allocation above 100 percent", () => {
    expect(combinedRentalUseExceedsFullUse(8_000, resolveAduRentalTax(event)))
      .toBe(true);
  });

  test("requires the participation answer for the selected rental type", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        rentalTaxModelingEnabled: true,
        rentalType: "short-term",
      },
    })).toThrow("Short-term ADU tax modeling requires a material-participation answer");
  });
});
```

- [ ] **Step 2: Run the unit test and verify the contract is missing**

Run: `npm test -- --run src/domain/aduRentalTax.test.ts`

Expected: FAIL because `AduBuildEvent` and `./aduRentalTax` do not exist.

- [ ] **Step 3: Add the persisted types**

In `src/domain/types.ts`, define:

```ts
export interface AduRentalTaxDetails {
  rentalTaxModelingEnabled: boolean;
  rentalType: "long-term" | "short-term";
  rentalUseBpsOverride?: BasisPoints | null;
  buildingBasisCentsOverride?: Cents | null;
  mfsLivedApartAllYear?: boolean;
  shortTermMaterialParticipation?: boolean;
  longTermRealEstateProfessional?: boolean;
  longTermMaterialParticipation?: boolean;
}

export type AduBuildEvent = {
  id: string;
  date: string;
  type: "adu-build";
  assetId: string;
  name: string;
  costCents: Cents;
  homeSquareFeet: number;
  aduSquareFeet: number;
  fundingAccountId: string;
  fundingSources?: readonly EventFundingSource[];
  monthlyRentalIncomeCents?: Cents;
  rentalIncomeGrowthBps?: BasisPoints;
  rentalTaxDetails?: AduRentalTaxDetails;
};
```

Replace the inline `adu-build` union member with `AduBuildEvent`.

Extend `PropertyProjectionResult` with:

```ts
rentalTaxTreatment?: {
  sourceEventId: string;
  sourceName: string;
  rentalType: "long-term" | "short-term";
  nonPassive: boolean;
};
rentalTaxSetupIssue?: {
  sourceEventId: string;
  sourceName: string;
  message: string;
};
```

- [ ] **Step 4: Implement the pure resolver and allocation helpers**

In `src/domain/aduRentalTax.ts`, implement:

```ts
export interface ResolvedAduRentalTax {
  enabled: boolean;
  allocationNumerator: number;
  allocationDenominator: number;
  allocationBps: BasisPoints;
  buildingBasisCents: Cents;
  monthlyDepreciationCents: Cents;
  rentalType: "long-term" | "short-term";
  nonPassive: boolean;
}

export function resolveAduRentalTax(event: AduBuildEvent): ResolvedAduRentalTax;
export function allocateAduSharedExpense(
  cents: Cents,
  resolved: ResolvedAduRentalTax,
): Cents;
export function combinedRentalUseExceedsFullUse(
  wholeHomeRentalUseBps: BasisPoints,
  resolved: ResolvedAduRentalTax,
): boolean;
```

Use the override as the rational fraction `override / 10_000`; otherwise use `aduSquareFeet / (homeSquareFeet + aduSquareFeet)`. `allocateAduSharedExpense` must calculate `Math.round(cents * numerator / denominator)` so a rounded display percentage never feeds the tax calculation. Calculate monthly depreciation as `Math.round(buildingBasisCents / 330)` to match the existing 27.5-year monthly planning convention.

Return `enabled: false` without guessing participation when details are absent or disabled. Throw field-specific `RangeError`s for invalid enabled data, including zero rent, invalid overrides, negative basis, and absent conditional participation booleans.

- [ ] **Step 5: Export the new module and verify the unit tests**

Export the types and functions from `src/domain/index.ts`.

Run: `npm test -- --run src/domain/aduRentalTax.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit the domain contract**

```bash
git add src/domain/types.ts src/domain/aduRentalTax.ts src/domain/aduRentalTax.test.ts src/domain/index.ts
git commit -m "feat: define ADU rental tax assumptions"
```

---

### Task 2: Validate and Round-Trip ADU Tax Details in Tauri

**Files:**
- Modify: `src-tauri/src/lib.rs:2160-2365`
- Test: `src-tauri/src/lib.rs` test module

**Interfaces:**
- Consumes: the `AduRentalTaxDetails` JSON shape from Task 1.
- Produces: repository acceptance of valid nested details, legacy compatibility, and field-specific validation errors.

- [ ] **Step 1: Add a failing Rust round-trip and validation test**

Add `scenario_adu_rental_tax_details_round_trip_and_validate` beside the existing scenario tests. Build one `adu-build` JSON event with:

```rust
"rentalTaxDetails": {
    "rentalTaxModelingEnabled": true,
    "rentalType": "long-term",
    "rentalUseBpsOverride": 3000,
    "buildingBasisCentsOverride": 7500000,
    "longTermRealEstateProfessional": true,
    "longTermMaterialParticipation": true
}
```

Assert `store_scenario` followed by `bootstrap` returns the nested object unchanged. Then table-drive rejected variants for override `0`, override `10001`, basis `-1`, enabled rent `0`, absent long-term answers, and absent short-term material participation. Also store a legacy ADU without `rentalTaxDetails` and assert it still round-trips. Include a zero-cost ADU with a positive basis override and assert it is accepted, because the approved contract permits nonnegative construction cost.

- [ ] **Step 2: Run the Rust test and verify invalid details are accepted**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scenario_adu_rental_tax_details_round_trip_and_validate -- --nocapture`

Expected: FAIL on the first rejected variant because `adu-build` currently validates only money and square footage.

- [ ] **Step 3: Add nested ADU validation**

Inside the `kind == "adu-build"` branch, when `rentalTaxDetails` is present:

- Require an object.
- Require `rentalTaxModelingEnabled` to be a boolean.
- Accept only `long-term` and `short-term`.
- Validate a non-null `rentalUseBpsOverride` in `1..=10000`.
- Validate a non-null `buildingBasisCentsOverride` in `0..=MAX_MONEY_CENTS`.
- When enabled, require `monthlyRentalIncomeCents > 0`.
- When enabled and long-term, require both participation keys to exist as booleans.
- When enabled and short-term, require `shortTermMaterialParticipation` to exist as a boolean.

Change the `adu-build` top-level money rule from positive to nonnegative `costCents` while retaining the global maximum. Do not require the nested object for legacy events.

- [ ] **Step 4: Verify focused Rust tests and formatting**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml scenario_adu_rental_tax_details_round_trip_and_validate -- --nocapture`

Expected: PASS.

- [ ] **Step 5: Commit persistence validation**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: validate ADU rental tax payloads"
```

---

### Task 3: Add Rental-Tax Assumptions to the ADU Plan Editor

**Files:**
- Modify: `src/ScenarioPlanningDialog.tsx:45-125,808-1270`
- Modify: `src/ScenarioPlanningDialog.test.tsx`

**Interfaces:**
- Consumes: `AduBuildEvent.rentalTaxDetails` and `resolveAduRentalTax(event)` from Task 1.
- Produces: a complete nested ADU payload and a focused editor that preserves legacy event values.

- [ ] **Step 1: Add a failing editor test for the automatic default and conditional questions**

Create a current-home ADU record with positive rent and no `rentalTaxDetails`, render with `focusedEventId="garage-adu"`, and assert:

```ts
expect(screen.getByRole("heading", { name: "Rental tax assumptions" }))
  .toBeInTheDocument();
expect(screen.getByText("25% automatic allocation"))
  .toBeInTheDocument();
expect(screen.getByText(/Complete ADU tax assumptions/))
  .toBeInTheDocument();

fireEvent.click(screen.getByLabelText(
  "Include ADU rental income taxes, deductions, and depreciation",
));
fireEvent.change(screen.getByLabelText("ADU rental type"), {
  target: { value: "short-term" },
});
expect(screen.getByLabelText("Materially participate in the ADU rental"))
  .toBeInTheDocument();
expect(screen.queryByLabelText("Qualify as a real-estate professional"))
  .not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused editor test and verify the section is absent**

Run: `npm test -- --run src/ScenarioPlanningDialog.test.tsx -t "edits ADU rental tax assumptions"`

Expected: FAIL because the ADU editor has no rental-tax section.

- [ ] **Step 3: Teach `eventFields` to load nested ADU values**

For `value.type === "adu-build"`, populate these draft keys:

```ts
adu.rentalTaxModelingEnabled
adu.rentalType
adu.rentalUseBpsOverride
adu.buildingBasisCentsOverride
adu.mfsLivedApartAllYear
adu.shortTermMaterialParticipation
adu.longTermRealEstateProfessional
adu.longTermMaterialParticipation
```

Preserve blank overrides as blank strings. Do not synthesize enabled details for a legacy event.

- [ ] **Step 4: Render and validate the ADU tax section**

When parsed monthly rent is greater than zero, render a `fieldset` with legend `Rental tax assumptions`. Show the exact automatic allocation computed from the two square-footage drafts. Label the event date as `Completed and ready to rent` for ADUs.

Render:

- Enable checkbox.
- `ADU rental type` select.
- Conditional participation checkboxes.
- Optional `Shared-expense allocation override (%)`.
- Read-only construction-cost default explanation.
- Optional `ADU depreciable basis override (USD)`.
- Planning-estimate disclosure.

On submit, parse `costCents` with `nonnegativeMoney` rather than the positive-only `m` helper. Create `rentalTaxDetails` only when rent is positive and either the enable control or a nested field was deliberately supplied. Use `null` for blank overrides. Reject enabled details until the conditional booleans have explicit answers; use a yes/no select or radio group rather than an unchecked checkbox where `false` must be distinguishable from unanswered.

- [ ] **Step 5: Assert the exact saved nested payload**

Complete the test by selecting short-term, answering material participation `No`, entering `30%` and `$75,000`, saving the event and plan, then assert:

```ts
expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({
  events: [expect.objectContaining({
    id: "garage-adu",
    type: "adu-build",
    rentalTaxDetails: {
      rentalTaxModelingEnabled: true,
      rentalType: "short-term",
      rentalUseBpsOverride: 3_000,
      buildingBasisCentsOverride: 75_000_00,
      shortTermMaterialParticipation: false,
      mfsLivedApartAllYear: false,
    },
  })],
}));
```

- [ ] **Step 6: Verify all dialog tests and build**

Before running the suite, add a save-failure case in which `updateScenario` rejects once. Assert the ADU draft values remain visible, the error is announced, and retrying submits the same nested details successfully.

Run: `npm test -- --run src/ScenarioPlanningDialog.test.tsx && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit the editor**

```bash
git add src/ScenarioPlanningDialog.tsx src/ScenarioPlanningDialog.test.tsx
git commit -m "feat: edit ADU rental tax assumptions"
```

---

### Task 4: Tax-Model an ADU on an Owner-Occupied Current Home

**Files:**
- Modify: `src/domain/projection.ts:100-360`
- Modify: `src/domain/projection.test.ts:170-210`

**Interfaces:**
- Consumes: `resolveAduRentalTax`, `allocateAduSharedExpense`, and extended `PropertyProjectionResult` from Task 1.
- Produces: monthly current-home property rows with ADU tax character, allocated deductions, depreciation, and setup metadata.

- [ ] **Step 1: Add a failing literal projection test for the user's primary-home case**

Use a current home with zero growth, $1,000 monthly mortgage interest, $500 property tax, $100 insurance, $50 HOA, $150 maintenance, a 1,500 sq. ft. home, and a 500 sq. ft. $60,000 ADU producing $2,000 monthly rent. Enable long-term non-passive treatment.

For the first full month, assert:

```ts
expect(property.status).toBe("owner-occupied");
expect(property.aduIncomeCents).toBe(2_000_00);
expect(property.rentalUseBps).toBe(2_500);
expect(property.depreciationCents).toBe(18_182);
expect(property.taxableRentalCents).toBe(136_818);
expect(property.rentalTaxModelingEnabled).toBe(true);
expect(property.rentalTaxTreatment).toEqual({
  sourceEventId: "garage-adu",
  sourceName: "Garage ADU",
  rentalType: "long-term",
  nonPassive: true,
});
expect(month.housing).toEqual({
  principalCents: expect.any(Number),
  interestCents: 1_000_00,
  propertyTaxCents: 500_00,
  insuranceCents: 100_00,
  hoaCents: 50_00,
  maintenanceCents: 150_00,
});
```

The hand calculation is `$2,000 - 25% × ($1,000 + $500 + $100 + $50 + $150) - $181.82 = $1,368.18`. Full housing cash expenses remain in cash flow; only tax deductions are allocated.

- [ ] **Step 2: Verify the projection currently marks ADU tax modeling disabled**

Run: `npm test -- --run src/domain/projection.test.ts -t "tax-models an ADU without converting the primary home"`

Expected: FAIL because current-home ADUs only inherit tax details from `property-rental-start`.

- [ ] **Step 3: Resolve current-home ADU treatment in the monthly property row**

For each active current-home ADU:

- Resolve its nested details independently of a whole-home rental event.
- Grow ADU rent from the ADU placed-in-service month.
- Allocate mortgage interest and all shared operating expenses through `allocateAduSharedExpense`.
- Add ADU depreciation.
- Populate `rentalTaxTreatment` when enabled.
- Populate `rentalTaxSetupIssue` with source event ID/name and `Complete rental tax assumptions for <ADU name>.` when positive rent lacks enabled complete details.
- Keep `status: "owner-occupied"` when no whole-home conversion exists.

Use `taxableRentalCents` for the second projection tax pass. Do not subtract allocated deductions from cash `housing` or `expenseCents`.

- [ ] **Step 4: Add placed-in-service and legacy behavior tests**

Assert no ADU rent or depreciation before the event month, both begin in the event month, and a legacy positive-rent ADU produces one `rentalTaxSetupIssue` while leaving gross rent visible.

- [ ] **Step 5: Verify projection tests**

Run: `npm test -- --run src/domain/aduRentalTax.test.ts src/domain/projection.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit current-home projection support**

```bash
git add src/domain/projection.ts src/domain/projection.test.ts
git commit -m "feat: tax-model primary home ADU income"
```

---

### Task 5: Support Planned Homes and Prevent Rental Double Counting

**Files:**
- Modify: `src/domain/projection.ts:105-265`
- Modify: `src/domain/projection.test.ts`

**Interfaces:**
- Consumes: Task 4's property-row ADU behavior and `combinedRentalUseExceedsFullUse` from Task 1.
- Produces: identical ADU semantics for planned purchases plus an explicit allocation-conflict failure.

- [ ] **Step 1: Add failing tests for a planned primary home with an ADU**

Create an `asset-purchase` marked `primaryResidence: true`, followed by an `adu-build` with enabled ADU tax details. Assert the purchased home stays active/primary, ADU rent and depreciation begin only after the build, and `taxableRentalCents` equals the same hand-calculated formula used for a current home.

- [ ] **Step 2: Add a failing no-double-counting test**

Create a current home with a 25% ADU allocation and a later whole-home `property-rental-start` with `rentalUseBps: 75%`. Assert combined rent includes each source once, combined shared deductions equal 100%, and ADU depreciation remains separate from whole-home depreciation.

Add a second case with whole-home `rentalUseBps: 80%`; assert projection throws:

```text
Combined rental-use allocation for Home exceeds 100%.
```

- [ ] **Step 3: Run both focused tests and verify planned ADUs or conflicts fail**

Run: `npm test -- --run src/domain/projection.test.ts -t "planned primary home ADU|does not double-count ADU rental use"`

Expected: FAIL because planned-property ADUs currently read purchase details only and allocation conflicts are not checked.

- [ ] **Step 4: Unify current and planned ADU lookup**

Index funded `adu-build` events by asset and month. Apply the same Task 4 resolver whether the asset originates in the snapshot or an `asset-purchase` event. Preserve the property purchase's own rent and tax details independently.

When a whole-home conversion/purchase rental allocation and an enabled ADU overlap, call `combinedRentalUseExceedsFullUse`. Throw the exact structured message above on conflict. Allocate shared expenses to each activity once and sum their taxable income; never apply the whole-home allocation to ADU rent.

- [ ] **Step 5: Verify the complete projection suite**

Run: `npm test -- --run src/domain/projection.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit planned-home and conflict support**

```bash
git add src/domain/projection.ts src/domain/projection.test.ts
git commit -m "feat: compose ADU and home rental taxes"
```

---

### Task 6: Propagate ADU Tax Character Through Home Sale and Retirement

**Files:**
- Modify: `src/domain/retirementProjection.ts:700-780,1280-1350`
- Modify: `src/domain/retirementProjection.test.ts`
- Test existing behavior in: `src/domain/retirementSnapshot.ts:300-365`

**Interfaces:**
- Consumes: projected `depreciationCents`, `rentalTaxTreatment`, and `rentalTaxSetupIssue` from Tasks 4-5.
- Produces: Keep/Sell projections that use ADU tax character, include accumulated ADU depreciation in sales, and emit one actionable setup warning.

- [ ] **Step 1: Add a failing Keep Homes test for enabled ADU tax treatment**

Model the user's shape: owner-occupied `Home`, a non-passive long-term `Garage ADU`, retirement after the ADU is in service, and no whole-home rental event. Assert Keep is available, rental income includes the ADU, estimated tax is nonzero, and no `unsupported-rental-tax` warning exists.

- [ ] **Step 2: Add a failing Sell All Homes depreciation test**

Use zero opening accumulated depreciation and a literal number of projected ADU months. Assert the `HomeSaleTaxItem`/Sell result includes exactly `months × monthlyDepreciationCents` as projected depreciation and stops ADU rent/depreciation after sale. Assert no separate ADU sale proceeds are created.

- [ ] **Step 3: Add a failing legacy-warning deduplication test**

Project a 30-year retirement with one legacy rented ADU. Assert:

```ts
expect(result.keepHomes.available).toBe(false);
expect(result.keepHomes.warnings.filter((warning) =>
  warning.code === "unsupported-rental-tax"
)).toEqual([expect.objectContaining({
  entityId: "garage-adu",
  message: "Complete rental tax assumptions for Garage ADU.",
})]);
```

- [ ] **Step 4: Run the focused Retirement tests and verify current event inference fails**

Run: `npm test -- --run src/domain/retirementProjection.test.ts -t "primary-home ADU|deduplicates missing ADU tax setup"`

Expected: FAIL because Retirement recognizes only purchase and whole-home rental events and warning identity includes the year.

- [ ] **Step 5: Consume projection metadata instead of re-reading scenario events**

Replace the `RentalTreatmentEvent` lookup in `runRetirementScenario` with `property.rentalTaxTreatment` and `property.rentalTaxSetupIssue`.

- If `rentalTaxSetupIssue` exists, create `unsupported-rental-tax` with its source event ID and message.
- If enabled treatment is non-passive, allow negative taxable rental income under the existing rule.
- If passive negative income or unresolved authoritative carryforwards cannot be modeled, retain the existing unavailable behavior with an ADU-specific message.
- Do not reproduce allocation or depreciation formulas in Retirement.

Change scenario-level failure deduplication so `unsupported-rental-tax` setup warnings dedupe by `code + entityId + message`, excluding year. Preserve year in operational warnings such as depletion and calculation failures.

- [ ] **Step 6: Verify sale, cutoff, and Retirement suites**

Run: `npm test -- --run src/domain/retirementCutoff.test.ts src/domain/retirementSnapshot.test.ts src/domain/retirementProjection.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Retirement propagation**

```bash
git add src/domain/retirementProjection.ts src/domain/retirementProjection.test.ts
git commit -m "feat: propagate ADU taxes through retirement"
```

---

### Task 7: Make Missing ADU Setup Actionable From Retirement

**Files:**
- Modify: `src/RetirementView.tsx:20-45,620-690,834-935`
- Modify: `src/RetirementView.test.tsx`
- Modify: `src/App.tsx:720-770,1180-1210`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `unsupported-rental-tax` warning with ADU event ID from Task 6 and existing `ScenarioPlanningDialog.focusedEventId`.
- Produces: `RetirementViewProps.onEditPlanEvent(eventId, invoker)` and an end-to-end Edit ADU route.

- [ ] **Step 1: Add a failing RetirementView action test**

Render an unavailable Keep projection containing:

```ts
{
  code: "unsupported-rental-tax",
  entityId: "garage-adu",
  message: "Complete rental tax assumptions for Garage ADU.",
}
```

Pass `onEditPlanEvent={vi.fn()}`, assert the Details needed panel contains the message exactly once, click `Edit Garage ADU`, and assert the callback receives `"garage-adu"` plus the button element.

- [ ] **Step 2: Run the focused view test and verify no action exists**

Run: `npm test -- --run src/RetirementView.test.tsx -t "edits the ADU that blocks Keep homes"`

Expected: FAIL because the callout renders plain warning text only.

- [ ] **Step 3: Add the focused callback and deduplicated presentation**

Extend `RetirementViewProps`:

```ts
onEditPlanEvent?: (eventId: string, invoker: HTMLElement) => void;
```

In the Keep `Details needed` panel, deduplicate identical issue/warning messages before rendering. For `unsupported-rental-tax` warnings whose `entityId` matches an `adu-build` event, render `Edit <event.name>` and invoke the callback with that event ID. Keep non-routable warnings as text.

- [ ] **Step 4: Add a failing end-to-end App routing and completion test**

Name the test `completes primary-home ADU tax setup without converting the home`. Use an App fixture with an owner-occupied current home and a legacy Garage ADU, then exercise this sequence using real components and only the repository boundary mocked:

1. Open Retirement and assert the Garage ADU setup warning appears once.
2. Click `Edit Garage ADU` and assert `Edit dated event` opens with the existing event values.
3. Enable tax modeling, keep the automatic allocation, choose long-term, and answer both participation questions.
4. Save the event and Plan; assert `updateScenario` receives the complete nested payload while no `property-rental-start` event is added.
5. Rerender from the exact saved repository payload and a projection fixture that reflects enabled ADU treatment.
6. Assert Keep Homes has financial headlines, no ADU setup warning, and Plan still labels the home owner-occupied.

Run: `npm test -- --run src/App.test.tsx -t "completes primary-home ADU tax setup without converting the home"`

Expected: FAIL at the missing `Edit Garage ADU` action or because App does not route the callback.

- [ ] **Step 5: Wire App to the existing scenario dialog route**

Pass a callback from `App` to `RetirementView` that calls:

```ts
openDialog({
  type: "scenario-plan",
  scenario: bootstrap.scenarios.find((item) => item.id === selectedScenario.id),
  focusedEventId: eventId,
}, invoker);
```

Do not create a Retirement-local copy of the ADU assumptions.

- [ ] **Step 6: Add minimal callout/action styling and verify UI suites**

Use the existing card, action-button, focus, and mobile patterns. Do not introduce a new visual system.

Run: `npm test -- --run src/ScenarioPlanningDialog.test.tsx src/RetirementView.test.tsx src/App.test.tsx && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit actionable routing**

```bash
git add src/RetirementView.tsx src/RetirementView.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: route ADU tax setup from retirement"
```

---

### Task 8: Document and Verify the Complete ADU Tax Journey

**Files:**
- Modify: `README.md:48-66`

**Interfaces:**
- Consumes: all prior tasks and their end-to-end regression.
- Produces: user-facing capability documentation and fresh full-suite evidence.

- [ ] **Step 1: Document the supported behavior**

Update the Plan/Retirement README paragraphs to state that an owner-occupied primary home may contain a separately tax-modeled ADU; shared expenses default to square-footage allocation, the ADU construction basis depreciates separately, and results remain planning estimates.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all JavaScript/TypeScript and Rust tests pass, the production build completes, formatting is clean, and `git diff --check` reports no errors. The existing Vite chunk-size advisory may remain if it is the only warning.

- [ ] **Step 3: Review the user's exact scenario against success criteria**

Confirm from the test fixture and implementation—not by mutating the user's database—that:

- `Home` remains owner-occupied.
- `Garage ADU` begins rent and depreciation in August 2028.
- Default allocation is `500 / (1500 + 500) = 25%` for the fixture.
- Construction cost supplies default ADU basis.
- Keep Homes becomes available after assumptions are completed.
- Sell All Homes stops ADU activity and carries accumulated depreciation into sale tax.
- The missing-setup warning appears once and routes to the source event.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain primary home ADU tax planning"
```
