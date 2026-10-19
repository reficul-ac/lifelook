# LifeLook UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LifeLook’s dense form interface with Layout A, precise guided entry, accessible dark/light styling, and record-scoped live financial previews that apply exactly the reviewed change.

**Architecture:** Keep the existing TypeScript financial engine, JSON formats, and scenario publication/storage boundary. Share candidate preparation between legacy Save and preview/Apply, calculate cancellable previews in a worker, and render each report with its producing plan. Compose a full-width overview, compact record collections, and one focused editor from small browser modules.

**Tech Stack:** Node 22, TypeScript 5.7, Vite 6.4, native DOM/CSS and module workers, Decimal.js, Vitest/jsdom/Testing Library, Playwright Chromium. No new runtime dependency or framework migration.

**Spec:** [LifeLook interface and live financial preview](../specs/2026-10-18-lifelook-ui-revamp-design.md). Read the complete spec before executing this plan.

## Global Constraints

- “The engine remains independent of browser APIs, storage, and the clock.”
- “Financial schema version 1, workspace envelope format, record IDs, explicit unknowns, provenance, and backup compatibility remain unchanged.”
- “Existing stored arrays and inputs are not normalized or rewritten during loading.”
- “Dark is the initial appearance. Settings offers Dark, Light, and System.”
- Persist appearance under `lifelook.ui.preferences.v1`, outside financial inputs/backups; appearance failure must not block financial work.
- “Show/hide changes visibility only. Hidden values continue to affect calculations.”
- “Other unfinished drafts are excluded, even if they appear in the same collection.”
- “Previewing does not consume or publish a revision.” Apply commits only the current completed candidate; existing Remove/scenario/restore revision rules remain.
- “Worker absence may use the existing synchronous fallback pattern; a broken supported worker reports a failure rather than silently running the expensive calculation on the main thread.”
- Initial preview scheduling: 100 ms quiet time, 300 ms maximum wait, immediate committed-input/drag-end flush; interaction motion approximately 160–240 ms, with reduced-motion support.
- Keep approximately 600 CSS pixels for the report and 380 for an editor before choosing the wide composition; otherwise show the narrow Edit/Forecast interaction.
- “The final delivery must include all existing feature paths listed in section 2; internal sequencing is not permission to drop complex editors.”
- Work and commit on `main` under `CLAUDE.md`; no worktree/feature branch is needed. No push without explicit confirmation for `reficul-ac/lifelook`, remote `origin`, branch `main`.

## Review Focus

1. Pasted grouping, partial negatives, and valid values outside a slider range must retain exact input without silently becoming another amount — Task 4, `preserves malformed grouping and out-of-range exact values`.
2. Identical record IDs/revisions after restore, plus a current-but-inactive scenario, must not authorize a late preview or Apply — Tasks 3 and 7, `rejects restored and inactive owners`.
3. An unrelated Apply while an older preview is visible must hide old deltas and rebuild against the new base; changing the edited bundle must instead reject the stale draft — Tasks 3 and 6, `does not compare an old candidate with a new base`.
4. A purchase crossing January 1/January 2 of the forecast start year must change its requirements while retaining manually entered payment/value dates — Task 10, `reclassifies at the forecast boundary without replacing manual facts`.
5. A canceled prerequisite-account detour must create no applied IRA; applying its account must not confirm clean tax history or apply the allocation — Task 13, `requires two explicit applies for a source IRA and allocation`.

---

## File Structure and Dependency Order

Existing entry points and standalone section-renderer APIs remain adapters. New units have one responsibility:

| Files | Responsibility | Task |
| --- | --- | --- |
| `src/browser/input-parsers.ts`, `src/browser/draft-codec.ts` | Existing exact numeric parsing and raw/model conversion extracted without changed semantics. | 1 |
| `src/browser/edit-types.ts`, `src/browser/edit-candidate.ts`; `src/browser/state.ts` | Transaction types, stable candidate assembly/equality, private controller preparation/publication bridge. | 1–2 |
| `src/browser/edit-preview.ts`, `src/browser/edit-preview-worker.ts` | Ownership, scheduling, cancellation, current/retained calculation state. | 3 |
| `src/browser/ui/appearance.ts`, `src/browser/ui/numeric-control.ts`, `src/browser/ui/anniversary-control.ts`; `src/browser/styles/tokens.css`, `src/browser/styles/controls.css`, `src/browser/styles/workspace.css` | Theme, precise controls, motion and responsive visual primitives. | 4, 7 |
| `src/browser/record-ui-state.ts`, `src/browser/record-form.ts`; `src/browser/fields.ts`, existing `src/browser/forms/*.ts` | One-record mounting, raw mode caches, disclosure/step/touched memory. | 5 |
| `src/browser/report-snapshot.ts`, `src/browser/overview-model.ts`, `src/browser/views/overview.ts`, `src/browser/views/report-state.ts` | Producing-plan snapshots, availability-safe comparison, mounted report regions. | 6 |
| `src/browser/workspace-route.ts`, `src/browser/workspace-shell.ts`, `src/browser/record-collections.ts`, `src/browser/focused-editor.ts`; `src/browser/editor-view.ts` | Stable destinations, Layout A, one active transaction, narrow Edit/Forecast views. | 7 |
| `src/browser/forms/income.ts`, `src/browser/forms/investments.ts`, `src/browser/forms/rsu.ts`, `src/browser/forms/salary-fields.ts`, `src/browser/forms/account-fields.ts`, `src/browser/forms/contribution-fields.ts` | Salary/other-income and account/contribution/RSU workflows. | 8–9 |
| `src/browser/forms/properties.ts`, `src/browser/forms/property-basics.ts`, `src/browser/forms/property-financing.ts`, `src/browser/forms/property-rentals.ts`, `src/browser/forms/property-costs.ts`, `src/browser/forms/property-history.ts` | Focused property/purchase/loan/rental groups and their existing helpers. | 10 |
| `src/browser/forms/adu-project.ts`, `src/browser/forms/adu-basics.ts`, `src/browser/forms/adu-funding.ts`, `src/browser/forms/adu-tax-fields.ts` | Focused ADU setup, funding, tax/history groups within the property transaction. | 11 |
| `src/browser/forms/household.ts`, `src/browser/forms/expenses-debts.ts`, `src/browser/forms/children.ts` | Household, spending, debt and child-planning groups. | 12 |
| `src/browser/prerequisite-flow.ts`; `src/browser/forms/cash-flow-allocation.ts` | Explicit prerequisite Apply/return flow and allocation integration. | 13 |
| `src/browser/views/attention.ts`, `src/browser/settings.ts`, `src/browser/persistence-status.ts`; routing/feedback/backup views | Actionable issues, appearance/settings, compact but persistent recovery. | 14 |
| `tests/helpers/editing.ts`, `tests/helpers/preview-worker.ts`, `tests/helpers/workspace-ui.ts` | Synthetic controller, controlled-worker and explicit UI navigation helpers. | 1–3, 7 |

Execute 1 → 2 → 3; Task 4 can be researched independently. Tasks 5 and 6 consume the shared types; Task 7 integrates 3–6. Tasks 8–14 extend that working shell. Task 15 verifies the complete application. Any parallel execution must give one worker ownership of shared `state.ts`, `fields.ts`, `editor-view.ts`, session types and test helpers at a time.

## Shared Contracts

Define these names in the owning task; later tasks import them. Browser-only types never enter `src/engine/` or JSON:

```ts
// edit-types.ts; EditableSection is a type-only import from state.ts.
type EditTarget =
  | Readonly<{kind: 'record'; section: EditableSection; recordId: string}>
  | Readonly<{kind: 'allocation'}>;
interface ReadyEdit {
  readonly status: 'ready'; readonly target: EditTarget;
  readonly plan: ValidatedPlan; readonly basePlan: ValidatedPlan;
  readonly ruleSet: RuleSet; readonly controllerEpoch: number;
  readonly draftGeneration: number; readonly token: number;
}
type PreparedEdit = ReadyEdit
  | Readonly<{status: 'unchanged'}>
  | Readonly<{status: 'invalid' | 'stale'; issues: readonly Issue[]}>;
interface CalculatedEdit {
  readonly prepared: ReadyEdit; readonly projection: ProjectionResult;
}
// A CalculatedEdit object serves as an opaque receipt: the controller must
// privately register its object identity, not trust structural equality.
interface EditPreviewOwner extends PreviewOwner {readonly workspaceGeneration: number}
interface PreviewReport {
  readonly plan: PlanDocument; readonly projection: ProjectionResult;
  readonly basePlan: PlanDocument | null;
}
interface EditPreviewState {
  readonly status: 'inactive' | 'pending' | 'valid' | 'invalid' | 'stale' | 'failed';
  readonly target: EditTarget | null;
  readonly current: CalculatedEdit | null; readonly lastValid: PreviewReport | null;
  readonly issues: readonly Issue[];
}
interface EditPreviewCoordinator {
  getState(): EditPreviewState;
  subscribe(listener: (state: EditPreviewState) => void): () => void;
  select(target: EditTarget | null): void;
  request(flush?: boolean): void;
  apply(): SaveRecordResult; discard(): void; dispose(): void;
}
```

