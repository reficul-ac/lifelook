# LifeLook Text and Warning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace repeated warning paragraphs with compact visible statuses and accessible optional explanations throughout LifeLook, while preserving financial meaning, actionable errors, and recovery warnings.

**Architecture:** Add one browser disclosure controller per mounted workspace and browser-only issue grouping, labels, and navigation. Apply those primitives to reports and forms, keeping transient form feedback separate from durable persistence/recovery errors. Calculation outputs, saved input schema, and financial rule packs remain unchanged.

**Tech Stack:** Existing TypeScript 5.7.3, native HTML/CSS, Vite 6.4.4, Vitest 4.1.11 with jsdom 25, Testing Library, and Playwright 1.58.2; Node 22 or newer. No new dependencies.

**Spec:** [LifeLook text and warning audit](../reviews/2026-10-12-lifelook-text-warning-audit.md). Its inventories and visible-versus-optional decisions are the requirements for this plan. The [foundation design](../specs/2026-10-11-lifelook-foundation-rebuild-design.md) supplies the existing availability, saved-revision, coverage, and calculation contracts; its old `foundation/` paths are historical.

## Global Constraints

- “An unavailable amount must never become `$0.00`, a bare dash, or an unlabeled icon.”
- “A confirmed zero remains a numeric zero.”
- “A missing result and an unsupported case remain distinguishable.”
- “Grouping is a UI operation; it must not make an unavailable result available.”
- “Keep imported names/messages as text.”
- “Unknown histories, confirmed zeros and scheduled estimates preserve their current calculation contracts.”
- “Four rental tax books remain independent.”
- “Persistence warnings must remain visible until resolved.”
- Keep modeled completeness, household completeness, provenance, funding availability, and conditional cash-gap results distinct. Numeric tax candidates must not imply complete household liability.
- Keep essential units, dates, eligibility/scope restrictions, failed-save actions, and import/discard consequences visible. Use optional details for definitions, methods, full causes, and technical diagnostics.
- Preserve `PlanDocument` schema version `1`, storage key `lifelook.foundation.plan.v1`, independent record saves, raw drafts, stale-draft checks, and all fixture values. Do not edit `src/engine/**`, rule packs, or financial fixtures for this presentation change.
- Follow `CLAUDE.md`: work and commit directly on `main`, without creating a branch/worktree. No task authorizes a push; every push requires separate explicit confirmation for `reficul-ac/lifelook`, `origin`, `main`.

## Review Focus

- Thirty-year cumulative balances: retain all earlier causes and noncontiguous periods, without merging distinct fields, records, or corrections. Tests: Tasks 2 and 8.
- Hidden invalid property inputs: a failed Save must reveal and identify the exact nested field without replacing ordinary input nodes or applying the draft. Tests: Tasks 4 and 5.
- Startup/quota recovery: malformed/schema-invalid saved data and write failures remain actionable through edits, adds, discards, and rejected Saves; valid incomplete tax coverage is not a storage failure. Tests: Task 7.
- Popup lifecycle and access: hover, keyboard, touch, horizontal scrolling, hidden sections, rerenders, and remounts cannot leave clipped, stale, or broken disclosures. Tests: Tasks 1 and 8.
- Indirect issue destinations: a contribution's age/coverage/employer warning must reach the correct filer or employer group; bracket paths, nested IDs, and ambiguous spouse requirements must not focus an unrelated field. Tests: Tasks 2 and 4.

---

## File responsibilities and task dependencies

| File | Responsibility | Owning task |
| --- | --- | --- |
| Create `src/browser/disclosures.ts` | Lazy shared tooltip preview and persistent nonmodal details panel; lifecycle and focus | 1 |
| Create `src/browser/issue-presentation.ts` | Pure issue grouping, period formatting, human record labels, and issue destinations; shared context types | 2 |
| Create `src/browser/navigation.ts` | Select input section, reveal record/group/control, and focus a destination | 2; field refinement in 4 |
| Modify `src/browser/views/issues.ts` | Compact amount/coverage/provenance/issue rendering | 2–3 |
| Modify `src/browser/views/projection.ts`, `tax-explanation.ts` | Report integration, optional methodology/calculation sections, scoped warnings | 2–3 |
| Create `src/browser/form-feedback.ts` | Draft-relative field resolution, concise error copy, and DOM-only feedback synchronization | 4 |
| Modify `src/browser/fields.ts` | Accessible field wrapper, short visible labels, help, tri-state booleans, stable field metadata | 4 |
| Modify `src/browser/forms/properties.ts` | Persistent disclosure state and advanced property/history presentation | 5 |
| Modify the other four `src/browser/forms/*.ts` files | Apply shared field API and approved concise copy | 4 and 6 |
| Modify `src/browser/state.ts` | Durable persistence channel and explicit operation notifications | 7 |
| Modify `src/browser/main.ts` | Shared context/lifecycle, navigation, feedback updates, header and recovery | 2, 4, 7 |
| Modify `src/browser/styles.css` | Disclosure placement, compact statuses/tables, field feedback and readable header controls | Each owning UI task |
| Create `tests/helpers/presentation.ts` | Shared standalone-view setup using the real disclosure/context interfaces | 2 |
| Browser tests under `tests/browser/` | Semantic grouping, interactions, field/save contracts, recovery | Owning task |
| Modify `tests/e2e/workspace.spec.ts`, `README.md` | Real-browser acceptance, updated entry helpers, user-facing behavior documentation | 8 |

Execute Tasks 1–8 in order. Task 2 threads the context through existing views; Task 3 changes their information hierarchy. Tasks 4–6 share field/property APIs and should not edit shared files concurrently. Persistence is independently reviewable, but Task 7 uses the feedback and presentation contracts already established. This is one coordinated browser change, rather than separate tax-engine or storage-format projects.

## Task 1: Accessible shared disclosures

**Files:** Create `src/browser/disclosures.ts`; modify `src/browser/styles.css`; create `tests/browser/disclosures.test.ts`.

**Interfaces:**

