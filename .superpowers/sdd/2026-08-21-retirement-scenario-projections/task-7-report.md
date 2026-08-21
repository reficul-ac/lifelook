# Task 7 Report: Annual Projection Table and Warnings

## Delivered

- Added `RetirementProjectionTable`, a semantic, horizontally scrollable annual table driven exclusively by domain projection fields.
- Added per-year disclosures for housing, rental income, sale values, withdrawal sources, and domain warnings with year/entity context.
- Wired `RetirementView` to render only the selected Keep or Sell projection; unavailable Sell surfaces its per-home issues and calculation exceptions remove the table with the existing page-level alert.
- Added responsive styles for sticky year context, tabular nowrap values, warnings, and 44px phone disclosure controls.

## Staged TDD evidence

1. Annual columns RED: `npm test -- --run src/RetirementProjectionTable.test.tsx` failed because `./RetirementProjectionTable` did not exist. GREEN: 2 table tests passed after the semantic table implementation.
2. Detail/warning RED: the focused table suite failed three tests because no `View year details` control existed. GREEN: all 5 table tests passed after the disclosure implementation.
3. Availability/error-clearing RED: `npm test -- --run src/RetirementView.test.tsx` failed two tests because no annual table was rendered by the view. GREEN: all 31 view tests passed after selected-scenario wiring.

## Final verification

`npm test -- --run src/RetirementProjectionTable.test.tsx src/RetirementView.test.tsx && npm run build`

- 36 focused tests passed.
- TypeScript and Vite production build passed.
- Vite emitted its existing advisory for a minified JavaScript chunk over 500 kB; this task did not add code splitting.

## Self-review

- The React layer formats and selects supplied fields but does not calculate projection totals or formulas.
- Table headers/caption/scopes, signed accessible shortfall copy, one detail control per year, and full-width following detail rows are present.
- `git diff --check` reported no whitespace errors before commit.

## Review fix round 1

### Staged TDD evidence

1. Projection table RED: after adding production-shaped unavailable, disclosure, warning, and money tests, `npm test -- --run src/RetirementProjectionTable.test.tsx` reported 6 failures. They identified indistinguishable controls and missing targets, raw cent warning text, signed zero/rounded cents, and omitted unavailable warnings. GREEN: the 8 table tests passed after rendering every detail target hidden until expanded, assigning a year-specific accessible control name, preserving cents, and rendering unavailable warnings alongside issues.
2. Retirement view RED: `npm test -- --run src/RetirementView.test.tsx` reported the raw `recurring-consulting` warning entity ID. GREEN: all 32 view tests passed after passing a unified account/asset/recurring label map to the table.

### Review changes

- Warning-only unavailable results now render their `calculation-error` message as an actionable warning; unavailable results with both issues and warnings render both.
- All detail targets remain mounted with unique IDs while collapsed, and every control is uniquely named by year with a valid `aria-controls` relationship.
- Warning messages now format production `cents` counts as money and retain domain year/entity context.
- Exact money rendering keeps nonzero cents; a negative sign is applied only to nonzero values.

### Round 1 final verification

`npm test -- --run src/RetirementProjectionTable.test.tsx src/RetirementView.test.tsx && npm run build`

- 40 focused tests passed.
- TypeScript and Vite production build passed.
- Vite retained the advisory for a minified JavaScript chunk over 500 kB.