Use existing `makePlan`, `makeAllocationPlan`, `makeFuturePurchasePlan`, `makeAduPlan`, and `memoryWorkspaceStorage` fixtures. A monetary input such as `100000.00` is raw dollars; `10_000_000` in a candidate is cents. `memoryWorkspaceStorage().writes()` is a function. Test snippets omit imports and repeated local fixture setup: controller/store come from `createEditHarness`, or an explicitly mounted production workspace with a valid preloaded synthetic envelope; editor comes from `openRecord`; report-state fixtures use the defined snapshot/coordinator APIs. Declare local spies and fixture variables in the suite; do not add production test hooks. Do not copy private fixture functions from an existing test without promoting the needed helper explicitly.

### Task 1: Shared Transaction Preparation, Stable Order, and No-Op Detection

**Files:** Create `src/browser/input-parsers.ts`, `src/browser/draft-codec.ts`, `src/browser/edit-types.ts`, `src/browser/edit-candidate.ts`, `tests/helpers/editing.ts`, `tests/browser/edit-candidate.test.ts`. Modify `src/browser/state.ts`, `src/browser/fields.ts`; extend `tests/browser/state.test.ts`, `tests/browser/review-transactions.test.ts`, `tests/browser/cash-flow-allocation-state.test.ts`.

**Interfaces:** Consume existing `fromDraftValue`, `toDraftValue`, `validatePlan`, property snapshots and allocation snapshots. Produce `prepareEdit(controller: WorkspaceController, target: EditTarget): PreparedEdit` from `state.ts`; `buildEditCandidate(base: ValidatedPlan, target: EditTarget, decoded: RawObject): PlanDocument` and `equalActiveEdit(left: unknown, right: unknown): boolean` from `edit-candidate.ts`. Test helper `createEditHarness(plan?: PlanDocument): {controller: WorkspaceController; store: ReturnType<typeof memoryWorkspaceStorage>}` defaults to `makeAllocationPlan()`; `setDraftField(controller: WorkspaceController, target: EditTarget, path: FieldPath, value: unknown): void` handles both draft kinds.

- [ ] **Step 1: Add failing preparation tests.** Assert the following using the named fixtures/helpers; add property-bundle stale and allocation cases in the listed existing suites.

```ts
it('prepares without applying and excludes unrelated drafts', () => {
  const {controller, store} = createEditHarness();
  const target = {kind:'record', section:'salaries', recordId:'salary-a'} as const;
  const before = controller.getState();
  setDraftField(controller, target, ['annualGrossCents'], '125000.00');
  const prepared = prepareEdit(controller, target);
  expect(prepared).toMatchObject({status:'ready', plan:{revision:1}});
  expect(controller.getState().savedPlan).toBe(before.savedPlan);
  expect(controller.getState().projection).toBe(before.projection);
  expect(store.writes()).toBe(0);
});
it('recognizes formatting-only and reversed edits', () => {
  const {controller} = createEditHarness();
  const target = {kind:'record', section:'salaries', recordId:'salary-a'} as const;
  setDraftField(controller, target, ['annualGrossCents'], '100000.0');
  expect(prepareEdit(controller, target)).toEqual({status:'unchanged'});
  expect(equalActiveEdit({known:false}, {known:true,value:0})).toBe(false);
});
```

Also pin `[first, second]` equal-priority contribution IDs after editing `first`; candidate contains only the selected draft; a property candidate replaces its complete linked bundle; missing/changed IDs reject; a genuinely new zero-valued record is not a no-op; object-key order is ignored while array order/optional absence remain meaningful.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/edit-candidate.test.ts`; expect missing preparation/helper exports or failed order/no-op assertions.
- [ ] **Step 3: Implement the preparation boundary.** Move parsers/codec unchanged and re-export their old names from `fields.ts`/`state.ts` to preserve callers. Keep bases/rules/epochs private through a controller bridge. Decode once, exclude inactive browser caches, check the original owning snapshot and immutable IDs, merge existing records in place/new records at the end, then validate the complete candidate. Use the existing linked-property-expense ownership rules. Semantic equality excludes the candidate revision and browser metadata only. Route legacy Save/property/allocation preparation through this same path without changing `EditorPublicationPort`; legacy callers still calculate synchronously when they actually Save. An unchanged accepted Save performs no write/revision; explicit retry remains the persistence retry API.
- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/edit-candidate.test.ts tests/browser/state.test.ts tests/browser/review-transactions.test.ts tests/browser/cash-flow-allocation-state.test.ts` and `npm run typecheck`; expect all pass, with unchanged raw text and applied identities on rejected preparation.
- [ ] **Step 5: Commit.** Stage the Task 1 files explicitly, run `git diff --cached --check`, then `git commit -m "refactor: share financial edit candidate preparation"`.

### Task 2: Receipt-Based Apply Through Existing Publication

**Files:** Modify `src/browser/state.ts`, `src/browser/edit-types.ts`, `tests/helpers/editing.ts`; extend `tests/browser/editor-publication.test.ts`; create `tests/browser/edit-receipts.test.ts`.

**Interfaces:** Consume Task 1 `prepareEdit`/`ReadyEdit`. Produce `completePreparedEdit(controller: WorkspaceController, prepared: ReadyEdit, projection: ProjectionResult): CalculatedEdit | null` and `applyCalculatedEdit(controller: WorkspaceController, calculated: CalculatedEdit): SaveRecordResult` from `state.ts`. Add helper `calculateEdit(controller: WorkspaceController, target: EditTarget): CalculatedEdit`, which prepares, calculates with captured rules, and obtains a registered receipt or throws the actual issues.

- [ ] **Step 1: Add failing receipt/publication tests.** Use `createEditHarness`, change salary-a to `125000.00`, and pin these assertions:

```ts
it('applies the registered projection without recalculating', () => {
  const receipt = calculateEdit(controller, target);
  const calculate = vi.spyOn(engine, 'calculateProjection');
  expect(applyCalculatedEdit(controller, receipt).accepted).toBe(true);
  expect(calculate).not.toHaveBeenCalled();
  expect(controller.getState().projection).toBe(receipt.projection);
  expect(controller.getState().savedPlan.revision).toBe(1);
  expect(applyCalculatedEdit(controller, receipt).accepted).toBe(false);
});
it('rejects a reconstructed receipt and wrong result revision', () => {
  const receipt = calculateEdit(controller, target);
  expect(applyCalculatedEdit(controller, {...receipt}).accepted).toBe(false);
  expect(completePreparedEdit(controller, receipt.prepared,
    {...receipt.projection, inputRevision:999})).toBeNull();
});
```