```ts
export interface DisclosureOptions {
  readonly label: string;                 // Visible control text, e.g. Needs data or ⓘ
  readonly accessibleLabel: string;       // Includes visible status/label and context
  readonly preview: string;               // Plain, noninteractive short explanation
  readonly title: string;
  readonly renderDetails: (root: HTMLElement) => void;
}
export interface DisclosureController {
  createTrigger(options: DisclosureOptions): HTMLButtonElement;
  closeWithin(root: HTMLElement, restoreFocus?: boolean): void;
  dispose(): void;
}
export function createDisclosureController(owner: HTMLElement): DisclosureController;
```

Consumes DOM only. Produces the controller used by every later task. Use a body-mounted custom controller, rather than requiring native popover support: installed jsdom lacks that API. One shared preview and one shared details panel are created lazily, with `data-disclosure-preview` / `data-disclosure-panel` hooks; do not allocate a full popup for each amount.

- [x] **Step 1: Write interaction/lifecycle tests.** Cover hover and focus preview, pointer movement onto the preview, Escape, click pinning, lazy content, outside dismissal, focus return, hiding/reopening triggers, replacement/remount cleanup, and literal text. Representative test assertions:

```ts
it('creates long details only on activation and returns focus on Escape', () => {
  const owner = document.createElement('main'); document.body.replaceChildren(owner);
  const disclosures = createDisclosureController(owner), renderDetails = vi.fn((node: HTMLElement) => { node.textContent = 'Exact explanation and next step'; });
  const trigger = disclosures.createTrigger({label:'Needs data', accessibleLabel:'Needs data: Federal income tax, 2027', preview:'Confirm 3 household tax answers.', title:'Federal income tax · 2027', renderDetails});
  owner.append(trigger); trigger.focus();
  expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Confirm 3 household tax answers.');
  expect(renderDetails).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  expect(within(document.body).getByRole('region', {name:'Federal income tax · 2027'})).toHaveTextContent('Exact explanation and next step');
  expect(renderDetails).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, {key:'Escape'});
  expect(document.querySelector('[data-disclosure-panel]')).not.toBeVisible();
  expect(document.activeElement).toBe(trigger);
});
```

Test hover exit using a 150 ms close delay and fake timers: entering the preview cancels close; disposal cancels pending work. Escape suppresses immediate reopening until a new entry/focus or explicit activation. `closeWithin(owner, false)` must not steal destination focus. Creating a second controller for the same owner disposes the old one; detaching the owner cleans up body overlays/listeners.

- [x] **Step 2: Run the failing tests.** `npm run test:browser -- tests/browser/disclosures.test.ts` → FAIL for the missing module/API.
- [x] **Step 3: Implement the declared controller.** Preview uses `role="tooltip"` and `aria-describedby`, with no interactive children. Activated details uses a labelled nonmodal `region`, `aria-expanded`/`aria-controls`, a visible Close button, and focus on Close; it has no modal focus trap. Place overlays outside scroll ancestors, clamp to viewport with a 12 px margin, allow long panels to scroll, and reposition on scrolling/resizing. Closing on an outside click or navigation must preserve the user's new focus. Closing a hidden section retains its trigger handlers; removed trigger nodes can be collected without retained registry references. Rerender owners call `closeWithin(subtree, false)` before replacement.
- [x] **Step 4: Verify semantics.** Run the Task 1 test command and `npm run typecheck` → PASS. Geometry/clipping is verified in Task 8, not through jsdom's zero-sized rectangles.
- [x] **Step 5: Commit.** `git add src/browser/disclosures.ts src/browser/styles.css tests/browser/disclosures.test.ts` then `git commit -m "feat: add accessible shared disclosures"`.

## Task 2: Grouped issues and compact amounts

**Files:** Create `src/browser/issue-presentation.ts`, `src/browser/navigation.ts`, `tests/helpers/presentation.ts`, `tests/browser/issue-presentation.test.ts`; modify `src/browser/views/issues.ts`, `src/browser/views/projection.ts`, `src/browser/views/tax-explanation.ts`, `src/browser/main.ts`, `src/browser/styles.css`, `tests/browser/reporting.test.ts`.

**Interfaces:** Consumes `Issue`, `Available`, `PlanDocument`, current browser `WorkspaceState`, and Task 1.

```ts
export type ReportPeriod = Readonly<{year: number; month?: number}>;
export type IssueOccurrence = Readonly<{issue: Issue; period?: ReportPeriod}>;
export type IssueGroup = Readonly<{key: string; issues: readonly Issue[]; periods: readonly ReportPeriod[]}>;
export type InputSection = 'Household' | 'Income' | 'Expenses and debts' | 'Investments' | 'Properties';
export type ReviewTarget = Readonly<{section: InputSection; recordId: string; field?: string; label: string}>;
export interface IssueViewContext {
  readonly disclosures: DisclosureController;
  readonly readState: () => Pick<WorkspaceState, 'savedPlan' | 'drafts'>;
  readonly review: (target: ReviewTarget) => void;
}
export type AmountScope = Readonly<{label: string; period?: ReportPeriod}>;
export function groupIssueOccurrences(items: readonly IssueOccurrence[]): readonly IssueGroup[];
export function formatPeriods(periods: readonly ReportPeriod[]): string;
export function getRecordLabel(plan: PlanDocument, id: string): string;
export function resolveIssueTargets(issue: Issue, state: Pick<WorkspaceState, 'savedPlan' | 'drafts'>): readonly ReviewTarget[];
// navigation.ts
export function reviewTarget(root: HTMLElement, target: ReviewTarget): boolean;
// views/issues.ts and report entrypoints
export function appendAmount(root: HTMLElement, value: Available<number>, context: IssueViewContext, scope: AmountScope, kind?: 'money' | 'ratio'): void;
export function moneyEntry(root: HTMLElement, label: string, value: Available<number> | number, context: IssueViewContext, testId?: string): void;
export function renderIssues(root: HTMLElement, issues: readonly Issue[], context: IssueViewContext, heading?: string): void;
export function renderProjection(root: HTMLElement, result: ProjectionResult, context: IssueViewContext): void;
export function renderTaxExplanation(root: HTMLElement, year: AnnualProjection, context: IssueViewContext): void;
// tests/helpers/presentation.ts
export function mountPresentation(plan?: PlanDocument): {root: HTMLElement; context: IssueViewContext; reviews: ReviewTarget[]};
```

