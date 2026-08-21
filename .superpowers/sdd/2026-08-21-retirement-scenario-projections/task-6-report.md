# Task 6 Report: Retirement Settings and Selectable Overview Cards

## Status

Implemented, self-reviewed, and verified.

## Implementation

- Extended the autosave draft, retry reconstruction, and authoritative fingerprints across retirement month, withdrawal rate, horizon, taxable destination, withdrawal order, and selected scenario.
- Normalizes persisted settings against bootstrap accounts without saving on initial mount or on an own-save echo.
- Added a required integer `Years in retirement` control with the domain-supported 1–60 range.
- Auto-selects the sole taxable brokerage account, requires a choice among several eligible accounts, and gives an actionable Net Worth instruction when none exist.
- Added a compact `Withdrawal order` disclosure that shows every account in effective order with owner, tax class, retirement age/status, and accessible reorder buttons; `Use automatic order` clears the complete override.
- Replaced legacy snapshot headline sourcing with `calculateRetirementProjection`; both scenario cards and their calculation disclosures read the projection summaries.
- Made each scenario an article with a full-card sibling selection button, `aria-pressed`, visible Selected/Select text, and selected outline styling. Calculation and home-sale controls remain siblings above the selection surface rather than descendants of the button.
- Embedded the shared-source home-sale editor as a sibling control within the Sell article.
- Added responsive two-column desktop/one-column below 900px layouts, visible focus, and at least 44px phone controls.

## Strict TDD Evidence

Settings and autosave stage:

- RED: `npm test -- --run src/RetirementView.test.tsx`
- Result: 8 expected failures and 11 passes. Failures were all missing observable controls/states: horizon, single/multiple/no taxable destination behavior, and withdrawal order.
- GREEN: the same command passed 1 file, 19 tests after implementing only settings draft, controls, normalization, validation, serialization, and override behavior.

Selectable scenario-card stage:

- RED: `npm test -- --run src/RetirementView.test.tsx`
- Result: 2 expected failures and 19 passes. Selection buttons were absent and the UI still showed legacy snapshot rather than distinct projection values.
- GREEN: the same command passed 1 file, 21 tests after implementing article/button/sibling markup, selection autosave/restore, and domain-projection sourcing.

Each new test names the production mutation it catches. Coverage asserts rendered controls, validity, payloads, ordering, accessible state, sibling DOM structure, persisted restoration, and distinct hand-checked projection values rather than mock presence.

## Final Fresh Verification

- `npm test -- --run src/RetirementView.test.tsx src/App.test.tsx && npm run build`
- PASS: 2 files, 77 tests; TypeScript project build and Vite production build passed, exit 0.
- `npm test`
- PASS: full JavaScript suite, 16 files and 339 tests, exit 0.
- `git diff --check`
- PASS: no whitespace errors.
- Vite reported its non-blocking existing advisory that the main minified chunk exceeds 500 kB.

## Files

- Modified `src/RetirementView.tsx`.
- Modified `src/RetirementView.test.tsx`.
- Modified `src/styles.css`.
- Created this report only under `.superpowers`.
- `src/App.tsx` required no new wiring: its existing persistent Retirement mount, local saved-record echo, bootstrap replacement, and source-editor callbacks already provide the Task 6 integration contract. `src/App.test.tsx` was run unchanged as the integration/regression gate.

## Self-Review and Concerns

- Mutation review covers dropped fields, invalid horizon boundaries, ambiguous destination saves, incomplete/opaque withdrawal order, missing reset, inaccessible selection semantics, stale selected state, and legacy headline sourcing.
- Strict Mode mount, queued revisions, retry, own-save echoes, authoritative replacement, stale save generations, and inactive-tab calculation behavior remain covered and passing.
- Selected state is not color-only: each card displays Selected/Select text in addition to border and outline changes.
- No blocking concerns found. The unrelated pre-existing `.superpowers/brainstorm/` content was not touched or staged.