Add cases for editing/discarding after completion, unrelated-base change, controller reset with reused IDs/revisions, port rejection preserving drafts, accepted publication with failed storage, and clearing only the owning bundle/policy draft.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/edit-receipts.test.ts tests/browser/editor-publication.test.ts`; expect missing receipt APIs or freshness/publication failures.
- [ ] **Step 3: Implement receipt registration and consumption.** Register issued preparations/completions privately by object identity and controller epoch. Verify the exact current base, target draft generation, rules, candidate/result revisions, and unused receipt before entering existing synchronous `port.publish(plan, projection, commitSession)`. Publish both together; clear drafts only inside the accepted commit callback. Keep storage failures distinct from rejection. Legacy Save paths use the same commit operation with their own newly calculated result. Do not change manager validation/recovery semantics.
- [ ] **Step 4: Verify green.** Run the two Task 2 suites plus `npm run test:browser -- tests/browser/scenario-manager.test.ts tests/browser/adu-project-state.test.ts` and `npm run typecheck`; expect no duplicate calculation and all atomicity/recovery tests passing.
- [ ] **Step 5: Commit.** Stage the Task 2 files, diff-check, then `git commit -m "feat: apply completed edit previews atomically"`.

### Task 3: Cancellable Record and Allocation Preview Coordinator

**Files:** Create `src/browser/edit-preview.ts`, `src/browser/edit-preview-worker.ts`, `tests/helpers/preview-worker.ts`, `tests/browser/edit-preview.test.ts`. Modify `src/browser/edit-types.ts`, `src/browser/allocation-preview.ts`, `src/browser/scenario-session.ts`, `src/browser/forms/cash-flow-allocation.ts`; extend `tests/browser/allocation-preview.test.ts`.

**Interfaces:** Consume Tasks 1–2 and existing `PreviewOwner`. Produce `createEditPreviewCoordinator(controller: WorkspaceController, ownership: {owner: EditPreviewOwner; isCurrent(): boolean}, options?: {quietMs?: number; maxWaitMs?: number; allocationSession?: AllocationPreviewSession}): EditPreviewCoordinator`. `AllocationPreviewSession` is the existing scenario-session type; allow its retained `lastValid` pair to carry optional `basePlan:PlanDocument`. Worker request type `EditPreviewWorkerRequest` is `{jobId:number; owner:EditPreviewOwner; token:number; plan:ValidatedPlan; ruleSet:RuleSet}`; `EditPreviewWorkerReply` echoes `jobId`, `owner`, `token` and has `result: {status:'calculated'; projection:ProjectionResult} | {status:'failed'; issues:readonly Issue[]}`. Export `calculateEditPreview(request: EditPreviewWorkerRequest): EditPreviewWorkerReply` for worker tests. Extend `AllocationEditorOptions` with optional `preview: Pick<EditPreviewCoordinator,'getState'|'subscribe'|'request'|'apply'|'discard'>`; externally supplied coordinators are never disposed by the form.

- [ ] **Step 1: Add failing worker/timer tests.** Promote the existing ControlledWorker/RAF pattern into `tests/helpers/preview-worker.ts`; `installPreviewWorker(): {flush(ms?: number): void; workers: ControlledPreviewWorker[]; restore(): void}` uses fake timers, a controlled RAF, and recorded module-worker requests; each worker exposes `request`, `terminated`, and `reply(overrides?: Partial<EditPreviewWorkerReply>): void`.

```ts
it('coalesces edits and applies only the latest completion', () => {
  coordinator.select(target);
  setDraftField(controller, target, ['annualGrossCents'], '125000.00');
  clock.flush(99); expect(clock.workers).toHaveLength(0);
  clock.flush(1); expect(clock.workers).toHaveLength(1);
  setDraftField(controller, target, ['annualGrossCents'], '130000.00');
  expect(clock.workers[0]!.terminated).toBe(true);
  clock.workers[0]!.reply(); expect(coordinator.getState().current).toBeNull();
  coordinator.request(true); clock.flush(); clock.workers.at(-1)!.reply();
  expect(coordinator.apply().accepted).toBe(true);
});
```

Pin 300 ms max-wait during a continuous drag, immediate flush, invalid draft retaining `lastValid` but no `current`, unchanged edits returning inactive, worker error/messageerror/constructor failure, Worker-absent fallback, wrong token/revision/rules ownership, close/discard/dispose, and `rejects restored and inactive owners` even when financial IDs/revisions match. Reopen an invalid allocation draft after switching: restore its retained report pair but no Apply receipt until a fresh valid calculation. `does not compare an old candidate with a new base` must clear `current` immediately and schedule a fresh candidate.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/edit-preview.test.ts`; expect missing coordinator/transport behavior.
- [ ] **Step 3: Implement coordination.** Store local prepared identities outside messages. Only register receipts after serializable ownership/job/token checks plus local current-base/draft checks. Coalesce scheduled work, terminate obsolete workers, expose honest pending/invalid/stale/failed states, and clear active record state on `select(null)`. A retained `PreviewReport` is display data, never a receipt. Read/write only the owning scenario’s allocation-session cache; older cache pairs without a base get `basePlan:null` and no deltas. Guard Apply with `isCurrent()`, not only scenario existence. Preserve allocation’s old scheduler/result API as a compatibility adapter, including applied-base `inputRevision`; unchanged legacy allocation preview uses applied results without creating a synthetic edit. A focused allocation form receiving `preview` starts no second worker. Inert allocation defaults must not become edits merely by opening the editor.
- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/edit-preview.test.ts tests/browser/allocation-preview.test.ts tests/browser/cash-flow-allocation-forms.test.ts tests/browser/adu-comparison.test.ts` and `npm run typecheck`; expect correct timing/ownership and unchanged independent ADU comparison behavior.
- [ ] **Step 5: Commit.** Stage Task 3 files, diff-check, then `git commit -m "feat: calculate cancellable financial edit previews"`.

### Task 4: Appearance, Motion, and Precise Input Primitives

**Files:** Create `src/browser/ui/appearance.ts`, `src/browser/ui/numeric-control.ts`, `src/browser/ui/anniversary-control.ts`, `src/browser/styles/tokens.css`, `src/browser/styles/controls.css`, `tests/browser/appearance.test.ts`, `tests/browser/numeric-control.test.ts`. Modify `src/browser/styles.css`, `src/browser/fields.ts`; extend `tests/browser/forms.test.ts` for field associations without changing the application shell yet.

**Interfaces:** `AppearanceChoice = 'dark' | 'light' | 'system'`; `mountAppearance(root: HTMLElement, storage: StoragePort, media: MediaQueryList): {getChoice(): AppearanceChoice; setChoice(choice: AppearanceChoice): void; dispose(): void}` sets `root.dataset.theme` to the effective dark/light theme. Export `normalizeNumericText(text: string, kind: 'money' | 'rate'): string`. `mountNumericControl(host: HTMLElement, options: {label:string; field:string; kind:'money'|'rate'; raw:string; slider?:{minUnits:number; maxUnits:number; stepUnits:number}; onInput(raw:string):void; onCommit():void}): {input:HTMLInputElement; update(raw:string):void; dispose():void}` uses integer cents/basis points for slider units. `mountAnniversaryControl(host: HTMLElement, options: {month:string; day:string; onChange(month:string, day:string):void}): {update(month:string, day:string):void; dispose():void}` maps readable month/day controls to existing values.

- [ ] **Step 1: Add failing behavior tests.** Test dark default without a write, saved light preference, live System changes, unsupported/corrupt preference fallback, storage exceptions, and listener disposal. Store JSON `{theme: choice}` only under `lifelook.ui.preferences.v1`.

```ts
it('preserves malformed grouping and out-of-range exact values', () => {
  expect(normalizeNumericText('1,234.50', 'money')).toBe('1234.50');
  expect(normalizeNumericText('1,23', 'money')).toBe('1,23');
  expect(normalizeNumericText('-', 'money')).toBe('-');
  const control = mountNumericControl(root, {
    label:'Expected return (%)', field:'annualGrowthBps', kind:'rate', raw:'25.00',
    slider:{minUnits:-1000,maxUnits:2000,stepUnits:25}, onInput, onCommit,
  });
  expect(control.input.value).toBe('25.00');
  expect(onInput).not.toHaveBeenCalled();
});
```

Add exact `1234.50 → 123450` conversion through the shared parser, preserved focused selection/partial text during `update`, negative-rate entry, slider arrow keys, correct labels/descriptions/errors, and February/day-31 anniversary mapping without changing the entered anniversary.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/appearance.test.ts tests/browser/numeric-control.test.ts`; expect missing controls/theme behavior.
- [ ] **Step 3: Implement the primitives and token styles.** Keep raw editing text separate from presentation grouping; remove grouping only when its syntax is valid, and let existing parsers reject other input. A clamped visual thumb never writes back to an out-of-range numeric field. Add optional slider configuration to `FieldOptions` and integrate precise controls through `renderField`, retaining `data-field`, accessible names, hint/error IDs, and optional-blank handling. Emit bubbling `financial-input-commit` on numeric blur, range change/drag completion, and committed date changes; Task 7 handles immediate preview flush. Keep native date/month inputs and readable anniversary controls. Migrate existing hard-coded palette rules, including dialogs/disclosures, warnings and funding tables, to semantic dark/light tokens; provide contrasting chart-series tokens. Add focus/touch styles and 160–240 ms movement with a reduced-motion override; add no appearance-driven financial writes.
- [ ] **Step 4: Verify green.** Run the Task 4 suites, existing `tests/browser/forms.test.ts`, and `npm run typecheck`; expect exact parsing/focus preservation and existing standalone field semantics to pass. Visual contrast/responsive verification belongs to Task 15, not tests of CSS implementation details.
- [ ] **Step 5: Commit.** Stage Task 4 files, diff-check, then `git commit -m "feat: add accessible themes and precise financial controls"`.

### Task 5: Single-Record Forms and Reversible Editor State

**Files:** Create `src/browser/record-ui-state.ts`, `src/browser/record-form.ts`, `src/browser/ui/editor-groups.ts`, `tests/browser/record-form.test.ts`, `tests/browser/record-ui-state.test.ts`. Modify `src/browser/fields.ts`, `src/browser/scenario-session.ts`, `src/browser/form-feedback.ts`, and each existing form wrapper: `src/browser/forms/household.ts`, `src/browser/forms/income.ts`, `src/browser/forms/investments.ts`, `src/browser/forms/expenses-debts.ts`, `src/browser/forms/children.ts`, `src/browser/forms/properties.ts`.

**Interfaces:** `RecordEditorMemory` has `step:string`, `openGroups:Set<string>`, `touched:Set<string>`, `attempted:boolean`, `modes:Map<string,RawObject>`, `scrollTop:number`, and `focus:{field:string; start:number|null; end:number|null}|null`. Export `createRecordEditorMemory(): RecordEditorMemory`, `editTargetKey(target: EditTarget): string`, and `swapMode(memory: RecordEditorMemory, key:string, from:string, to:string, current:RawObject, fallback:RawObject): RawObject`; cache mode-owned subtrees, not whole unrelated records. Add `EditorViewSession.editorMemory: Map<string,RecordEditorMemory>` and optional `FieldContext.memory?:RecordEditorMemory`. Export `fieldMemory(context:FieldContext):RecordEditorMemory` from `record-ui-state.ts`; focused contexts use their supplied memory and legacy contexts receive a stable WeakMap-backed fallback.