Types above belong to `issue-presentation.ts`, except the indicated functions. `mountPresentation` defaults to existing `makePlan()`, mounts a connected root, and collects review requests; it exercises the real controller. `readState` is a callback so actions can resolve current draft indexes without displaying draft values as saved results.

- [x] **Step 1: Write grouping, target, and compact-render tests.** Reuse `makePlan`, `mustValidate`, `loadRuleSet`, `loadReferences`, and existing reporting oracle checks. Add tests with these exact decisions:

```ts
it('retains noncontiguous years and distinct corrections', () => {
  const issue: Issue = {code:'required-history', recordId:'rental-a', field:'taxHistory.federal', year:2027, severity:'warning', explanation:'History missing', resolution:'Review Federal history'};
  const groups = groupIssueOccurrences([{issue}, {issue:{...issue, year:2029}}, {issue:{...issue, recordId:'rental-b'}}, {issue:{...issue, resolution:'Review another input'}}]);
  expect(groups).toHaveLength(3);
  expect(groups[0]?.periods).toEqual([{year:2027}, {year:2029}]);
  expect(formatPeriods(groups[0]!.periods)).toBe('2027, 2029');
});
it('keeps a 30-year reserve compact while retaining all original years', () => {
  const plan = createPlan('2026-10-12', 'warning-audit');
  const {root, context} = mountPresentation(plan);
  renderProjection(root, calculateProjection(mustValidate(plan), loadRuleSet()), context);
  const cell = within(root).getByTestId('annual-2056-net-worth');
  expect(cell).toHaveTextContent('Needs data');
  expect(cell.querySelectorAll('p')).toHaveLength(0);
  expect(cell.textContent).not.toContain('$0.00');
  fireEvent.click(within(cell).getByRole('button', {name:/Needs data/}));
  const panel = within(document.body).getByRole('region', {name:'Net worth · 2056'});
  expect(panel).toHaveTextContent('2027–2056');
  expect(panel).toHaveTextContent('Additional income outside these records');
  expect(panel).toHaveTextContent('Additional household tax credits');
  expect(panel).toHaveTextContent('Qualified dividends or capital gains');
});
```

Also test differing field/severity/explanation, duplicate issue objects, month ranges supplied through occurrences, an earlier issue year inside a later amount, unknown fallback codes, empty issue arrays, and HTML-like/prototype-like IDs. Routing cases: filer; nested loan/rental; bracket paths; contribution age/employer facts redirected through account owner and sponsoring salary; spouse requirements produce separate destinations; absent employer rows reach the group without creating data.

- [x] **Step 2: Run the failing tests.** `npm run test:browser -- tests/browser/issue-presentation.test.ts tests/browser/reporting.test.ts` → new assertions FAIL against current paragraph rendering/missing helpers.
- [x] **Step 3: Implement the declared interfaces and thread context.** Group by code, record, field, severity, explanation and resolution, excluding period; retain exact deduplicated underlying issues and periods. Original issue years outrank a containing cell's year; do not attach a later month to an earlier cause. Compress only contiguous periods. Present the three tax-coverage groups together as three named checks with one shared explanation/action; never drop their fields. Provide full original explanation/resolution and technical diagnostics inside details. Known unsupported circumstances get support-boundary copy, not a confirmation fix.

Amounts contain currency/percentage or one status button (`Needs data` / `Unsupported`), never inline explanation paragraphs. Panel title is `[amount label] · [period]` where a period exists. Empty issue arrays still expose an honest generic explanation/action. Preserve current stable test IDs and independent values. Empty issue lists render nothing; nonempty lists show compact grouped rows and lazy details rather than full prose.

Derive names from saved inputs, using `ADU [ordinal] — [property name]` and account-based contribution labels because rentals/contributions have no stored name. Resolve current raw draft paths by IDs; do not change schema. Navigation closes details without focus return, selects the correct tab, opens ancestors, and focuses a matching control/group or owning form heading. Compare datasets directly; do not interpolate imported IDs into selectors. At this stage add group/record fallbacks; Task 4 makes field metadata/feedback complete.

Create the controller/context in `mountApp`; forward it through every amount call in annual/monthly/asset/tax/schedule views and standalone test setup. Close owned overlays before subtree replacement and when hiding nav/month/tax sections. Preserve cached expansion triggers when reopening. Add `unmountApp(root: HTMLElement): void` in `main.ts`, backed by a WeakMap cleanup that unsubscribes and disposes; remount and test cleanup use it without changing `mountApp`'s controller return type.

- [x] **Step 4: Verify.** Run the Task 2 test command, `npm run test:browser`, and `npm run typecheck` → PASS, after replacing assertions for cell prose with assertions for activated reasons/actions. No fixture expected numbers change.
- [x] **Step 5: Commit.** `git add src/browser/issue-presentation.ts src/browser/navigation.ts tests/helpers/presentation.ts tests/browser/issue-presentation.test.ts src/browser/views/issues.ts src/browser/views/projection.ts src/browser/views/tax-explanation.ts src/browser/main.ts src/browser/styles.css tests/browser/reporting.test.ts` then `git commit -m "feat: group warnings and compact unavailable amounts"`.

## Task 3: Projection and tax information hierarchy

**Files:** Modify `src/browser/views/issues.ts`, `src/browser/views/projection.ts`, `src/browser/views/tax-explanation.ts`, `src/browser/styles.css`, `tests/browser/reporting.test.ts`.

**Interfaces:** Consumes Task 2 context, amount rendering and grouping. Retains `appendCoverage(root: HTMLElement, coverage: Coverage): void` and `appendProvenance(root: HTMLElement, provenance: readonly RuleProvenance[]): void`; produces the final report presentation through the Task 2 entrypoint signatures.

- [x] **Step 1: Write report behavior tests.** Extend existing fixtures rather than copying expected numbers:

```ts
it('uses N/A only for ratios whose sole cause is known zero income', () => {
  const c = loadReferences<PlanDocument, ProjectionResult>('projection').find(c => c.id === 'zero-cash')!;
  const {root, context} = mountPresentation(c.input);
  renderProjection(root, calculateProjection(mustValidate(c.input), loadRuleSet()), context);
  expect(within(root).getAllByText('N/A · no income')).toHaveLength(4);
  expect(within(root).getByTestId('annual-2026-gross-income')).toHaveTextContent('$0.00');
});
it('labels numeric candidates when household coverage blocks selected tax', () => {
  const base = makePlan();
  const plan = {...base, household:{...base.household, coverageAnswers:{...base.household.coverageAnswers, additionalIncome:{known:false as const}, additionalCredits:{known:false as const}, qualifiedDividendsOrCapitalGains:{known:false as const}}}};
  const projection = calculateProjection(mustValidate(plan), loadRuleSet());
  const {root, context} = mountPresentation(plan);
  renderTaxExplanation(root, projection.years[0]!, context);
  fireEvent.click(within(root).getByText('Deduction comparisons', {selector:'summary'}));
  expect(root).toHaveTextContent('Candidate taxes cover modeled inputs only; household tax incomplete');
  expect(within(root).getByRole('table', {name:'Legal deduction comparisons'}).querySelectorAll('tbody tr')).toHaveLength(4);
});
```

Retain oracle checks for all 29 amount columns and child balances, all tax components, selected methods, disallowed deductions, assessed/paid state tax, and four rental books. Open newly optional sections explicitly. Test funding unknown and conditional gap together; unchanged independent values; saved-name labels during draft edits; omitted empty asset sections; unknown ratios retain status; repeated contribution reasons preserve rule/month scope. Full calculation steps and sources remain reachable.

- [x] **Step 2: Run failing report tests.** `npm run test:browser -- tests/browser/reporting.test.ts` → new hierarchy/status assertions FAIL.
- [x] **Step 3: Implement presentation through the declared entrypoints.** Use separate compact coverage/funding/rule indicators, scoped per year/component; mixed verified/provisional/projected sources cannot label the entire forecast verified. Show `Inputs v[revision]`; put tax-reserve/asset-growth/contribution assumptions under closed `How calculated` and `Forecast assumptions`. Include equal-month tax allocation when positive income is zero. Triggered gap/distribution/unsupported warnings remain visible.

Keep all columns; rename `Principal paid`, `Account balance`, `Loan balance`, with short SDI help. Add minimum table widths and single-line amount/status content; preserve captions/header associations and horizontal scrolling. Omit empty asset details. Keep contribution schedules optional with a visible failure count.

Tax expansion shows selected methods, deduction/disallowed amounts, ordinary tax/AMT/NIIT/surtax components, and assessed-versus-paid tax once. Put intermediate inputs/formulas, four comparisons, contribution detail, and independent rental books into named closed sections: `Calculation inputs`, `Calculation steps`, `Deduction comparisons`, `Contributions`, `Rentals`. Present readable calculation steps from structured result amounts with currency/percentage formatting; original raw formula strings remain in diagnostics, without guessing units from arbitrary prose or recalculating tax. Route manual unknown IRA basis and QBI history displays through the shared optional-details treatment. Consolidate overlapping tax/household/year issues into one list for the year. Use grouped contribution occurrences with record-provided months and compact reason controls in rows; preserve requested/eligible/prevented funding. Sources use descriptive titles where known, hostname/path fallback otherwise, with original URL/version available. Remove user-facing fixture-maintenance instructions without editing engine messages; retain them in technical diagnostics if needed.
- [x] **Step 4: Verify.** Run the Task 3 test command and `npm run typecheck` → PASS. Existing independent expected values remain identical.
- [x] **Step 5: Commit.** `git add src/browser/views/issues.ts src/browser/views/projection.ts src/browser/views/tax-explanation.ts src/browser/styles.css tests/browser/reporting.test.ts` then `git commit -m "feat: simplify projection and tax explanations"`.

## Task 4: Field semantics and feedback that updates after failed saves

**Files:** Create `src/browser/form-feedback.ts`, `tests/browser/form-feedback.test.ts`; modify `src/browser/fields.ts`, `src/browser/navigation.ts`, `src/browser/main.ts`, `src/browser/forms/household.ts`, `src/browser/forms/income.ts`, `src/browser/forms/expenses-debts.ts`, `src/browser/forms/investments.ts`, `src/browser/forms/properties.ts`, `src/browser/styles.css`, `tests/helpers/dom.ts`, `tests/browser/forms.test.ts`, `tests/browser/financial-forms.test.ts`, `tests/browser/properties.test.ts`.

**Interfaces:** Consumes existing `RecordDraft`, `FieldPath`, `FieldContext`, `WorkspaceController`, and Task 2 context. Add `ui?: IssueViewContext` to `FieldContext`, and `visibleLabel?: string` / `help?: string` to `FieldOptions`. Keep the existing label argument as the contextual accessible name. Add an optional UI context parameter to the five form renderers and `renderRecordSection` after its existing optional `makeNew` parameter.

```ts
export function renderBooleanHistory(root: HTMLElement, context: FieldContext, path: FieldPath, label: string, options?: Pick<FieldOptions, 'visibleLabel' | 'hint' | 'help'>): HTMLSelectElement;
// form-feedback.ts
export interface ResolvedFormIssue {readonly issue: Issue; readonly path?: FieldPath; readonly scope: 'field' | 'group' | 'record'}
export function resolveFormIssues(draft: RecordDraft, planId: string, issues: readonly Issue[]): readonly ResolvedFormIssue[];
export function syncFormFeedback(root: HTMLElement, controller: WorkspaceController, context: IssueViewContext): void;
export function revealField(form: HTMLElement, path: FieldPath, focus?: boolean): boolean;
```

`syncFormFeedback` changes feedback/attributes, not input nodes. Form cards expose `data-record-id` and `data-editable-section`. Registered field/group metadata retains canonical path, accessible label, input kind, and stable hint/error IDs. `revealField` is reused by navigation and error-summary links.

- [x] **Step 1: Write actual-mounted-workspace tests and resolver tests.** Use `mountWorkspace`, not only standalone property subscriptions that rebuild forms on every notification:

```ts
it('shows a local failed-save error while retaining the same draft input', () => {
  const {root, controller} = mountWorkspace(makePlan());
  const input = within(root).getByLabelText('Opening cash reserve ($)');
  setField(root, 'Opening cash reserve ($)', '1.234');
  fireEvent.click(within(root).getByRole('button', {name:'Save household'}));
  expect(within(root).getByLabelText('Opening cash reserve ($)')).toBe(input);
  expect(input).toHaveValue('1.234'); expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription(/up to 2 decimal places/);
  expect(controller.getState().savedPlan.revision).toBe(0);
  expect(controller.getState().projection.inputRevision).toBe(0);
});
```

Test the boolean sequence `unknown → false → true → unknown` against exact `{known:false}` / `{known:true,value:false}` / `{known:true,value:true}` draft and saved shapes; Unknown must not set `aria-invalid`. Known money/date selection creates an empty entry, never zero. Preserve focus/selection through structural refresh. Resolver cases must include full property-bundle decoder paths, nested loan/rental/expense IDs, filer/plan IDs, `loanAllocations[0].share`, `federal-amt`, two records sharing a leaf name, and unmatched aggregate errors. Verify help controls are label siblings and short visible words occur in contextual accessible names.

- [x] **Step 2: Run failing tests.** `npm run test:browser -- tests/browser/form-feedback.test.ts tests/browser/forms.test.ts` → new mounted-feedback/tri-state assertions FAIL.
- [x] **Step 3: Implement field wrappers, histories, resolver, and synchronization.** Use a wrapper with dedicated `<label for>` plus sibling hint/help/error nodes; do not nest help buttons inside labels. Keep `data-field`, stable control IDs, and described-by associations. `renderHistory` delegates boolean cases to `renderBooleanHistory`, including property's private boolean helper. Map options `unknown`, `false`, `true` exactly; money/date Unknown/Known retains existing storage semantics.

Index nested raw draft objects by their IDs to resolve canonical paths, accepting bracket/dot numeric notation. Group/history issues target registered groups; unmatched issues remain in the task summary. Show concise input errors with their action beside the field and associate only blocking errors with `aria-invalid`. Keep full original diagnostics in optional detail. On failed Save, reveal affected ancestors and provide focus links; do not automatically move focus on every edit. Clear stale field feedback when its transaction error clears.

Call synchronization after initial/structural rendering and every state notification. `main.ts` currently skips form rerender on failed Save: do not solve this by replacing all forms on every keystroke. Refresh summaries/errors independently and retain existing input selection. Before structural replacement close active disclosures without restoring detached focus. Refine navigation to use the same canonical field/group resolution. Standalone form test mounts supply the shared context when testing optional help; mounted-app tests remain the proof of failed-save feedback.
- [x] **Step 4: Verify field/save contracts.** Run the Task 4 test command, `npm run test:browser`, and `npm run typecheck` → PASS; existing draft equality, stale transaction, independent saves and four-book tests remain valid.
- [x] **Step 5: Commit.** `git add src/browser/form-feedback.ts tests/browser/form-feedback.test.ts src/browser/fields.ts src/browser/navigation.ts src/browser/main.ts src/browser/forms/household.ts src/browser/forms/income.ts src/browser/forms/expenses-debts.ts src/browser/forms/investments.ts src/browser/forms/properties.ts src/browser/styles.css tests/helpers/dom.ts tests/browser/forms.test.ts tests/browser/financial-forms.test.ts tests/browser/properties.test.ts` then `git commit -m "feat: add concise field feedback and explicit history choices"`.

## Task 5: Collapsed property details with accurate summaries

**Files:** Modify `src/browser/forms/properties.ts`, `src/browser/form-feedback.ts`, `src/browser/styles.css`, `tests/browser/properties.test.ts`, `tests/browser/forms.test.ts`.

**Interfaces:** Consumes Task 4 metadata/feedback. Inside `properties.ts`, replace the current always-open helper with `details(root: HTMLElement, name: string, options: PropertyDisclosureOptions): HTMLDetailsElement`, where `PropertyDisclosureOptions = {readonly key: string; readonly initialOpen?: boolean; readonly status?: string}`. Keep section state in a WeakMap keyed by the persistent Properties root; keys include stable property/loan/rental IDs and book name, never row indexes. It is not stored in drafts/backups.

- [x] **Step 1: Write property accessibility/transaction tests.** Load the existing `two-salaries-home-adu` fixture through `mountWorkspace`. Assert saved appreciation, loan, rental, four tax books, and QBI sections initially closed. Open Federal AMT, edit it, and save an unrelated salary: the opened state and independent property draft survive. New loan/rental sections open for entry. Test the hidden error case:

```ts
it('reveals the invalid Federal AMT amount without changing other books', () => {
  const fixture = loadReferences<PlanDocument, ProjectionResult>('projection').find(c => c.id === 'two-salaries-home-adu')!;
  const originalCaliforniaHistory = fixture.input.rentals[0]!.taxHistory.california;
  const {root, controller} = mountWorkspace(fixture.input);
  fireEvent.click(within(root).getByRole('button', {name:'Properties', exact:true}));
  const form = [...root.querySelectorAll('form')].find(node => node.dataset.recordId === 'home')!;
  for (const details of form.querySelectorAll('details')) if (!details.open) fireEvent.click(details.querySelector('summary')!);
  const path = 'rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents';
  const invalidInput = [...form.querySelectorAll<HTMLInputElement>('input[data-field]')].find(node => node.dataset.field === path)!;
  fireEvent.input(invalidInput, {target:{value:'1.234'}});
  const ancestors: HTMLDetailsElement[] = [];
  for (let node: HTMLElement | null = invalidInput.parentElement; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) ancestors.push(node);
  for (const details of ancestors) if (details.open) fireEvent.click(details.querySelector('summary')!);
  fireEvent.click(within(form).getByRole('button', {name:'Save property', exact:true}));
  expect(invalidInput).toHaveValue('1.234');
  expect(ancestors.every(details => details.open)).toBe(true);
  expect(invalidInput).toHaveAttribute('aria-invalid', 'true');
  expect(controller.getState().savedPlan.revision).toBe(0);
  expect(controller.getState().drafts.home).toBeDefined();
  expect(controller.getState().savedPlan.rentals[0]!.taxHistory.california).toEqual(originalCaliforniaHistory);
});
```

