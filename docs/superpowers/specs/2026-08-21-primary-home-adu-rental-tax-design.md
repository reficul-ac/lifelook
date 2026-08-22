# Primary-Home ADU Rental Tax Design

**Date:** 2026-08-21

**Status:** Approved

## Goal

Allow an income-producing ADU on an owner-occupied primary home to participate in Plan, home-sale, and Retirement tax projections without classifying the whole home as a rental.

The ADU remains part of the existing home asset. Its rental activity has a distinct tax character, expense allocation, depreciable basis, placed-in-service date, participation status, and passive-loss treatment.

## Scope

This change covers:

- ADUs attached to or associated with a currently owned home.
- ADUs on homes created by a planned property purchase.
- Long-term and short-term ADU rental classification.
- Shared home-expense allocation.
- ADU construction-basis depreciation.
- Existing federal and California passive-activity modeling.
- Accumulated depreciation in modeled home sales.
- Plan and Retirement guidance for incomplete ADU tax data.

This change does not add:

- Separate ADU ownership or valuation.
- Separate ADU debt.
- Daily occupancy or less-than-15-day rental modeling.
- Detailed repair, utility, or property-management expense ledgers.
- Tax-return preparation.

## Source Guidance and Planning Boundary

IRS Publication 527 permits reasonable allocation of shared expenses between personal and rental use and identifies room count and square footage as common methods. IRS Publication 946 treats an addition or improvement as separate depreciable property. LifeLook will use those principles for a deterministic planning estimate, not tax-return preparation.

References:

- [IRS Publication 527, Residential Rental Property](https://www.irs.gov/pub/irs-pdf/p527.pdf)
- [IRS Publication 946, How To Depreciate Property](https://www.irs.gov/publications/p946)

## Chosen Architecture

Extend the existing `adu-build` scenario event with nested rental-tax details. Do not create a second asset and do not synthesize a hidden whole-home rental conversion.

This preserves one source of truth for home value, mortgage, ownership, and sale while giving the ADU rental activity a clear calculation boundary.

## Data Model

Add an optional `rentalTaxDetails` object to `adu-build` events:

```ts
interface AduRentalTaxDetails {
  rentalTaxModelingEnabled: boolean;
  rentalType: "long-term" | "short-term";
  rentalUseBpsOverride?: BasisPoints | null;
  buildingBasisCentsOverride?: Cents | null;
  mfsLivedApartAllYear?: boolean;
  shortTermMaterialParticipation?: boolean;
  longTermRealEstateProfessional?: boolean;
  longTermMaterialParticipation?: boolean;
}
```

The existing `adu-build` fields remain authoritative for:

- Event date and placed-in-service month.
- Home and ADU square footage.
- Construction cost.
- Monthly rental income.
- Rental-income growth.
- Funding sources.

### Derived defaults

When an override is absent:

- Shared-expense allocation is `aduSquareFeet / (homeSquareFeet + aduSquareFeet)`.
- Depreciable ADU building basis is `costCents`.
- Placed-in-service month is the event month.

The calculation must retain full precision through the ratio and round only the resulting cent amounts. The surfaced percentage uses basis-point rounding for display.

### Validation

The TypeScript domain and Rust persistence boundary must enforce matching rules:

- Home and ADU square footage are positive integers.
- Rental income, construction cost, and basis overrides are nonnegative integer cents.
- A rental-use override is between 1 and 10,000 basis points.
- Tax modeling cannot be enabled when monthly ADU rental income is zero.
- Enabled long-term modeling requires both real-estate-professional and material-participation answers.
- Enabled short-term modeling requires the short-term material-participation answer.
- Unknown fields continue to be rejected or normalized according to the existing scenario-event boundary.

### Persistence and compatibility

Scenario payloads are stored as JSON, so no new SQLite columns are required. Rust serialization and validation must accept the nested object and continue accepting legacy `adu-build` payloads without it.

Legacy income-producing ADUs remain valid saved events. They load with tax modeling unresolved and receive a setup prompt. Migration must not guess participation status or silently enable tax calculations.

## Projection Model

### Property identity

The home stays owner-occupied unless a separate `property-rental-start` event explicitly converts it. An ADU rental does not change the home's primary-residence status.

The property projection must track whole-home and ADU rental activity separately even though both share one asset ID.

### Monthly ADU calculation

Beginning in the ADU event month:

1. Grow gross ADU rent from `monthlyRentalIncomeCents` using the existing rental-income growth convention.
2. Resolve the ADU allocation ratio from the manual override or square-footage default.
3. Allocate mortgage interest, property tax, insurance, HOA, and maintenance by that ratio.
4. Calculate ADU depreciation from the resolved ADU building basis using the existing residential-rental convention.
5. Calculate taxable ADU income as gross ADU rent minus allocated shared expenses and ADU depreciation.
6. Apply the existing federal and California passive-activity rules using the ADU's rental type and participation answers.
7. Preserve the unallocated home expenses as personal housing expenses.

The ADU calculation must not allocate mortgage principal as a rental expense.

### Interaction with whole-home rental conversion

If the home is later converted to a rental, the engine must keep the ADU improvement basis distinct while preventing duplicate rent, expenses, and depreciation.

The whole-home rental allocation excludes the portion already assigned to the ADU. The combined allocation may not exceed 100%. If saved events conflict, the projection returns a structured validation warning rather than clipping silently.

### Passive losses

ADU taxable income enters the same federal and California passive-loss machinery used for other rentals. ADU activity must preserve separate current-year values so participation classification can be evaluated before household totals are composed.

Existing asset-level passive-loss carryforwards remain associated with the home asset. This change does not invent an allocation of historical carryforwards between the home and ADU; unresolved historical provenance must remain unavailable rather than guessed.

### Home sale

Projected ADU depreciation accumulates from the placed-in-service month through disposition. Home-sale calculations receive that accumulated federal and California depreciation in addition to any authoritative opening depreciation already saved for the home.

The home remains a single sale. The model must not create separate ADU proceeds. Primary-residence exclusion eligibility remains an explicit home-sale assumption and must not be inferred solely from ADU rental use.

### Retirement

Keep Homes consumes the tax-modeled ADU rent, expenses, depreciation, passive treatment, and carryforwards. Sell All Homes stops ADU rent and depreciation when the home is sold and includes accumulated ADU depreciation in the sale calculation.

An income-producing ADU with missing tax details produces an unavailable tax-dependent projection with one actionable warning for that ADU. The warning must not repeat once per retirement year.

## UI Design

### Plan ADU editor

When monthly ADU rent is greater than zero, show a `Rental tax assumptions` section containing:

- An enabled/disabled tax-modeling control.
- The automatic square-footage allocation and calculated percentage.
- An optional manual allocation override.
- Long-term or short-term rental selection.
- Conditional participation questions matching the selected rental type.
- Construction cost as the default depreciable basis.
- An optional depreciable-basis override.
- A concise disclosure that the result is a planning estimate.

The event date is labeled to make clear that it is when the ADU is completed and ready to rent. Rent and depreciation start in that month.

### Existing ADUs

An existing rented ADU without tax details displays `Complete ADU tax assumptions`. Editing it opens the existing ADU Plan editor focused on the missing section. Existing construction and rent assumptions are preserved.

### Retirement guidance

Keep Homes names the affected ADU and states which tax assumptions are missing. When routing is available, the callout includes an Edit ADU action that opens the source Plan event. The card must never show unexplained `Unavailable` values.

Warnings are deduplicated by actionable cause, code, and entity for scenario-level setup. Year remains part of genuinely year-specific operational warnings.

## Error Handling

- Invalid persisted nested values are rejected at the repository boundary with field-specific validation messages.
- Legacy missing data produces setup guidance, not a crash.
- Conflicting ADU and whole-home allocation produces a structured calculation warning.
- Missing passive-loss provenance remains unavailable and is disclosed.
- Save failures retain the edited ADU draft and expose the existing retry behavior.

## Component Boundaries

- `src/domain/types.ts`: event contract only.
- `src/domain/projection.ts`: monthly allocation, depreciation, rental tax character, and no-double-counting rules.
- Focused domain helpers may be extracted for ADU allocation and validation if doing so keeps the projection loop small and independently testable.
- `src/domain/retirementProjection.ts`: consume property tax results and deduplicate scenario-level setup failures; do not reproduce ADU formulas.
- `src/App.tsx`: ADU editor state, validation messages, and focused routing.
- `src-tauri/src/lib.rs`: persisted JSON validation and round-trip compatibility.
- Retirement view components: actionable presentation and routing only.

## Testing

### Domain tests

- Owner-occupied primary home with an income-producing ADU and no whole-home rental conversion.
- Automatic square-footage allocation with literal hand-calculated values.
- Manual allocation override.
- Construction cost and basis-override depreciation.
- Placed-in-service month behavior.
- Long-term and short-term participation branches.
- Federal and California passive-loss behavior.
- Whole-home conversion after an ADU without duplicate rent, expenses, or depreciation.
- Allocation conflicts return a structured failure.
- Home-sale depreciation propagation.
- Keep and Sell Retirement propagation.
- One scenario-level missing-ADU warning across a multi-year horizon.

### Persistence tests

- Full nested details round-trip.
- Legacy ADU payload round-trip.
- Bounds, cents, rental-type, and conditional participation validation.

### UI tests

- Conditional rental-tax section for positive ADU rent.
- Automatic allocation explanation.
- Manual override entry.
- Conditional participation controls.
- Existing ADU setup prompt.
- Retirement Edit ADU routing.
- No unexplained Keep Homes unavailability.
- No repeated identical ADU warnings.

## Success Criteria

- The user's primary home remains owner-occupied.
- Its Garage ADU produces tax-modeled rental income from its ready-to-rent date.
- Shared expenses use the approved square-footage default unless overridden.
- ADU construction basis depreciates separately.
- Participation answers drive passive treatment.
- Plan, home-sale, Keep Homes, and Sell All Homes agree on ADU tax character.
- Existing saved scenarios remain readable.
- Missing setup is specific, actionable, and deduplicated.