Each section wrapper retains its first three parameters and adds optional `FormRenderOptions = {section:EditableSection; recordId:string; memory:RecordEditorMemory; onSubmit():void}` as parameter four. `renderRecordForm(root: HTMLElement, controller: WorkspaceController, section: EditableSection, recordId: string, title: string, renderFields:(root:HTMLElement, context:FieldContext)=>void, ui?:IssueViewContext, options?:FormRenderOptions): HTMLFormElement` contains shared one-record context construction. Property extracts its own bundle-aware one-record renderer. `renderEditorGroup(root: HTMLElement, options:{id:string; label:string; advanced:boolean; step?:string; summary?:()=>string}, memory:RecordEditorMemory, render:(body:HTMLElement)=>void): HTMLElement` and `revealEditorField(root: HTMLElement, path:FieldPath, memory:RecordEditorMemory): boolean` live in `ui/editor-groups.ts`.

- [ ] **Step 1: Add failing focused-form/state tests.** Render only salary-a from `makeAllocationPlan()`; assert one form, full applied references still available, no legacy Save/Add toolbar, and submit invokes `onSubmit` without `saveRecord`. Verify default wrapper calls still render their complete sections. Pin reversible state:

```ts
it('retains inactive raw values without adding them to a candidate', () => {
  const memory = createRecordEditorMemory();
  const prior = {openingBalanceCents:'12.345', openingTaxableBasis:{known:false}};
  swapMode(memory, 'account-type', 'taxable-brokerage', 'rsu', prior, {grants:[]});
  expect(swapMode(memory, 'account-type', 'rsu', 'taxable-brokerage',
    {grants:[]}, {})).toEqual(prior);
});
```

Add hide/show preserving known-zero/unknown/blank histories, step reveal before focus, only blurred/attempted errors visible, and raw-mode caches remaining absent from decoded candidates/exports.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/record-form.test.ts tests/browser/record-ui-state.test.ts`; expect missing selected-form/state APIs.
- [ ] **Step 3: Extract and adapt rendering.** Filter record IDs before rendering; do not filter the controller’s plan or render all records and hide the excess. Extract named feature callbacks from wrapper closures. Legacy wrappers retain their Save/Discard behavior; focused forms submit only through `onSubmit` and the preview coordinator. Step fields remain mounted while hidden; reveal selects their owning step and opens ancestor disclosures before focus. Wire blur/attempt state to feedback. Keep per-target memory scenario-owned; clear inactive mode caches/touched errors after actual Apply or Discard while retaining useful step/disclosure preferences.
- [ ] **Step 4: Verify green.** Run the Task 5 suites plus `npm run test:browser -- tests/browser/form-feedback.test.ts tests/browser/properties.test.ts tests/browser/rsu-state.test.ts` and `npm run typecheck`; expect unchanged standalone renderer and financial semantics.
- [ ] **Step 5: Commit.** Stage Task 5 files, diff-check, then `git commit -m "refactor: mount focused financial record forms"`.

### Task 6: Producing-Plan Overview and Stable Report Regions

**Files:** Create `src/browser/report-snapshot.ts`, `src/browser/overview-model.ts`, `src/browser/views/overview.ts`, `src/browser/views/report-state.ts`, `tests/browser/overview-model.test.ts`, `tests/browser/overview-state.test.ts`. Modify `src/browser/issue-presentation.ts`, `src/browser/views/projection.ts`, `src/browser/views/forecast-summary.ts`, `src/browser/views/forecast-plots.ts`, `src/browser/views/tax-explanation.ts`, `src/browser/views/issues.ts`, `src/browser/views/cash-flow-allocation.ts`, `src/browser/views/adu-comparison.ts`, `src/browser/scenario-session.ts`, and `tests/helpers/presentation.ts`; extend existing summary/plot/reporting tests.

**Interfaces:** `ReportSnapshot` is `{plan:PlanDocument; projection:ProjectionResult; comparison:{plan:PlanDocument; projection:ProjectionResult}|null; status:'applied'|'preview'|'updating'|'paused'|'failed'; label:string; allowDeltas:boolean}`. Export `selectReportSnapshot(state:WorkspaceState, preview:EditPreviewState): ReportSnapshot`. `BalanceSheetRow` is `Pick<AnnualProjection,'year'|'reserveCents'|'accountBalanceCents'|'propertyValueCents'|'loanBalanceCents'|'netWorthCents'>`; `OverviewMetric` is its monetary keys plus `'cashFlowCents'`. `buildOverviewRows(snapshot:ReportSnapshot): readonly {balance:BalanceSheetRow; financial:ProjectionSummaryRow; deltas:Readonly<Record<OverviewMetric,Available<Cents>|null>>; noComparison:boolean}[]` uses the existing summary adapter.

Add optional `producingPlan` to shared `IssueViewContext` and define `ReportIssueContext = IssueViewContext & {readonly producingPlan:PlanDocument}`; `withProducingPlan(context:IssueViewContext, plan:PlanDocument): ReportIssueContext` creates it. Require this subtype for report renderers, while `readState()` continues to describe actual editor state. `ReportViewState = {tableView:'balance-sheet'|'financial-overview'; expanded:Set<string>; scroll:Map<string,{top:number; left:number}>}` belongs to `EditorViewSession.reportState`. `mountOverview(root:HTMLElement, snapshot:ReportSnapshot, context:IssueViewContext, view:EditorViewSession): {update(snapshot:ReportSnapshot):void; dispose():void}` derives a current report context on each update.

- [ ] **Step 1: Add failing model/report preservation tests.** Use `makePlan` with zero growth and independent known amounts for exact delta assertions; separately reuse incomplete rental/ADU fixtures.

```ts
it('does not compare an old candidate with a new base', () => {
  const displayed = selectReportSnapshot(newAppliedState, pendingOldPreview);
  expect(displayed.status).toBe('updating');
  expect(displayed.allowDeltas).toBe(false);
  expect(displayed.comparison).toBeNull();
});
it('keeps producing labels and report state during updates', () => {
  binding.update(candidateSnapshot);
  expect(root).toHaveTextContent('Renamed candidate account');
  expect(monthToggle.isConnected).toBe(true);
  expect(monthToggle).toHaveAttribute('aria-expanded', 'true');
  expect(tableScroll.scrollLeft).toBe(160);
  expect(activeInput).toHaveFocus();
});
```

Also assert a known `10000 → 12500` amount yields `+2500`, genuine zero displays, unavailable/overflow produces no numeric delta, candidate-only years show No applied comparison, and retained reports never read applied names/account types by mistake. A positive debt delta must be described as debt increasing, without a beneficial-gain cue. Pin all six balance-sheet columns and all existing Financial overview definitions.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/overview-model.test.ts tests/browser/overview-state.test.ts`; expect missing snapshots/overview or state-reset failures.
- [ ] **Step 3: Implement snapshot/model and mounted views.** Map existing engine fields directly; use Decimal/settleCents for delta range safety. Replace implicit report `savedPlan`/allocation-only context reads with producing-plan context, including the plan passed into issue-target resolution, without substituting the candidate into `readState()`. Normalize years against that plan. Reconcile keyed year/month/tax/asset regions and retain scroll containers/expanders; keys such as `year:2026:months` exclude revisions. Keep diagnostic tables optional, table headers sticky, and chart controls accessible with series colors from theme tokens. ADU comparison is explicitly applied-only; remove obsolete details/actions safely.
- [ ] **Step 4: Verify green.** Run Task 6 tests plus `npm run test:browser -- tests/browser/forecast-summary.test.ts tests/browser/forecast-plots.test.ts tests/browser/reporting.test.ts tests/browser/adu-reporting.test.ts tests/browser/cash-flow-allocation-reporting.test.ts` and `npm run typecheck`; expect preserved financial meaning, availability and view state.
- [ ] **Step 5: Commit.** Stage Task 6 files, diff-check, then `git commit -m "feat: show coherent live balance sheet comparisons"`.

### Task 7: Layout A Shell, Collections, and Editor Routing

**Files:** Create `src/browser/workspace-route.ts`, `src/browser/workspace-shell.ts`, `src/browser/record-collections.ts`, `src/browser/focused-editor.ts`, `src/browser/styles/workspace.css`, `tests/helpers/workspace-ui.ts`, `tests/browser/workspace-shell.test.ts`. Modify `src/browser/scenario-app.ts`, `src/browser/editor-view.ts`, `src/browser/navigation.ts`, `src/browser/scenario-session.ts`, `src/browser/scenario-manager.ts`, `src/browser/styles.css`, `tests/helpers/dom.ts`, `tests/e2e/helpers/workspace.ts`. Migrate affected mount-based browser tests in `tests/browser/forms.test.ts`, `tests/browser/financial-forms.test.ts`, `tests/browser/scenario-forms.test.ts`, `tests/browser/scenario-review-regressions.test.ts`, `tests/browser/form-feedback.test.ts`, `tests/browser/review-feedback.test.ts`, `tests/browser/rsu-forms.test.ts`, `tests/browser/child-planning.test.ts`, `tests/browser/future-property-purchases.test.ts`, `tests/browser/adu-project-forms.test.ts`, `tests/browser/adu-comparison.test.ts`, `tests/browser/brokerage-funding-forms.test.ts`, `tests/browser/cash-flow-allocation-forms.test.ts`, `tests/browser/backdoor-roth-forms.test.ts`, `tests/browser/backup-controls.test.ts`.