Also activate the error-summary link and check its actual focus target. Retain known-zero-vs-blank, four independent books, fractional area, estimate provenance and stale-property tests. Summary cases distinguish Unknown, confirmed whole-book zero, and invalid known input; generic unknown counts must not imply all facts are required.

- [x] **Step 2: Run failing property tests.** `npm run test:browser -- tests/browser/properties.test.ts tests/browser/forms.test.ts` → collapsed/preserved-state assertions FAIL.
- [x] **Step 3: Implement helper/state and audit property copy.** Default advanced details closed; preserve deliberate opens across refresh/unrelated saves, and open only blocking-error ancestors. Capture current disclosure state before subtree replacement as well as on toggle, so asynchronous native toggle events cannot lose a recent open/close. Use summaries such as `Federal AMT history · Unknown`, `Federal history · Confirmed zero`, `QBI history · 2 unknown facts`, `Loan · Opening balance estimated`, and `Federal history · 1 input error`. Label an opening balance estimated only when the schedule can establish that estimate; otherwise report unavailable inputs. Counts describe unknown facts, not conditional required-data eligibility. Keep headers distinct from duplicate inner legends.

Use `Use schedule estimate / Enter known value` only for estimated opening mortgage fields. Whole-book choices remain `Unknown / Enter amounts / All amounts and losses are zero`. Keep payment tax/insurance exclusion, estimated/entered status, rental availability, land/basis/market-value distinction, explicit no-loss confirmation, and combined home+ADU valuation/date inline. Put scope exclusions once per Properties view; keep relevant restrictions near dates. Shorten allocation/qualification labels while preserving independent shares, negative-question meanings, and eligibility facts. Expand UBIA as `Unadjusted qualified property basis (UBIA)`. Replace appended initialization-error paragraphs with synchronized field/task feedback and optional full detail.
- [x] **Step 4: Verify.** Run the Task 5 test command and `npm run typecheck` → PASS. Open newly closed sections in old tests through summaries rather than using `{hidden:true}` to bypass accessibility.
- [x] **Step 5: Commit.** `git add src/browser/forms/properties.ts src/browser/form-feedback.ts src/browser/styles.css tests/browser/properties.test.ts tests/browser/forms.test.ts` then `git commit -m "feat: collapse property history with actionable summaries"`.

## Task 6: Concise form copy and accurate error units

**Files:** Modify `src/browser/fields.ts`, `src/browser/form-feedback.ts`, `src/browser/forms/household.ts`, `src/browser/forms/income.ts`, `src/browser/forms/expenses-debts.ts`, `src/browser/forms/investments.ts`, `src/browser/forms/properties.ts`, `tests/browser/financial-forms.test.ts`, `tests/browser/forms.test.ts`, `tests/browser/form-feedback.test.ts`.

**Interfaces:** Consumes Task 4 `visibleLabel`, `hint`, `help`, and feedback. Add `formatFieldIssue(issue: Issue, draft: RecordDraft): string` in `form-feedback.ts` for short UI-unit errors; preserve full originals in details. Retain existing parse/save function signatures and outputs.

- [x] **Step 1: Write meaningful copy/entry tests.** Assert a short visible label remains associated with a contextual accessible name, and model interpretation survives Save. Cases: employer linkage, end-date inclusion, shorter-month raise dates, expense payment date, unsupported dividends/gains, mortgage single-entry, contribution priority, after-tax IRA basis, and shared allocation. For feedback, assert empty required amounts say `Enter an amount; use 0 only if confirmed.`, decimal errors say `Use up to 2 decimal places, without commas.`, whole-number errors say `Enter a whole number.`, and domain errors retain their actual correction. Range examples:

```ts
it('presents actual validator growth bounds in percentages', () => {
  const plan = makePlan({accounts:[{id:'account-a', name:'Account', ownerId:'owner-a', type:'taxable-brokerage', openingBalanceCents:0, annualGrowthBps:-10000, openingIraBasis:{known:false}}]});
  const result = validatePlan(plan);
  expect(result.ok).toBe(false);
  const issue = result.issues.find(item => item.recordId === 'account-a' && item.field === 'annualGrowthBps')!;
  const draft: RecordDraft = {recordId:'account-a', section:'accounts', value:toDraftValue(plan.accounts[0])};
  expect(formatFieldIssue(issue, draft)).toContain('-99.99%');
  expect(formatFieldIssue(issue, draft)).toContain('1,000%');
});
```

Add the analogous real-validator case for a debt's `aprBps: -1`, expecting minimum `0%`; use the populated property fixture with down payment one cent above price to assert the specific purchase-price correction survives formatting. Through the existing native financial-form setup, verify rejected Saves retain raw values and accepted values yield the existing `sameCalculation` result. Monetary bounds use dollars, never integer cents; measured areas still accept valid fractions. This task tests semantics/error conversion, not every cosmetic string.

- [x] **Step 2: Run failing tests.** `npm run test:browser -- tests/browser/form-feedback.test.ts tests/browser/financial-forms.test.ts tests/browser/forms.test.ts` → unit/help assertions FAIL.
- [x] **Step 3: Apply the audit inventory through the declared API.** Remove repeated record/filer prefixes from visible labels, duplicate Household heading, raw enums/IDs, and “record” in Save buttons. Keep contextual accessible names including the visible label text; if a shortened label is not part of the old accessible name, update the contextual label argument and affected tests rather than preserving an incompatible old name. Boolean controls retain Task 4 history shape. Use `After-tax IRA basis at forecast start ($)` and visible balance/confirmed-zero guidance. Shorten required timing/limit/eligibility hints; move definitions, APR convention, effective-return mechanics, priority tie rules and specialist qualification terms into help.

