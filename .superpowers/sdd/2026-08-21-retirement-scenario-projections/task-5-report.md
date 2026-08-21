# Task 5 Report: Shared-Source Home Sale Editing

## Status

Implemented, self-reviewed, and verified.

## Implementation

- Added `RetirementHomeSaleDetails` and the shared `HomeSaleSourcePatch` contract containing only purchase date, purchase price, and sale-tax assumptions.
- Displays per-home completeness plus inherited acquisition/sale inputs without opening the collapsed editor.
- Labels projected sale value and appreciation as Plan-derived read-only output; neither is included in persistence patches.
- Renders controls only for unresolved source facts and uses the existing exact-money, non-negative depreciation, and 0–100% selling-cost limits.
- Retains form drafts after rejected persistence and exposes an in-place retry action.
- Resolves the latest owned planned purchase event, conservatively derives the two-of-five-year primary-residence answer from purchase/primary-residence/rental history, and requests confirmation only when the source data is unknown.
- Gives an explicit saved eligibility answer precedence over Plan inference.
- Wires `RetirementView` to resolved retirement home rows and structured sale issues.
- Persists current homes through `repository.updateAsset` with the authoritative revision while preserving value and appreciation inputs.
- Persists planned homes through `repository.updateScenario`, cloning only the matching `asset-purchase` event and its `propertyDetails`; unrelated events retain their original object identity and byte content.
- Refreshes bootstrap through the existing `onRefresh` mutation path after either successful write.

## Strict TDD Evidence

Current-home editor:

- RED: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx`
- Expected failure: Vite could not resolve `./RetirementHomeSaleDetails` because the component did not exist.
- GREEN: 1 file, 2 tests.

Planned home, derivation, and retry:

- RED: the focused component run failed because `Eligible (inferred from Plan)` was absent and the editor still rendered a confirmation checkbox.
- GREEN: 1 file, 5 tests.

Authoritative App mutations:

- RED: `npm test -- --run src/App.test.tsx -t "persists retirement edits|clones only the matching planned-home"`
- Expected failures: both tests could not find their home-sale detail articles because `RetirementView` had no editor or source callbacks.
- GREEN: 1 file, 2 selected tests; the assertions cover exact asset revision payload, bootstrap refresh, cloned matching event, unchanged unrelated event identity/content, and unchanged source scenario JSON.

Self-review eligibility regression:

- RED: the saved explicit `false` answer was emitted as inferred `true`.
- Root cause: inferred eligibility was given precedence during draft initialization even when authoritative assumptions existed.
- GREEN: the guard and focused regression test preserve the saved answer; 1 selected test passed.

## Final Fresh Verification

- `npm test -- --run src/RetirementHomeSaleDetails.test.tsx src/RetirementView.test.tsx src/App.test.tsx && npm run build`
- PASS: 3 files, 72 tests; TypeScript project build and Vite production build passed, exit 0.
- `git diff --check`
- PASS: no whitespace errors.

## Files

- Created `src/RetirementHomeSaleDetails.tsx`.
- Created `src/RetirementHomeSaleDetails.test.tsx`.
- Modified `src/RetirementView.tsx`.
- Modified `src/App.tsx`.
- Modified `src/App.test.tsx`.
- Created this report only under `.superpowers`.

## Self-Review and Concerns

- No blocking concerns found. Source patches exclude projected values and appreciation; both repository paths use current revisions and reject errors back to the draft-preserving editor.
- Eligibility inference is intentionally conservative: absent planned primary-residence data remains unknown and requires confirmation.
- The unrelated pre-existing `.superpowers/brainstorm/` working-tree content was not touched or staged.