**Interfaces:** `Destination = 'overview'|'income'|'accounts'|'properties'|'spending'|'household'`. `WorkspaceRoute = {destination:Destination; editor:{target:EditTarget; returnTo:Destination; origin:HTMLElement|null}|null; surface:'edit'|'forecast'}` is transient to a mounted activation. Export `destinationForSection(section:InputSection): Destination` and `targetForReview(target:ReviewTarget, state:IssueViewState, producingPlan:PlanDocument): EditTarget|null`. `collectRecords(state:WorkspaceState, destination:Destination): readonly {target:EditTarget; name:string; facts:readonly string[]; hasDraft:boolean; attentionCount:number}[]` renders strings as text.

`mountWorkspaceShell(root:HTMLElement, view:EditorViewSession, actions:{navigate(destination:Destination):void; open(target:EditTarget, origin:HTMLElement|null):void; close():void; surface(value:'edit'|'forecast'):void}): {overview:HTMLElement; collection:HTMLElement; editor:HTMLElement; update(route:WorkspaceRoute):void; dispose():void}` owns layout only. `mountFocusedEditor(root:HTMLElement, session:ScenarioEditorSession, target:EditTarget, context:IssueViewContext, coordinator:EditPreviewCoordinator): {reveal(field:string):boolean; dispose():void}` selects the Task 5 record renderer or externally coordinated allocation form. Preserve `mountEditorView(root,session,manager,activationGeneration)` as the integration entry point.

- [ ] **Step 1: Add failing shell/session tests.** Pin initial Overview, compact collections, Add creating only a draft, one active editor, return destination/focus, nested loan/rental issue routing to its property, and state retention on Edit/Forecast toggles. Add `rejects restored and inactive owners`: `manager.isCurrentTarget()` being true for an inactive scenario is insufficient; require current active session and activation generation before preview Apply. Failed scenario preparation must leave the source editor/coordinator usable.