Use human tax-category labels and rental labels, without changing stored enum values. Keep fractions as `Rental portion / Total portions` with `1 of 4 = 25%`. For discard, show `Discard edits` plus its visible reload/loss consequence; no new confirmation dialog is needed. Implement error formatting from known field kind/domain rules, preserving down-payment, ownership, loss reconciliation, future-date and reference errors. Never parse an arbitrary number in engine prose into a guessed bound. Unknown fallback messages stay available in details.
- [x] **Step 4: Verify.** Run the Task 6 test command, `npm run test:browser`, and `npm run typecheck` → PASS. Stored enums, amounts, dates, references and saved projections remain unchanged.
- [x] **Step 5: Commit.** `git add src/browser/fields.ts src/browser/form-feedback.ts src/browser/forms/household.ts src/browser/forms/income.ts src/browser/forms/expenses-debts.ts src/browser/forms/investments.ts src/browser/forms/properties.ts tests/browser/financial-forms.test.ts tests/browser/forms.test.ts tests/browser/form-feedback.test.ts` then `git commit -m "feat: shorten form guidance while preserving input meaning"`.

## Task 7: Durable recovery warnings and concise operation status

**Files:** Modify `src/browser/state.ts`, `src/browser/main.ts`, `src/browser/styles.css`, `tests/browser/state.test.ts`, `tests/browser/forms.test.ts`, `tests/browser/storage.test.ts`, `tests/helpers/dom.ts`.

**Interfaces:** Add `readonly persistenceIssues: readonly Issue[]` to `WorkspaceState` and `SaveRecordResult`; keep `issues` for transient transaction errors. Define the following in `state.ts`:

```ts
export interface WorkspaceInitialization {readonly persisted: boolean; readonly persistenceIssues: readonly Issue[]}
export type WorkspaceOperation =
  | Readonly<{kind: 'save' | 'remove'; recordId: string; result: SaveRecordResult}>
  | Readonly<{kind: 'restore'; persisted: boolean}>;
// Updated WorkspaceController members:
subscribe(listener: (operation?: WorkspaceOperation) => void): () => void;
resetPlan(plan: PlanDocument, initial?: WorkspaceInitialization): void;
// main.ts retains all other arguments and return type:
mountApp(root: HTMLElement, plan: PlanDocument, storage: StoragePort, rules: RuleSet, initial?: WorkspaceInitialization): WorkspaceController;
```

Existing zero-argument subscribers remain valid. Draft notifications have no operation; each rejected/accepted Save or remove emits exactly one operation outcome. Startup initialization precedes subscribing, so it does not announce a restore.

- [x] **Step 1: Write persistence/header tests.** Use a mutable fake storage failure and the real mounted app:

```ts
it('retains write failure through editing and clears it only after successful storage', () => {
  let fail = true;
  const controller = createWorkspace(makePlan(), {getItem:()=>null, setItem:()=>{if(fail) throw new Error('quota');}}, loadRuleSet());
  const household = controller.getDraft('household', 'household');
  controller.editDraft('household', {...household, value:{...household.value, openingCashCents:'10.00'}});
  controller.saveRecord('household');
  const draft = controller.getDraft('household', 'household');
  controller.editDraft('household', {...draft, value:{...draft.value, openingCashCents:'1.234'}});
  controller.saveRecord('household');
  expect(controller.getState().persistenceIssues).toContainEqual(expect.objectContaining({code:'storage-write-failed'}));
  expect(controller.getState().persisted).toBe(false);
  fail = false;
  controller.editDraft('household', {...draft, value:{...draft.value, openingCashCents:'20.00'}});
  controller.saveRecord('household');
  expect(controller.getState().persistenceIssues).toEqual([]);
  expect(controller.getState().persisted).toBe(true);
});
```

Also cover add/discard, rejected calculations/stale Saves, quota-failed accepted restore, invalid restore preserving drafts/state, malformed JSON and unsupported-schema startup, read failure, valid loaded incomplete coverage, and first-use missing storage. Preserve exact original-byte recovery/export tests. Observe a dedicated `save-announcement` element: edits produce no mutations, operation outcomes announce; persistence warning/action remains visible outside closed backups. Verify export excludes drafts and import's replacement/draft-loss copy is associated before selection.

- [x] **Step 2: Run failing tests.** `npm run test:browser -- tests/browser/state.test.ts tests/browser/forms.test.ts tests/browser/storage.test.ts` → durable-channel/live-status assertions FAIL.
- [x] **Step 3: Implement the state channel and shell presentation.** Successful validation can return coverage warnings: do not classify all `loadPlan`/`savePlan` issues as persistence failures. After accepted Save, put only `storage-write-failed` in `persistenceIssues`, clear transaction errors, and leave coverage in projection. Invalid saves/edit/add/discard preserve durable errors. Successful writes clear old recovery failures.

At startup explicitly classify by load outcome: `missing → {persisted:false,persistenceIssues:[]}`; `loaded → {persisted:true,persistenceIssues:[]}`; `invalid` or `read-failed → {persisted:false,persistenceIssues:loaded.issues}`. Do not use `field === 'storage'`: rejected documents can contain schema-field errors. An accepted restore initializes only its write failure; rejected restore never resets current inputs/drafts. Update all old positional `resetPlan` calls/tests.

Keep ordinary visible `[data-testid=save-status]` as `Saved · Inputs vN` or `Unsaved · Inputs vN`, plus separate draft count/`Draft edits not applied`. Use a dedicated small `role="status"` announcement for operation outcomes; errors also remain at their task. Header recovery has the concise problem and backup/recovery action outside collapsed details. Preserve original unreadable bytes. Show `Exports applied inputs. Record drafts are excluded.` and `Replaces all inputs and discards record drafts.` beside backup controls; associate import guidance through `aria-describedby`. Use structured optional failure details rather than a flattened paragraph. Fix header details foreground/background and visible severity styling. Do not add an import confirmation flow or change replacement semantics.
- [x] **Step 4: Verify.** Run the Task 7 test command, `npm run test:browser`, and `npm run typecheck` → PASS. Keep storage schema/atomic restore/export guarantees intact.
- [x] **Step 5: Commit.** `git add src/browser/state.ts src/browser/main.ts src/browser/styles.css tests/browser/state.test.ts tests/browser/forms.test.ts tests/browser/storage.test.ts tests/helpers/dom.ts` then `git commit -m "fix: retain recovery warnings through draft edits"`.

