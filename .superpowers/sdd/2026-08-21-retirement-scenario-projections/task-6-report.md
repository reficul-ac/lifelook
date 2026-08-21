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

## Fix Round 1: Account Lifecycle and Mobile Targets

- Added account-set fingerprinting so account additions, removals, reorderings, and taxable-eligibility changes reconcile the live destination and withdrawal override even when the retirement-plan record is unchanged.
- Tracks the authoritative raw record separately from its normalized draft. A sole destination derived from a null persisted value becomes unresolved when a second taxable account appears, while a valid explicitly persisted destination remains selected.
- Reconciles multiple-to-sole auto-selection, deleted destinations, and unique known withdrawal override IDs without initiating an autosave or replacing unrelated partial/conflicted draft fields.
- Rebuilds queued and failed-save values from the reconciled draft and reads current destination requirements in asynchronous save completion/failure paths, preserving revision, retry, authoritative replacement, own-echo, and Strict Mode behavior.
- Moved retirement touch-target sizing to the 900px breakpoint and included home-sale disclosure summaries and their Save/Retry button.

### Fix Round 1 TDD Evidence

- RED: `npm test -- --run src/RetirementView.test.tsx`
- Result: 4 expected lifecycle failures and 22 passes. The failures observed an implicit sole destination remaining selected, multiple-to-sole autosave retaining null, a deleted destination remaining in projection settings, and retry resending a deleted withdrawal ID. The explicit-persisted control passed.
- GREEN: the same command passed 1 file and 26 tests after account-derived reconciliation was implemented.
- No existing CSS parsing or responsive-browser test convention exists in the repository, and jsdom does not evaluate media-query layout. The responsive selector change was therefore reviewed directly and covered by the TypeScript/Vite build rather than a source-text assertion.

### Fix Round 1 Verification and Self-Review

- `npm test -- --run src/RetirementView.test.tsx src/App.test.tsx && npm run build`: PASS, 2 files and 82 tests; TypeScript and Vite production build passed.
- `npm test`: PASS, 16 files and 344 tests.
- `git diff --check`: PASS.
- Mutation review confirmed the new tests fail for removing account fingerprinting, losing implicit-versus-persisted provenance, skipping destination/order filtering, replacing the full draft, reconstructing retry from stale values, or restoring a deleted destination to projection settings.
- No blocking concern found. Vite retains its existing non-blocking advisory for the main minified chunk over 500 kB, and unrelated `.superpowers/brainstorm/` content remains untouched and unstaged.

## Fix Round 2: In-Flight Account Save Race

- Added an account-derived payload generation independent of authoritative replacement generations.
- An account change now marks the dispatched payload stale and replaces any queued work with values rebuilt from the current visible draft.
- A stale successful request contributes only its returned revision for optimistic concurrency. Its record is not adopted, fingerprinted as an own-save echo, or emitted through `onSettingsChange`; the serialized loop follows with a valid reconciled save at that revision.
- If the reconciled draft is unresolved, the loop stops idle without adopting stale IDs; the next completed user edit saves against the stale request's returned revision. A stale failed request similarly yields to the latest valid reconciled draft rather than surfacing an error for obsolete IDs.

### Fix Round 2 TDD Evidence

- RED: `npm test -- --run src/RetirementView.test.tsx`
- Result: 1 expected failure and 26 passes. After deleting the selected/ordered accounts during a deferred save, only the stale request completed and no revision-correct reconciliation request was made.
- GREEN: the same command passed 1 file and 27 tests after account-generation invalidation and serialized reconciliation were implemented.
- The regression independently asserts the first stale payload, the second filtered payload and `expectedRevision: 2`, preserved retirement-month draft, reconciled projection settings, and exactly one outward notification containing only the valid record.

### Fix Round 2 Verification

- `npm test -- --run src/RetirementView.test.tsx src/App.test.tsx && npm run build`: PASS, 2 files and 83 tests; TypeScript and Vite production build passed.
- `npm test`: PASS, 16 files and 345 tests.
- `git diff --check`: PASS.
- Vite retains its existing non-blocking advisory for the main minified chunk over 500 kB.

## Fix Round 3: Render-to-Effect Save Adoption Race

- Added a latest-accounts fingerprint ref that is updated synchronously during every render and captured with each dispatched retirement-settings request.
- Save success and failure handling compare the dispatched fingerprint with the render-current fingerprint before adopting a record, creating an own-save fingerprint, reporting an error, or calling `onSettingsChange`.
- When a response arrives after a new account render but before its passive reconciliation effect, the save loop waits for that effect. Reconciliation filters the live draft, retains unrelated fields, and releases the loop to save only valid destination/order values using the stale success's returned revision.
- Authoritative replacements and unmount cleanup also release reconciliation waiters, preventing an obsolete request from hanging or later emitting its record.

### Fix Round 3 TDD Evidence

- RED: `npm test -- --run src/RetirementView.test.tsx` initially failed 1 test with 27 passes because revision 2 and its deleted destination/order were emitted before passive reconciliation.
- The finalized same-task regression keeps the existing component instance, renders the deleted-account props, resolves the save in a following sibling, and suspends the render before passive effects. A targeted mutation back to passive-generation-only adoption failed 1 test with 27 skipped and directly observed the stale revision-2 emission.
- GREEN: `npm test -- --run src/RetirementView.test.tsx` passed 1 file and 28 tests with render-current fingerprint validation restored.
- The regression asserts that the stale record is never emitted, the valid follow-up payload uses `expectedRevision: 2`, only the revision-3 reconciled record is emitted, and the unrelated retirement-month draft remains intact.

### Fix Round 3 Verification

- `npm test -- --run src/RetirementView.test.tsx src/App.test.tsx && npm run build`: PASS, 2 files and 84 tests; TypeScript and Vite production build passed.
- `npm test`: PASS, 16 files and 346 tests.
- `git diff --check`: PASS.
- Vite retains its existing non-blocking advisory for the main minified chunk over 500 kB.
