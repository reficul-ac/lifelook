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

## Review Fix Round 1

### Findings Addressed

- Current-home persistence now sends each acquisition field only when that field is absent from the authoritative asset. The stateful App contract test rejects any attempt to resend an existing price or date and verifies the refreshed UI is complete.
- Editor identity now includes the authoritative planned-purchase event and its source facts, including inferred eligibility. A changed purchase or inference remounts clean source state, while a rejected save retains its draft only for the unchanged source. Submit derives hidden eligibility from current props.
- The collapsed read-only audit now labels eligibility and both federal and California accumulated depreciation values.
- App and the home-sale editor now share the exact money parser and `99_999_999_999_999`-cent ceiling. The editor retains its stricter positive-price and non-negative-depreciation rules.
- A committed write followed by a failed bootstrap is reported as saved-but-not-reloaded. Its retry calls bootstrap only, so it cannot repeat a stale-revision mutation.

### Strict TDD Evidence

Immutable current-home acquisition fields:

- RED: `npm test -- --run src/App.test.tsx -t "without resending immutable"`
- Result: both selected cases failed. The price-present case received `purchasePriceCents: 45000000`; the date-present case received `purchaseDate: "2020-06-01"`, although the native `update_asset` contract requires each recorded field to be absent.
- GREEN: the same focused command passed 2 selected tests after conditional payload construction. The stateful fake applies the mutation, increments the revision, and returns refreshed bootstrap state used by the UI assertions.

Planned-purchase identity and current inference:

- RED: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx -t "resets a rejected draft|resets changed inference"`
- Result: both selected tests failed because the prior persistence alert and stale draft survived a retirement-date rerender that selected a different purchase or changed the inferred answer.
- GREEN: the same focused command passed 2 selected tests after keying by source fingerprint and deriving hidden eligibility from current props.

Complete inherited assumption audit:

- RED: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx -t "shows inherited"`
- Result: failed because `Primary-home gain exclusion` was absent from the no-interaction audit.
- GREEN: the same focused command passed after rendering eligibility plus federal and California depreciation labels and values.

Shared money ceiling:

- RED: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx -t "shared maximum"`
- Result: the exact maximum case passed, but the over-limit case failed because no validation alert appeared and persistence was attempted.
- GREEN: the same focused command passed 2 selected tests after sharing App's exact parser.
- Regression RED: `npm test -- --run src/RetirementHomeSaleDetails.test.tsx -t "keeps accumulated depreciation"` failed because the shared signed parser accepted negative depreciation.
- Regression GREEN: the focused test passed after explicit non-negative depreciation guards were restored.

Committed-write reload retry:

- RED: `npm test -- --run src/App.test.tsx -t "retries only bootstrap"`
- Result: failed because the UI reported `Sale details could not be saved. Retry when ready.` after the mutation had committed.
- GREEN: the same focused command passed after distinguishing reload failure; the test verifies one asset update, two bootstrap calls before retry, three after retry, refreshed Complete state, and still exactly one asset update.

### Final Fresh Verification After Review Fixes

- `npm test -- --run src/RetirementHomeSaleDetails.test.tsx src/RetirementView.test.tsx src/App.test.tsx && npm run build`
- PASS: 3 files, 79 tests; TypeScript project build and Vite production build passed, exit 0.
- `git diff --check`
- PASS: no whitespace errors.

### Review Fix Self-Review and Concerns

- No blocking concerns found. The reload-only retry is intentionally available only after the repository write has fulfilled, and the draft remains visible until refreshed authoritative data arrives.
- The unrelated pre-existing `.superpowers/brainstorm/` working-tree content remains untouched and will not be staged.