## Task 8: Browser acceptance and final documentation

**Files:** Modify `tests/e2e/workspace.spec.ts`, `README.md`; update this plan's checkboxes as tasks complete. No additional product API is introduced.

**Interfaces:** Consumes the final application and stable amount/status test IDs. Update existing `booleanHistory` helper to one `Unknown / Yes / No` selection, Save labels/status assertions, and property entry helper to open the relevant summaries before interacting. Existing exported fixture inputs and independent expected amounts stay untouched.

- [x] **Step 1: Add acceptance assertions for the new behavior.** Extend the existing real-browser flows with deterministic `createPlan('2026-10-12', 'warning-audit')` and the populated fixture; use imported/preloaded inputs for focused cases. Required cases:

```ts
test('keeps all default annual rows compact and exposes carried causes', async ({page}) => {
  const plan = createPlan('2026-10-12', 'warning-audit');
  await page.addInitScript(doc => localStorage.setItem('lifelook.foundation.plan.v1', JSON.stringify(doc)), plan);
  await page.goto('/');
  const rows = page.locator('.projection-table-wrap tbody tr');
  await expect(rows).toHaveCount(30);
  await expect(page.locator('.projection-table-wrap td p')).toHaveCount(0);
  await page.setViewportSize({width:1440, height:1000});
  expect(await rows.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height <= 80))).toBe(true);
  await page.getByTestId('annual-2056-net-worth').getByRole('button', {name:/Needs data/}).click();
  await expect(page.getByRole('region', {name:'Net worth · 2056'})).toContainText('2027–2056');
});
```

The 80 px row budget is a plan acceptance target for this desktop default scenario at normal zoom, not a claim about arbitrary fonts/zoom. Also exercise hover-to-popup movement, focus preview, Enter/Space activation, tap in a touch-enabled context, Escape/Close and focus return, horizontal table scroll, 390 px viewport, and 200% equivalent zoom/text size. Assert an open panel stays within the viewport and can scroll; check long content near the right/bottom edge. Switch tabs/collapse-reopen sections and Save while details are open: no stale portals or dead triggers. Review actions reach the correct collapsed history without focus returning to the report.

Extend quota restoration to edit afterward: recovery action remains visible, and downloaded JSON still equals applied inputs rather than the draft. Malformed import preserves drafts; accepted import clears them. Keep existing numerical reload/backup acceptance, HTML-like literal-name test, keyboard-only saves, and invalid-draft projection retention. Open methodology/details before asserting their content, rather than weakening visibility checks.

- [x] **Step 2: Run targeted acceptance.** `npm run test:e2e -- --grep 'compact|disclosure|quota|history'` → the newly named cases PASS; failure must identify an actual interaction/placement issue. jsdom cannot establish geometry, so do not substitute it for these checks.
- [x] **Step 3: Update README and manually inspect the two audit scenarios.** Describe optional explanations, visible completeness/uncertainty, explicit Unknown/zero/estimate states, applied-input backups, draft exclusion, and durable recovery. Check desktop/mobile views and saved-plan report values. Keep source-update/financial-rule documentation accurate; do not rewrite historical rebuild records.
- [x] **Step 4: Run the release checks once.** `npm run check` → typecheck, engine/browser suites, production build, and all Chromium acceptance flows PASS. Use the repository's installed Chromium cache or documented `PLAYWRIGHT_BROWSERS_PATH`; install only if absent. Run broader/repeated checks only if changes or failures justify them. Record evidence and any remaining limitation in the implementation handoff.
- [x] **Step 5: Commit the acceptance/documentation work.** Stage `tests/e2e/workspace.spec.ts`, `README.md`, and this plan; include the audit document if it is still untracked and part of the reviewed requirements. Commit `test: verify compact warnings and recovery flows`. Do not push.

## Coverage and execution handoff

| Audit requirements | Tasks |
| --- | --- |
| Measured paragraph duplication, carried years, compact tables and exact causes | 1–3, 8 |
| Coverage/provenance/funding boundaries, ratios, candidate taxes, tax/rental/contribution details | 2–3 |
| All form hints/labels, tri-state histories, units, eligibility and Unknown/zero/estimate distinctions | 4–6 |
| Collapsed property sections, independent books, opening estimates and error discovery | 4–5 |
| Shell statuses, recovery lifetime, backups and action consequences | 7 |
| Keyboard/hover/touch, safe text, lifecycle, viewport/scrolling and regression contracts | 1–2, 4, 8 |

Implemented inline on `main`. The task commits preserve engine, rule-pack, fixture, storage-key and schema contracts. The independent whole-branch review and its final regression-verified fix pass are complete.

## Implementation handoff

- Release verification: `PLAYWRIGHT_BROWSERS_PATH=/tmp/lifelook-foundation-browser-cache npm run check` passed 597 engine/browser tests, production build and all 10 Chromium acceptance flows.
- Desktop/mobile inspection: the default 30 annual rows contain no explanation paragraphs in amount cells and reach a maximum row height of 50.55 px at the audit desktop viewport. The populated fixture retains annual net worth `$363,536.05`; all eight saved property disclosures start closed.
- Chromium covers keyboard, hover-to-preview movement, touch, 390 px width, enlarged text, horizontal scrolling, hidden sections, result replacement, destination focus, native financial entry and applied-input recovery exports.
- Acceptance exposed and corrected focus after hover Escape, popup placement after text-size changes, owner-document cleanup, account routing for unknown IRA basis and visible combined valuation dates. Employer history entry now selects saved salaries by their human names.
- The independent review found six important feedback/recovery defects. Each received a mounted-workspace RED→GREEN regression: rejected removals now show dependency errors beside the initiating action; annual coverage reviews reach the effective override; ambiguous employer warnings reach the employer group; absent required properties retain field feedback; loss reconciliation targets its group without marking a valid year invalid; unchanged Save retries persist applied inputs without creating a new revision. No findings were deferred or declined.
- Execution ruling: Testing Library role queries use exact string names without the unsupported `exact:true` option; product behavior is unchanged.