```ts
it('closes preview while retaining raw drafts across scenario switches', async () => {
  const editor = openRecord(root, {kind:'record',section:'salaries',recordId:'salary-a'});
  setField(editor, 'Annual gross salary ($)', '1.234');
  await switchScenario(root, 'fork'); await switchScenario(root, 'master');
  expect(root.querySelector('[data-active-editor]')).toBeNull();
  expect(manager.getActiveSession().controller.getState().drafts['salary-a']
    ?.value.annualGrossCents).toBe('1.234');
});
```

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/workspace-shell.test.ts`; expect missing navigation/collection/editor behavior.
- [ ] **Step 3: Integrate the shell.** Add `selections.destination`, initialize new/reloaded sessions at Overview, and copy only year/plot preferences for forks. Keep editor route transient and memory scenario-owned. Compose coordinator → snapshot → mounted report, passing `session.view.allocationPreview` as `allocationSession`; subscribe without remounting controls. Handle `financial-input-commit` with `request(true)`. Create the footer action from preview state; Enter uses the same guarded Apply. Use Apply salary changes, Apply account, Apply contribution, Apply household changes, Apply property changes, and Apply allocation for those targets; remaining ordinary targets use Apply changes. Close has accessible name Close editor. Invalid forms offer Review inputs, not a disabled unexplained button. Stable mapping replaces text-based navigation; opening a target precedes reveal/focus. Narrow layout uses retained Edit/Forecast nodes, an impact ribbon and sticky footer; wide layout honors minimum useful widths. Put existing backup controls inside a working Settings disclosure in `scenario-app.ts` now; Task 14 extracts/finishes it, so backup tests never depend on a future module.

Add explicit helpers in `tests/helpers/workspace-ui.ts`: `openRecord(root:HTMLElement,target:EditTarget): HTMLElement`, `openCollection(root:HTMLElement,destination:Destination): HTMLElement`, `waitForPreview(root:HTMLElement): Promise<void>`, `switchScenario(root:HTMLElement,id:string): Promise<void>`. They interact with stable UI roles/data-target keys, never private shell functions. Scope `setField` to an active editor when present, without auto-opening Household. Update mount-based tests to explicitly open records and await valid previews; standalone form tests keep legacy adapters. In `tests/e2e/helpers/workspace.ts`, export corresponding `openRecord(page:Page,target:EditTarget):Promise<Locator>`, `openCollection(page:Page,destination:Destination):Promise<Locator>`, `waitForPreview(page:Page):Promise<void>`, and `switchScenario(page:Page,id:string):Promise<void>` plus Settings-based backup access. Do not preserve obsolete input-first behavior in a hidden test-only shell.
- [ ] **Step 4: Verify green.** Run `npm run test:browser` and `npm run typecheck`; expect all existing browser behaviors plus new shell tests to pass. Run `npm run test:e2e -- tests/e2e/scenarios.spec.ts tests/e2e/forecast-overview.spec.ts` after migrating those flows to explicit collection/editor actions.
- [ ] **Step 5: Commit.** Stage Task 7 implementation/helper/migrated test files explicitly, diff-check, then `git commit -m "feat: center the workspace on the balance sheet"`.

### Task 8: Salary and Other-Income Entry

**Files:** Create `src/browser/forms/salary-fields.ts`, `tests/browser/income-editor.test.ts`. Modify `src/browser/forms/income.ts`, `src/browser/record-collections.ts`; extend `tests/browser/financial-forms.test.ts`, `tests/e2e/salary-cap.spec.ts`, `tests/e2e/monthly-budgeting.spec.ts`.

**Interfaces:** Export `renderSalaryFields(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void` from `salary-fields.ts` and `renderOtherIncomeFields(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void` from `income.ts`. Consume the Task 5 memory/groups and Task 4 controls; keep `renderIncomeForm` as the adapter.

- [ ] **Step 1: Add failing interaction tests.** Open salary-a explicitly and assert basics show name, owner, employer, annual gross, and start date; growth is summarized while collapsed. These assertions pin hidden values and dates:

```ts
it('keeps annual growth and dated raises active while hidden', async () => {
  fireEvent.click(within(editor).getByText('Growth and changes', {selector:'summary'}));
  setField(editor, 'Annual salary raise (%)', '3.00');
  fireEvent.click(within(editor).getByText('Growth and changes', {selector:'summary'}));
  expect(editor).toHaveTextContent('3%');
  await waitForPreview(root);
  const prepared = prepareEdit(controller, target);
  if (prepared.status !== 'ready') throw Error('Expected a salary candidate');
  expect(prepared.plan.salaries.find(s => s.id === 'salary-a'))
    .toMatchObject({annualRaiseBps:300,raiseMonth:1,raiseDay:1});
});
```

Add percentage/amount dated changes, cap validation, inclusive end-date behavior, and wage → ordinary-taxable → wage reversal retaining employer/owner/invalid raw text with no write. Employer display must retain its actual linked ID.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/income-editor.test.ts`; expect missing grouping/summaries or erased mode values.
- [ ] **Step 3: Implement focused income groups.** Put essential salary facts first, make active growth assumptions readable, use the anniversary control, and retain all existing cap/change semantics. Use mode-owned raw caches for other-income classifications and reveal NIIT/owner/employer requirements contextually. Wire slider completion/blur to `coordinator.request(true)` through the existing focused editor event boundary; input itself remains immediate.
- [ ] **Step 4: Verify green.** Run Task 8 browser tests and `financial-forms.test.ts`, then `npm run test:e2e -- tests/e2e/salary-cap.spec.ts tests/e2e/monthly-budgeting.spec.ts`; expect preview values before Apply and existing salary/expense math after Apply/reload.
- [ ] **Step 5: Commit.** Stage Task 8 files, diff-check, then `git commit -m "feat: simplify salary and income entry"`.

### Task 9: Accounts, Contributions, and RSU Entry

**Files:** Create `src/browser/forms/account-fields.ts`, `src/browser/forms/contribution-fields.ts`, `tests/browser/account-editor.test.ts`. Modify `src/browser/forms/investments.ts`, `src/browser/forms/rsu.ts`, `src/browser/record-collections.ts`; extend `tests/browser/rsu-forms.test.ts`, `tests/browser/rsu-paper-availability.test.ts`, `tests/e2e/rsu.spec.ts`.

**Interfaces:** Export `renderAccountFields(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void` and `renderContributionFields(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void`. Preserve `renderRsuFields(root,controller,context)` and `changeAccountType(controller,context,type)` signatures; change their focused-mode transition implementation to use Task 5 reversible caches. `FieldContext.memory?: RecordEditorMemory` is supplied by focused mounting; direct legacy contexts use a stable per-context fallback memory.

- [ ] **Step 1: Add failing tests for the complete account path.** Pin forecast-start balance date, unknown/known-zero basis, contribution fixed/salary-percent reversal, sponsor filtering, and post-account Apply contribution navigation.

```ts
it('restores brokerage facts after reversing an RSU mode change', () => {
  const before = structuredClone(controller.getDraft('accounts','brokerage').value);
  setField(editor, 'Account type', 'rsu');
  setField(editor, 'Account type', 'taxable-brokerage');
  expect(controller.getDraft('accounts','brokerage').value).toEqual(before);
  expect(store.writes()).toBe(0);
  expect(controller.getState().savedPlan.revision).toBe(0);
});
```

Also preserve six-decimal shares, multiple grants/price targets, vest/cliff/withholding/settlement, grant IDs, and malformed retained share text. Assert unvested/deferred values do not enter held balances or spendable cash. Existing linked-account type-change rejection remains.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/account-editor.test.ts tests/browser/rsu-forms.test.ts`; expect lost inactive values or absent entry grouping.
- [ ] **Step 3: Implement account basics and contextual follow-through.** Label January 1 of the forecast start year, show return versus basis clearly, keep ordinary account and RSU entry distinct, and expose contribution setup only as its own transaction. Group RSU essentials, grants/vesting, holdings/basis, and price assumptions with short summaries. Keep legal contribution limits and owner/sponsor requirements; do not treat account balance as tax basis. Hook prerequisite actions through the Task 13 callback when it becomes available; until then ordinary applied-account/salary selection remains fully usable.
- [ ] **Step 4: Verify green.** Run Task 9 browser suites plus `financial-forms.test.ts`, then `npm run test:e2e -- tests/e2e/rsu.spec.ts`; expect unchanged applied RSU math and no silent Apply during type exploration.
- [ ] **Step 5: Commit.** Stage Task 9 files, diff-check, then `git commit -m "feat: simplify accounts contributions and equity entry"`.

### Task 10: Property, Purchase, Financing, Rental, and Cost Groups

**Files:** Create `src/browser/forms/property-basics.ts`, `src/browser/forms/property-financing.ts`, `src/browser/forms/property-rentals.ts`, `src/browser/forms/property-costs.ts`, `src/browser/forms/property-history.ts`, `tests/browser/property-editor.test.ts`. Modify `src/browser/forms/properties.ts`, `src/browser/purchase-property-setup.ts`, `src/browser/record-collections.ts`; extend `tests/browser/properties.test.ts`, `tests/browser/future-property-purchases.test.ts`, `tests/browser/brokerage-funding-forms.test.ts`, `tests/e2e/future-property-purchases.spec.ts`, `tests/e2e/estimated-mortgage.spec.ts`.

**Interfaces:** Each new property module exports its corresponding `renderPropertyBasics`, `renderPropertyFinancing`, `renderPropertyRentals`, `renderPropertyCosts`, or `renderPropertyHistory` with `(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void`. The parent `properties.ts` owns the full bundle/update callback and calls existing purchase helpers and `idFor`; shared groups receive that actual context, never a filtered plan. All nested Apply/Enter actions resolve to the property target and say Apply property changes.

- [ ] **Step 1: Add failing stepped-entry tests.** Use `makeFuturePurchasePlan()` and `makeAduPlan()` for history fixtures. Pin Property → Financing → Rent & costs navigation without advancing revisions, incomplete essential fields blocking Apply, manual date/value overrides, and loans/rentals/expenses in one candidate.

```ts
it('reclassifies at the forecast boundary without replacing manual facts', () => {
  setField(editor, 'Property purchase date', '2026-01-01');
  expect(editor).toHaveTextContent('Owned at forecast start');
  setField(editor, 'Property purchase date', '2026-01-02');
  expect(editor).toHaveTextContent('Purchase after forecast start');
  expect(controller.getDraft('properties','future-home').value).toMatchObject({
    property:{loans:[expect.objectContaining({firstPaymentDate:'2027-07-31'})]},
  });
  expect(controller.getState().savedPlan.revision).toBe(0);
});
```

Use a manually entered first-payment date in setup. Add the equivalent household start-year crossing, raw primary/rental tax-history unknown/zero/blank preservation, separate readiness/lease dates, brokerage funding/basis follow-through, and role/mode reversal without erased linked history.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/property-editor.test.ts`; expect missing steps/classification or manual-value loss.
- [ ] **Step 3: Extract property groups and implement the flow.** Derive ownership classification strictly from actual purchase date versus January 1 of startYear; never persist a UI-owned flag or fabricate a date to satisfy the selected intent. Present required purchase/down-payment/mortgage facts before Apply; use existing transparent defaults/estimate mode with override tracking. Keep distinct APR, payment, tax/insurance, valuation, funding and basis concepts. Expose history only where relevant while retaining status summaries and existing exact-field paths. Use reversible raw caches for actual mode changes and native disclosure visibility for hide/show.
- [ ] **Step 4: Verify green.** Run Task 10 browser tests and the three extended suites, then `npm run test:e2e -- tests/e2e/future-property-purchases.spec.ts tests/e2e/estimated-mortgage.spec.ts`; expect atomic preview/Apply, retained manual inputs, and unchanged financial amounts/availability.
- [ ] **Step 5: Commit.** Stage Task 10 files, diff-check, then `git commit -m "feat: guide property purchase and rental entry"`.

### Task 11: ADU Setup and Applied Comparison Integration

**Files:** Create `src/browser/forms/adu-basics.ts`, `src/browser/forms/adu-funding.ts`, `src/browser/forms/adu-tax-fields.ts`, `tests/browser/adu-editor.test.ts`. Modify `src/browser/forms/adu-project.ts`, `src/browser/adu-project-draft.ts`, `src/browser/adu-project-setup.ts`, `src/browser/views/adu-comparison.ts`, `src/browser/editor-view.ts`; extend `tests/browser/adu-project-forms.test.ts`, `tests/browser/adu-reporting.test.ts`, `tests/e2e/adu-build.spec.ts`.

**Interfaces:** `renderAduBasics`, `renderAduFunding`, and `renderAduTaxFields` each take `(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void`. Preserve `renderAduProjectFields(root,controller,context): HTMLElement`, existing draft/setup exports, and the independent `createAduComparisonScheduler` API. Comparison render context always carries the applied plan/projection pair, not the active draft snapshot.

- [ ] **Step 1: Add failing ADU flow tests.** Use `makeAduPlan()`; change staged cost to raw `310000.00`, inspect the property candidate, and pin scope:

```ts
it('previews the property bundle but compares applied projects', async () => {
  await waitForPreview(root);
  const prepared = prepareEdit(controller, propertyTarget);
  if (prepared.status !== 'ready') throw Error('Expected a property candidate');
  expect(prepared.plan.properties[0]!.aduProject!.costs[0]!
    .amountCents).toBe(31_000_000);
  expect(appliedPlan.properties[0]!.aduProject!.costs[0]!
    .amountCents).toBe(30_000_000);
  expect(comparison).toHaveTextContent('Applied project comparison');
  expect(within(editor).getByRole('button', {name:'Apply property changes'}))
    .toBeEnabled();
});
```

Also pin staged draw attribution, independent completion value/date, readiness versus lease dates, incremental assessed versus paid tax, shared-cost overrides, invalid histories, and simple/detailed mode reversal. Applying invalid ADU data cannot save part of its property bundle.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/adu-editor.test.ts`; expect missing grouped ADU flow or ambiguous comparison source.
- [ ] **Step 3: Implement ADU groups.** Keep costs/funding/tax/history in focused modules, preserve all existing rules and source labels, and use the parent property context for edits/Apply. Retain original-home value, restricted funding, and spendable cash distinctions. Hide applied comparison in optional detail during preview, label it applied, and request a new guarded comparison only after property Apply or an explicit applied selection.
- [ ] **Step 4: Verify green.** Run Task 11 suites plus `tests/browser/adu-project-state.test.ts` and `adu-comparison.test.ts`, then `npm run test:e2e -- tests/e2e/adu-build.spec.ts`; expect existing construction/financing/tax projections and comparison ownership to pass.
- [ ] **Step 5: Commit.** Stage Task 11 files, diff-check, then `git commit -m "feat: streamline ADU planning within property edits"`.

### Task 12: Household, Spending, Debts, and Child Planning

**Files:** Create `tests/browser/household-spending-editor.test.ts`. Modify `src/browser/forms/household.ts`, `src/browser/forms/expenses-debts.ts`, `src/browser/forms/children.ts`, `src/browser/record-collections.ts`; extend `tests/browser/child-planning.test.ts`, `tests/browser/financial-forms.test.ts`, `tests/e2e/child-planning.spec.ts`, `tests/e2e/monthly-budgeting.spec.ts`, `tests/e2e/workspace.spec.ts`.

**Interfaces:** Keep Task 5 selected-form wrapper signatures. Extract named `renderHouseholdFields`, `renderExpenseFields`, `renderDebtFields`, and `renderChildFields` with `(root:HTMLElement, controller:WorkspaceController, context:FieldContext): void` in their owning existing modules. No new financial transaction grouping or dependent-status inference.

- [ ] **Step 1: Add failing group/entry tests.** Pin people/forecast/opening-cash basics and advanced retirement/tax coverage, monthly versus annual expense units, growth/inclusive end dates, property/rental links, first-payment month, birth month and age-18 choice.

```ts
it('keeps a child budget separate from tax-dependent facts', async () => {
  setField(editor, 'Birth month', '2026-06');
  await waitForPreview(root);
  const prepared = prepareEdit(controller, childTarget);
  if (prepared.status !== 'ready') throw Error('Expected a child candidate');
  expect(prepared.plan.children?.[0]!.birthMonth).toBe('2026-06');
  expect(prepared.plan.household.coverageAnswers)
    .toEqual(appliedPlan.household.coverageAnswers);
  expect(editor).toHaveTextContent('housing');
  expect(editor).toHaveTextContent('day care');
});
```

Add a saved mortgage appearing once in expenses, known/unknown employer catch-up history hidden/reopened unchanged, and blur-triggered validation revealing the correct advanced group.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/household-spending-editor.test.ts`; expect missing grouping/contextual entry.
- [ ] **Step 3: Implement concise collections and editors.** Show only relevant basics, summarize active advanced assumptions, preserve explicit unknowns and existing monthly budgeting, and put tax/model explanations behind contextual help. Child age-band/exclusion information remains reachable. Household Apply remains the existing grouped forecast/household transaction; validate downstream purchase/year requirements through current issues.
- [ ] **Step 4: Verify green.** Run Task 12 browser suites, then `npm run test:e2e -- tests/e2e/child-planning.spec.ts tests/e2e/monthly-budgeting.spec.ts tests/e2e/workspace.spec.ts`; expect entry/reload/restore and original financial fixture outcomes to pass.
- [ ] **Step 5: Commit.** Stage Task 12 files, diff-check, then `git commit -m "feat: simplify household spending and debt planning"`.

### Task 13: Allocation and Explicit Prerequisite Apply/Return

**Files:** Create `src/browser/prerequisite-flow.ts`, `tests/browser/prerequisite-flow.test.ts`. Modify `src/browser/forms/cash-flow-allocation.ts`, `src/browser/forms/account-fields.ts`, `src/browser/forms/contribution-fields.ts`, `src/browser/forms/rsu.ts`, `src/browser/record-form.ts`, `src/browser/focused-editor.ts`, `src/browser/editor-view.ts`; extend `tests/browser/backdoor-roth-forms.test.ts`, `tests/browser/cash-flow-allocation-forms.test.ts`, `tests/browser/cash-flow-allocation-reporting.test.ts`, `tests/e2e/backdoor-roth.spec.ts`, `tests/e2e/cash-flow-allocation.spec.ts`.

**Interfaces:** `PrerequisiteRequest` is a discriminated union of `{section:'accounts'; defaults:RawObject; link(origin:RawObject, applied:Account):RawObject}` and `{section:'salaries'; defaults:RawObject; link(origin:RawObject, applied:Salary):RawObject}`. A salary link can use the applied employer identity, not mistakenly substitute salary ID for employer ID. Export `createPrerequisiteFlow(controller:WorkspaceController, ownership:{owner:EditPreviewOwner; isCurrent():boolean}, navigate:(target:EditTarget)=>void): {begin(origin:EditTarget, request:PrerequisiteRequest):void; applied(target:EditTarget, result:SaveRecordResult):void; cancel():void; dispose():void}`. Add optional `requestPrerequisite(request:PrerequisiteRequest):void` to focused `FormRenderOptions`, `FieldContext`, and `AllocationEditorOptions`; the active target is captured by the focused host.

- [ ] **Step 1: Add failing prerequisite and allocation tests.** Adapt the current backdoor helper test that saves immediately. Use a plan with no eligible source IRA, record the opening account count/revisions, and assert:

```ts
it('requires two explicit applies for a source IRA and allocation', async () => {
  fireEvent.click(within(root).getByRole('button', {name:'Add source IRA'}));
  expect(controller.getState().savedPlan.accounts).toHaveLength(openingCount);
  expect(store.writes()).toBe(0);
  fireEvent.click(within(root).getByRole('button', {name:'Cancel and return'}));
  expect(controller.getState().savedPlan.accounts).toHaveLength(openingCount);
  fireEvent.click(within(root).getByRole('button', {name:'Add source IRA'}));
  await waitForPreview(root);
  fireEvent.click(within(root).getByRole('button', {name:'Apply account',exact:true}));
  expect(controller.getState().savedPlan.revision).toBe(1);
  expect(controller.getAllocationDraft().value).toMatchObject({entries:[{
    destination:{backdoorRoth:{cleanIraHistory:{known:false}}},
  }]});
  expect(controller.getState().savedPlan.cashFlowAllocation).toEqual(originalPolicy);
  fireEvent.click(within(root).getByLabelText('Confirm clean IRA history'));
  await waitForPreview(root);
  fireEvent.click(within(root).getByRole('button', {name:'Apply allocation',exact:true}));
  expect(controller.getState().savedPlan.revision).toBe(2);
});
```

Use local role-based action helpers backed by the Task 7 UI. Add nested detour/cancel, invalid account Apply, successful in-memory-only account Apply, scenario/restore invalidation, annual-maximum/sponsor/overflow modes, and an ADU fixture where `originalCashFlowCents` differs from Financial overview cash flow. Assert percentage target/share denominator equals the original engine budget, not remaining funds or the overview value.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/prerequisite-flow.test.ts tests/browser/backdoor-roth-forms.test.ts`; expect immediate-save behavior or missing return-flow support.
- [ ] **Step 3: Implement the detour and allocation editor.** Keep a small owner-bound stack so each prerequisite returns to its immediate origin. Begin calls `beginAdd(section)` to allocate a fresh ID, then merges request defaults into that generated draft without replacing its ID; it does not pass an incomplete defaults object as a complete `beginAdd` value. Accepted explicit Apply verifies the new applied record, links it through the request callback, and recalculates the origin. Use Add source IRA and Cancel and return for those actions. Cancel discards only that detour’s new unapplied record and restores the origin. Rejected Apply stays in the prerequisite editor. Dispose/switch invalidates callbacks without touching another scenario. Never infer clean IRA history. Production forms always receive the prerequisite callback; standalone mounts without it offer applied-record selection and clear account-creation guidance, with no silent `saveRecord` helper.

Complete allocation’s concise presentation: percentages/maximums, priorities, sponsors, overflow and backdoor history. Keep selected allocation/overview years independently labeled. Use the Task 3 external coordinator for the global overview and local allocation pie/table together; no second candidate/worker. Label the original budget Cash available for allocation. Preserve actual/requested funding, monthly timing, retained cash and unavailable results in optional detail.
- [ ] **Step 4: Verify green.** Run Task 13 browser suites, then `npm run test:e2e -- tests/e2e/backdoor-roth.spec.ts tests/e2e/cash-flow-allocation.spec.ts`; expect separate account/policy revisions, no canceled-detour persistence, and unchanged funding/tax outputs.
- [ ] **Step 5: Commit.** Stage Task 13 files, diff-check, then `git commit -m "feat: make allocation setup explicit and reversible"`.

### Task 14: Actionable Issues, Compact Status, Settings, and Recovery

**Files:** Create `src/browser/views/attention.ts`, `src/browser/settings.ts`, `src/browser/persistence-status.ts`, `tests/browser/attention-routing.test.ts`. Modify `src/browser/issue-presentation.ts`, `src/browser/navigation.ts`, `src/browser/form-feedback.ts`, `src/browser/views/issues.ts`, `src/browser/scenario-app.ts`, `src/browser/editor-view.ts`, `src/browser/backup-controls.ts`; extend `tests/browser/review-feedback.test.ts`, `tests/browser/scenario-review-regressions.test.ts`, `tests/browser/backup-controls.test.ts`, `tests/browser/scenario-backups.test.ts`, `tests/browser/disclosures.test.ts`.

**Interfaces:** `AttentionKind = 'input'|'missing-data'|'unsupported'|'funding'|'assumption'`; `AttentionItem = {key:string; kind:AttentionKind; title:string; group:IssueGroup; targets:readonly ReviewTarget[]}`. Export `buildAttention(snapshot:ReportSnapshot, draftIssues:readonly Issue[], state:IssueViewState): readonly AttentionItem[]`. `mountAttention(root:HTMLElement, context:IssueViewContext, review:(target:ReviewTarget)=>void): {update(snapshot:ReportSnapshot, issues:readonly Issue[]):void; dispose():void}` binds each action to its current producing report and activation. `mountSettings(root:HTMLElement, manager:ScenarioManager, appearance:ReturnType<typeof mountAppearance>): {dispose():void}` hosts appearance and existing backup controls. `mountPersistenceStatus(root:HTMLElement, manager:ScenarioManager): {dispose():void}` owns global saved/recovery presentation.

- [ ] **Step 1: Add failing attention/recovery tests.** Reuse grouped-period and nested-ADU fixtures; pin exact record/group/field reveal and actual focus. Verify detached actions from an earlier report or scenario do nothing, while current candidate-only record issues route correctly.

```ts
it('keeps an applied storage failure visible through unrelated UI actions', async () => {
  const editor = openRecord(root, {kind:'record',section:'salaries',recordId:'salary-a'});
  setField(editor, 'Annual gross salary ($)', '125000.00');
  await waitForPreview(root);
  fireEvent.click(within(root).getByRole('button', {name:'Apply salary changes'}));
  expect(status).toHaveTextContent('Applied');
  expect(status).toHaveTextContent('Not saved locally');
  fireEvent.click(within(root).getByRole('button', {name:'Close editor'}));
  fireEvent.click(within(root).getByRole('button', {name:'Settings',exact:true}));
  setField(root, 'Appearance', 'light');
  expect(within(root).getByRole('button', {name:'Export workspace backup'}))
    .toBeVisible();
  expect(manager.getState().persistence.persisted).toBe(false);
});
```

Add successful resolution without focus theft, unsupported explanations without fake field fixes, valid-with-unavailable-data Apply, external-change disabled retry, protected unreadable-byte download, restore scopes, and cosmetic storage failure leaving financial editing usable.
- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/attention-routing.test.ts`; expect absent compact attention routing/settings/status behavior.
- [ ] **Step 3: Implement concise diagnostics and settings.** Retain existing cause grouping and exact review targets, classify by actual issue meaning rather than severity alone, and guard report actions against both activation and producing-report identity. Review opens the target first, selects its step/disclosure, then focuses the control. Preserve active issue detail until resolved; announce meaningful transitions politely. Initialize/dispose appearance with the app lifecycle. Compact the header’s revision/draft prose into distinct saved/preview indicators and contextual detail, keeping recovery warnings/actions prominent globally. Mount existing backup/recovery controls in Settings, preserve source/tax detail access, and keep every protected-data/external-change safeguard.
- [ ] **Step 4: Verify green.** Run Task 14 browser tests and all six extended suites, then `npm run typecheck`; expect correct focus/ownership and unchanged recovery/export semantics through appearance/navigation changes.
- [ ] **Step 5: Commit.** Stage Task 14 files, diff-check, then `git commit -m "feat: make financial issues and recovery actionable"`.

### Task 15: Complete Responsive, Visual, Financial, and Recovery Acceptance

**Files:** Create `tests/e2e/ui-revamp.spec.ts`, `tests/e2e/ui-appearance.spec.ts`; add resulting screenshot baselines under `tests/e2e/ui-appearance.spec.ts-snapshots/`. Modify `tests/e2e/workspace.spec.ts`, `tests/e2e/scenarios.spec.ts`, `tests/e2e/forecast-overview.spec.ts`, `tests/e2e/adu-build.spec.ts`, `tests/e2e/future-property-purchases.spec.ts`, `tests/e2e/estimated-mortgage.spec.ts`, `tests/e2e/cash-flow-allocation.spec.ts`, `tests/e2e/backdoor-roth.spec.ts`, `tests/e2e/rsu.spec.ts`, `tests/e2e/salary-cap.spec.ts`, `tests/e2e/monthly-budgeting.spec.ts`, `tests/e2e/child-planning.spec.ts`, `tests/e2e/helpers/workspace.ts`, `README.md`, and `playwright.config.ts` only if deterministic screenshot configuration is needed.

**Interfaces:** Use the production entry point and Task 7 explicit UI helper contracts; no test-only production routing or injected fake financial calculator. Preserve existing financial fixtures, summary cell selectors for unchanged metrics, and independent engine expected values. New balance cells use `balance-{year}-{reserve|accounts|property|debt|net-worth}` test IDs and the existing exact currency formatter; selected-year cards may abbreviate only while exposing the exact amount accessibly.

- [ ] **Step 1: Add failing end-to-end acceptance.** Exercise salary → preview → Apply → reload, account/contribution/RSU entry, owned/future property with mortgage, ADU funding, allocation detour, household/debt/child entry, and issue fix. At each preview, compare DOM known fixture amounts and verify `readActivePlan(page)` remains applied until the named Apply. Preserve matching input/result revisions after Apply and scoped backups.

```ts
test('keeps editing fluid and drafts independent at phone width', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await openRecord(page, {kind:'record',section:'salaries',recordId:'salary-a'});
  await page.getByLabel('Annual gross salary ($)').fill('125000.00');
  await page.getByRole('button', {name:'Forecast',exact:true}).click();
  await expect(page.locator('[data-preview-status]')).toContainText('Preview');
  await page.getByRole('button', {name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Annual gross salary ($)')).toHaveValue('125000.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
```

Pin desktop 1440×1000, tablet 900×1000, phone 390×844 and 320×740, long Unicode/HTML-like names, enlarged text, keyboard-only use, touch controls, native dates/months, and focus return. Capture deterministic dark/light Overview, property editor, and paused-preview screenshots with synthetic data and fixed forecast years. Add System preference changes, `reducedMotion:'reduce'`, no animated movement under that setting, and scroll/expansion retention. Verify no worker errors, page-wide overflow or hidden Apply controls. Include reload/import/restore/storage failure/external-tab scenarios through Settings.
- [ ] **Step 2: Verify red.** Run `npm run test:e2e -- tests/e2e/ui-revamp.spec.ts tests/e2e/ui-appearance.spec.ts`; expect missing acceptance behavior or unapproved initial baselines. Initial screenshots require visual inspection before recording baselines; do not bless clipping or stale values merely to pass.
- [ ] **Step 3: Finish integration and documentation.** Fix only acceptance gaps in their owning modules, update existing E2E flows to explicit navigation/Apply, and update README usage for every redesigned destination and status. After visual inspection, record reviewed initial baselines with `npm run test:e2e -- tests/e2e/ui-appearance.spec.ts --update-snapshots`; inspect their diff before staging. Keep historical specs/plans intact. Observe typing/drag performance on the existing 30-year mortgage/savings/RSU fixture and an ADU fixture; tune 100/300 ms scheduling only if observations justify it and update timer tests together. Manually inspect both themes and a phone viewport. Smoke-test native date/select controls in another installed browser if available; otherwise record Chromium-only coverage as a limitation.
- [ ] **Step 4: Run final verification.** Run `npm run check` and `git diff --check`; expect typecheck, all engine/browser tests, build, and every Chromium acceptance flow to pass with no new runtime warnings. Confirm identical input plans retain the engine’s existing amounts, availability, coverage, conditionality and provenance. Inspect the diff for financial schema/rule changes, accidental data/session keys and untracked artifacts. Run the required independent final review for the chosen execution method; fix concrete findings and rerun affected checks before completion.
- [ ] **Step 5: Commit.** Stage Task 15 acceptance, reviewed screenshot baselines, documentation and any reviewed final fixes explicitly; diff-check; `git commit -m "test: verify the redesigned financial workspace"`. Report final checks and remaining browser-coverage limits. Do not push without the user’s exact repository/remote/branch confirmation.

## Spec Coverage and Plan Self-Review

| Spec requirements | Owning tasks |
| --- | --- |
| Intent, whole-app scope, engine/schema/backup preservation (§§1–2) | All; final completeness and engine regression in 15. |
| Layout A, destinations, compact collections, session/scenario behavior (§3) | 5–7, 14–15. |
| Theme, precise inputs, dates, motion, focus and narrow/wide composition (§4) | 4–7, 15. |
| Disclosure/mode semantics and every existing entry flow (§5) | 5, 8–13. |
| Balance sheet, financial definitions, availability and deltas (§6) | 6, 13, 15. |
| Preview/Apply/error states, no-ops, scheduling and ownership (§7) | 1–3, 6–7, 14–15. |
| Shared preparation, stable ordering, producing-plan reports, atomic publication (§8) | 1–3, 6; ADU/allocation boundaries in 11 and 13. |
| Diagnostics, save states, recovery and export boundaries (§9) | 7, 13–15. |
| Acceptance, responsive/accessibility/performance checks (§10) | Task-specific tests and final 15. |
| Focused modules, full delivery and documentation (§11) | File map, dependency order, all tasks, README/final review in 15. |

Author self-review completed:

- All eleven spec sections map to the tasks above; no feature path is deferred beyond final delivery.
- Each of fifteen tasks has a file list, interfaces, failing checks, implementation, passing checks and local commit; the task steps are tracked by 75 checkboxes.
- Shared types and names agree across tasks. Retained allocation display data is a `PreviewReport`, while only a privately registered `CalculatedEdit` can authorize Apply. Required active-selection checks are separate from scenario existence.
- All five Review Focus conditions have tests in their owning tasks. No-op/order, forecast-boundary, unknown-history, prerequisite and stale-delta requirements are explicit.
- The plan is close to the spec in word count; it specifies interfaces/tests and omits implementation bodies. Exact file paths, valid matchers, fixture imports and the spec link have been checked.

Execution awaits the human’s plan review and execution-method selection. Application code has not been changed during planning.
