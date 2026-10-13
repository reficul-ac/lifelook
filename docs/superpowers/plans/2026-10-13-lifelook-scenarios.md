# LifeLook Baseline and Forked Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing applied JSON into an editable Master baseline, create named exact-copy experiments, and switch between independently editable scenarios while preserving unfinished edits.

**Architecture:** A browser-owned workspace envelope stores complete schema-v1 plans and scenario metadata. A scenario manager owns selection and global persistence, retaining a separate editor controller and view session per visited scenario. Existing financial validation and calculation remain unchanged; views and asynchronous work bind to a scenario and a runtime session generation.

**Tech Stack:** Existing TypeScript, native HTML/CSS and SVG, localStorage, Vite, Vitest with jsdom, and Playwright Chromium; Node 22. No new runtime or chart dependencies.

**Spec:** [LifeLook baseline and forked scenarios](../specs/2026-10-13-lifelook-scenarios-design.md). Read the spec alongside this plan.

## Global Constraints

- Keep the embedded `PlanDocument.schemaVersion` at 1 and leave its financial fields unchanged.
- Use the new storage key `lifelook.foundation.workspace.v1`.
- Master is editable just like an experiment; its Baseline badge identifies its role rather than a lock.
- The baseline cannot be deleted. It can be renamed without losing that role.
- Forking is available from any active scenario, including another experiment. The source is copied once.
- Subsequent source edits never propagate into that copy, and editing an experiment never changes its source.
- Exact forks intentionally share their embedded plan ID, record IDs, and starting input revision.
- Trim outer whitespace, require 1 through 80 Unicode code points, and reject duplicate names using case-insensitive comparison of the trimmed names.
- Selecting another scenario requires no Save or Discard prompt.
- Drafts and view selections survive switching for the lifetime of the open app session.
- All exports exclude unfinished record drafts, allocation drafts, calculated reports, previews, and view state.
- Persistence suspension takes precedence over normal operation writes and retries.
- Implementation verification uses the existing `npm run check` workflow and engine tests under `America/Los_Angeles`.
- Side-by-side comparisons, diffs, merging, rebasing, promotion, history, cloud synchronization, and persistent draft recovery remain outside this implementation.
- Before any `git push`, obtain explicit user confirmation for the exact repository, remote, and branch. Task commits below are local only.

## Review Focus

- A source name already containing 80 Unicode code points must still produce a valid, unique suggested fork name; Task 1 pins emoji counting and suffix truncation.
- A stored document at `Number.MAX_SAFE_INTEGER` revision must reject the next increment without changing plans, drafts, selection, or bytes; Task 3 pins both workspace and input revision overflow.
- A stored-value read failure must stay distinct from a missing key and must not authorize overwriting unseen data; Tasks 2 and 3 pin undefined observation and suspended retry.
- A replacement using the same scenario IDs and input revisions but different amounts must discard old cached results and callbacks; Tasks 4 and 6 pin fresh generations and obsolete file/worker replies.
- A retained view year outside a newly applied forecast horizon must clamp to an available year without changing saved inputs; Task 4 pins year-range changes and independent plot toggles.

---

## File Structure and Dependencies

| Task | Files and responsibility | Depends on |
| --- | --- | --- |
| 1 | New `src/browser/scenario-workspace.ts`, `src/browser/scenario-session.ts`: envelope/name validation and retained-session types. New `tests/helpers/scenarios.ts`: synthetic envelopes and key-aware storage. | Spec |
| 2 | New `src/browser/workspace-storage.ts`: migration, full-envelope writes, byte recovery, and external-change detection. Existing `storage.ts` remains the legacy single-plan adapter. | 1 |
| 3 | `src/browser/state.ts`, new `src/browser/scenario-manager.ts`: editor publication port, retained controllers, scenario operations, coherent notifications, global persistence. | 1, 2 |
| 4 | Allocation editor/scheduler/worker, forecast plots, feedback and property forms: retain view state and guard callbacks. | 1, 3 |
| 5 | New `src/browser/editor-view.ts`, `src/browser/scenario-controls.ts`, `src/browser/scenario-app.ts`, `src/browser/app-lifecycle.ts`: independently mounted scenario shell, switching and management; shared cleanup and styles. | 3, 4 |
| 6 | New `src/browser/workspace-backups.ts`, `src/browser/backup-controls.ts`; manager, shell and main integration: scoped imports, restores, recovery and production startup cutover. | 2, 3, 5 |
| 7 | New `tests/e2e/scenarios.spec.ts`, `tests/e2e/helpers/workspace.ts`; nine existing e2e specs and README: acceptance and regression integration. | 5, 6 |

This is one scenario-workspace subsystem. Storage, sessions, controls, and restore behavior depend on the same identities and persistence contract, so use one plan and execute tasks in order. Do not alter financial engine modules or sourced fixtures. Use synthetic plans and existing reference fixtures; never use a personal profile as test data.

### Task 1: Workspace Contract and Retained Session Types

**Files:** Create `src/browser/scenario-workspace.ts`, `src/browser/scenario-session.ts`, `tests/helpers/scenarios.ts`, and `tests/browser/scenario-workspace.test.ts`.

**Interfaces:**

- Export readonly `ScenarioDocument` and `ScenarioWorkspaceDocument` exactly matching the spec: `kind: 'lifelook-workspace'`, envelope `schemaVersion: 1`, `workspaceRevision`, baseline/active IDs, scenarios with `id`, `name`, `plan`, and optional `forkedFrom {scenarioId, scenarioName, planRevision}`.
- Export `WorkspaceIssue extends Issue` with optional `scenarioId` and `scenarioName`. Preserve embedded `recordId`; envelope validation prefixes financial fields with `scenarios[index].plan` and attaches scenario identity.
- Export `validateScenarioName(input: string, scenarios: readonly ScenarioDocument[], excludeId?: string): {ok: true; name: string} | {ok: false; issues: readonly WorkspaceIssue[]}`, `suggestForkName(sourceName: string, scenarios: readonly ScenarioDocument[]): string`, `validateScenarioWorkspace(raw: unknown): {ok: true; document: ScenarioWorkspaceDocument} | {ok: false; issues: readonly WorkspaceIssue[]}`, and `createScenarioWorkspace(plan: PlanDocument, baselineId: string): ScenarioWorkspaceDocument`.
- Export `ForecastPlotSeriesKey = Exclude<keyof ProjectionSummaryRow, 'year'>`. `ScenarioViewSelections` has `inputSection: InputSection`, `forecastYear: number`, `allocationYear: number`, and `hiddenPlotSeries: Set<ForecastPlotSeriesKey>`.
- `AllocationPreviewSession` has optional `lastValid: {plan: PlanDocument; projection: ProjectionResult}`, `status: 'pending' | 'valid' | 'invalid' | 'failed' | 'inactive'`, `issues: readonly Issue[]`, and `entryIdSequence: number`.
- `EditorViewSession` has `selections`, `allocationPreview`, `taskIssues: Map<string, readonly Issue[]>`, `removeIssues: Map<string, readonly Issue[]>`, and `propertyDisclosures: Map<string, boolean>`. `ScenarioEditorSession` has `scenarioId: string`, `generation: number`, `controller: WorkspaceController`, and `view: EditorViewSession`.
- Export `PreviewOwner {scenarioId: string; sessionGeneration: number; activationGeneration: number}` for browser callback ownership; it is never stored in JSON.
- Export `createEditorViewSession(plan: PlanDocument, selections?: ScenarioViewSelections): EditorViewSession` and `normalizeViewYears(view: EditorViewSession, plan: PlanDocument): void`. Default to Household and `plan.startYear`; clone selection sets and start preview/feedback/disclosures empty. Clamp out-of-range years to the forecast start year.
- Test helpers: `makeScenarioWorkspace(plan?: PlanDocument, overrides?: Partial<ScenarioWorkspaceDocument>): ScenarioWorkspaceDocument`, with baseline ID `master`, and `memoryWorkspaceStorage(initial?: ReadonlyMap<string, string>): {port: StoragePort; values: Map<string, string>; writes: () => number}`. Reuse `makePlan` and `makeAllocationPlan`.

- [ ] **Step 1: Write failing validation and session tests.** Pin schema 1, Master creation at workspace revision zero, distinct envelope identity, valid repeated financial IDs across scenarios, absent children, explicit unknowns, linked property/RSU/allocation inputs, invalid references, empty scenarios, duplicate scenario IDs/names, unsupported kinds/versions, unsafe revisions and invalid provenance shape. Reject stored names with outer whitespace instead of silently rewriting imported metadata. Permit historical source IDs whose scenarios were deleted.

```ts
it('suggests a unique fork name within 80 Unicode code points', () => {
  const source = '😀'.repeat(80);
  const doc = makeScenarioWorkspace();
  const first = suggestForkName(source, doc.scenarios);
  expect(Array.from(first)).toHaveLength(80);
  expect(first.endsWith(' copy')).toBe(true);
  const second = suggestForkName(source, [...doc.scenarios, {id: 'copy', name: first, plan: doc.scenarios[0]!.plan}]);
  expect(Array.from(second).length).toBeLessThanOrEqual(80);
  expect(second.endsWith(' copy 2')).toBe(true);
});
```

Also assert trimmed ` lower growth ` becomes `lower growth`, `LOWER GROWTH` conflicts, an 81-code-point name fails, a scenario ID `constructor` round-trips, and fresh view sessions never share mutable sets/maps.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/scenario-workspace.test.ts`; expect missing exports/modules or unmet validation assertions.
- [ ] **Step 3: Implement the contract and builders.** Use `validatePlan` per embedded plan; preserve its frozen clone and coverage-incomplete acceptance. Keep financial uniqueness local to each plan. Names use trimmed `toLowerCase()` comparison and `Array.from(name).length`. Truncate only the source portion when reserving room for ` copy` or ` copy N`. Use Maps for runtime registries. Validate and freeze JSON document outputs without adding financial defaults.
- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/scenario-workspace.test.ts tests/browser/storage.test.ts` and `npm run typecheck`; expect all pass and existing single-plan backup tests unchanged.
- [ ] **Step 5: Commit the contract.** Stage only Task 1 files, run `git diff --cached --check`, then `git commit -m 'feat: define scenario workspace documents'`.

### Task 2: Workspace Storage and Migration

**Files:** Create `src/browser/workspace-storage.ts` and `tests/browser/workspace-storage.test.ts`. Read `src/browser/storage.ts` for `StoragePort`, legacy key and `exportPlan`; keep its public APIs intact.

**Interfaces:** Consume Task 1 documents, validation and helpers. Export:

```ts
export const WORKSPACE_STORAGE_KEY = 'lifelook.foundation.workspace.v1';
interface WorkspacePersistence extends WorkspaceInitialization {
  observedRaw: string | null | undefined;
  suspension: 'none' | 'unreadable' | 'external-change';
  recovery?: {key: string; raw: string};
}
loadWorkspace(storage: StoragePort, nextScenarioId: () => string): WorkspaceLoadResult;
saveWorkspace(storage: StoragePort, document: ScenarioWorkspaceDocument, expectedRaw: string | null): WorkspaceSaveResult;
exportWorkspace(document: ScenarioWorkspaceDocument): string;
```

`WorkspaceLoadResult` discriminates `loaded`/`migrated` with `document` and `persistence`, versus `missing`/`invalid`/`read-failed` with `persistence`. `WorkspaceSaveResult` has `status: 'saved' | 'invalid' | 'write-failed' | 'read-failed' | 'external-change'`, `observedRaw: string | null`, and `issues: readonly WorkspaceIssue[]`. Successful saves return serialized bytes; failures retain the expected observation. Undefined observation means storage was unreadable, never absent. Read/invalid outcomes suspend ordinary persistence as unreadable; write failures alone remain retryable.

- [ ] **Step 1: Write failing storage tests.** Test new-key precedence, valid legacy migration with unchanged plan/revision and one new-key write, legacy bytes retained, idempotent second load with no migration write, missing keys, corrupt or future workspace without legacy fallback, invalid legacy without a write, quota-failed migration retained in memory, recovery key/raw retention, and complete envelope export. Check coverage-incomplete legacy histories remain unknown. A pre-write raw mismatch makes zero writes and returns external-change; read failure makes zero writes and returns read-failed.

```ts
it('distinguishes unreadable storage from a missing workspace', () => {
  const port: StoragePort = {getItem: () => {throw new Error('blocked');}, setItem: vi.fn()};
  const result = loadWorkspace(port, () => 'master');
  expect(result.status).toBe('read-failed');
  expect(result.persistence.observedRaw).toBeUndefined();
  expect(result.persistence.suspension).toBe('unreadable');
  expect(port.setItem).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/workspace-storage.test.ts`; expect missing workspace storage exports or failed migration/write assertions.
- [ ] **Step 3: Implement envelope persistence.** Read the new key first and inspect legacy only when it is null. Migration wraps the validated legacy plan unchanged and calls the guarded workspace writer with expected null; a concurrent new-key appearance yields external-change suspension. Validate before serialization, compare current raw bytes to expected bytes, and call `setItem` exactly once. Retain original observations on failures, including quota failure. Missing-key startup does not write a default plan here; the shell creates that in memory. Keep recovery bytes in runtime state and keep legacy bytes untouched.
- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/workspace-storage.test.ts tests/browser/storage.test.ts` and `npm run typecheck`; expect all pass, one-write assertions hold, and no existing schema-v1 backup behavior changes.
- [ ] **Step 5: Commit storage.** Stage Task 2 files, run `git diff --cached --check`, then `git commit -m 'feat: persist and migrate scenario workspaces'`.

### Task 3: Scenario Manager and Atomic Editor Publication

**Files:** Modify `src/browser/state.ts`. Create `src/browser/scenario-manager.ts`, `tests/browser/editor-publication.test.ts`, and `tests/browser/scenario-manager.test.ts`; extend `tests/browser/state.test.ts` only for regression coverage.

**Interfaces:** Consume Tasks 1–2 types. Preserve `createWorkspace(plan: PlanDocument, storage: StoragePort, ruleSet?: RuleSet): WorkspaceController` as the legacy singleton adapter. Add in `state.ts`:

```ts
interface EditorPublicationPort {
  readPersistence(): WorkspaceInitialization;
  publish(plan: ValidatedPlan, projection: ProjectionResult, commitSession: () => void):
    {accepted: true} | {accepted: false; issues: readonly Issue[]};
  retry(): {accepted: true} | {accepted: false; issues: readonly Issue[]};
}
createEditorSession(plan: PlanDocument, port: EditorPublicationPort, ruleSet: RuleSet): WorkspaceController;
```

The session validates/calculates before calling `publish`. Its supplied commit callback silently replaces inputs/report and clears only accepted drafts; rejection never invokes it. `getState()` and `SaveRecordResult` read global persistence through the port. The legacy adapter uses `savePlan` and retains current `resetPlan` behavior; a managed session's direct `resetPlan` throws before mutation. Manager replacements in Task 6 create fresh sessions instead.

Export `ScenarioTarget {scenarioId: string; generation: number; workspaceGeneration: number}`, `ScenarioOperationResult {accepted: boolean; persisted: boolean; issues: readonly WorkspaceIssue[]; scenarioId?: string}`, and `ScenarioManagerState {document: ScenarioWorkspaceDocument; persistence: WorkspacePersistence; workspaceGeneration: number; activeSession: ScenarioEditorSession}`. Export `createScenarioManager(document: ScenarioWorkspaceDocument, storage: StoragePort, rules: RuleSet, initial: WorkspacePersistence, nextScenarioId?: () => string): ScenarioManager`, with these methods:

- `getState(): ScenarioManagerState`; `getSession(id: string): ScenarioEditorSession | undefined` returns a visited session; `getActiveSession(): ScenarioEditorSession` returns the prepared active session.
- `captureTarget(id: string): ScenarioTarget | undefined`; `isCurrentTarget(target: ScenarioTarget): boolean` checks membership and both runtime generations.
- `switchScenario(id: string): ScenarioOperationResult`; `forkScenario(source: ScenarioTarget, name: string): ScenarioOperationResult`; `renameScenario(id: string, name: string): ScenarioOperationResult`; `deleteScenario(target: ScenarioTarget): ScenarioOperationResult`.
- `retryLocalSave(): ScenarioOperationResult`; `observeExternalStorage(raw: string | null): void`; `subscribe(listener: () => void): () => void`; `dispose(): void`.

- [ ] **Step 1: Write failing publication and scenario tests.** Start two identical full plan copies, including the reference home/ADU plan and synthetic children/RSUs/allocation inputs. Assert deep equality of initial plans and forecasts; distinct scenario IDs; shared financial IDs allowed; source pending drafts excluded; fork-of-fork history; rename validation/no-op; baseline delete rejection; inactive deletion preserves selection/drafts; active deletion returns to the retained baseline; deleting a source keeps forks.

```ts
it('rejects workspace revision overflow before accepting a record draft', () => {
  const doc = makeScenarioWorkspace(makePlan(), {workspaceRevision: Number.MAX_SAFE_INTEGER});
  const store = memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY, exportWorkspace(doc)]]));
  const manager = createScenarioManager(doc, store.port, loadRuleSet(), {persisted: true, persistenceIssues: [], suspension: 'none', observedRaw: exportWorkspace(doc)});
  const editor = manager.getActiveSession().controller, before = editor.getState();
  const draft = editor.getDraft('household', 'household');
  editor.editDraft('household', {...draft, value: {...draft.value, openingCashCents: '1.00'}});
  expect(editor.saveRecord('household').accepted).toBe(false);
  expect(editor.getState().savedPlan).toBe(before.savedPlan);
  expect(editor.getState().drafts.household?.value.openingCashCents).toBe('1.00');
  expect(store.writes()).toBe(0);
});
```

Also assert input-revision overflow preserves the same state; an injected `nextScenarioId` returning an existing ID rejects creation; invalid/blank/nested drafts and private stale bases survive switching; cross-scenario saves never stale another draft; an unexpected target calculation error leaves the source selected and usable. Capture and delete a never-visited inactive scenario without calculating it. Assert one envelope write per actual operation, no writes/revision increments for no-op or draft/view changes, global failed-write warnings across switches, full-envelope retry with unchanged revisions, unreadable/external suspension with disabled retry, and obsolete controllers rejecting publication or retry after deletion. Subscribers must see matching active inputs and projection, with the applied collection update announced once.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/editor-publication.test.ts tests/browser/scenario-manager.test.ts`; expect absent port/manager behavior or failed ownership/atomicity assertions.
- [ ] **Step 3: Implement the publication port and manager.** Assign a fresh runtime generation to every collection member and retain visited controllers/views in a Map. `captureTarget` must work without preparing an unvisited session. Bound publication checks target generation and safe revision before committing the new envelope and silent editor callback. Attempt storage only after accepted state is coherent; notify manager subscribers from the editor's completed operation, preventing intermediate or duplicate applied-state notifications. Forward draft notifications for header draft counts. Keep global persistence reads live across all controllers. Stage target sessions before changing active selection or deleting the active experiment. Clone the entire applied plan for forks; copy only view selections into a clean view session. Keep new ID allocation browser-owned via `crypto.randomUUID` with a fallback; reject collisions instead of looping forever. Suspend ordinary writes on protected/unknown bytes or external changes while retaining accepted local edits.
- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/editor-publication.test.ts tests/browser/scenario-manager.test.ts tests/browser/state.test.ts tests/browser/review-transactions.test.ts tests/browser/cash-flow-allocation-state.test.ts` and `npm run typecheck`; expect all pass with existing singleton stale-draft, restore and write-failure behavior intact.
- [ ] **Step 5: Commit manager behavior.** Stage Task 3 files, run `git diff --cached --check`, then `git commit -m 'feat: manage independent scenario editor sessions'`.

### Task 4: Retained Views and Preview Ownership

**Files:** Modify `src/browser/forms/cash-flow-allocation.ts`, `src/browser/forms/properties.ts`, `src/browser/forms/investments.ts`, `src/browser/form-feedback.ts`, `src/browser/issue-presentation.ts`, `src/browser/allocation-preview.ts`, `src/browser/allocation-preview-worker.ts`, `src/browser/views/forecast-plots.ts`, and `src/browser/views/projection.ts`. Extend `tests/browser/cash-flow-allocation-forms.test.ts`, `tests/browser/allocation-preview.test.ts`, `tests/browser/forecast-plots.test.ts`, `tests/browser/properties.test.ts`, and `tests/browser/form-feedback.test.ts`.

**Interfaces:** Consume `EditorViewSession`, `ScenarioEditorSession`, `PreviewOwner`, `ForecastPlotSeriesKey`, and `normalizeViewYears` from Task 1. Add optional `editorView?: EditorViewSession` to `IssueViewContext`. Extend `renderProjection(root: HTMLElement, result: ProjectionResult, context: IssueViewContext, view?: EditorViewSession): void` and `renderForecastPlots(root: HTMLElement, rows: readonly ProjectionSummaryRow[], context: IssueViewContext, selections?: ScenarioViewSelections): void`; preserve default behavior for existing pure-render callers. Export `AllocationEditorOptions {view: EditorViewSession; ownership?: AllocationPreviewOwnership}` from the allocation form and extend `mountCashFlowAllocationEditor(root: HTMLElement, controller: WorkspaceController, context: IssueViewContext, options?: AllocationEditorOptions): {dispose(): void}`; its Investments reexport keeps that signature. Read preview state from `options.view.allocationPreview` and year from `options.view.selections.allocationYear`.

Export `AllocationPreviewOwnership {owner: PreviewOwner; isCurrent(owner: PreviewOwner): boolean}` from the scheduler. Extend `createAllocationPreviewScheduler(controller: WorkspaceController, publish: (preview: CashFlowAllocationPreview) => void, ownership?: AllocationPreviewOwnership): AllocationPreviewScheduler`. Worker request/reply carry optional `owner: PreviewOwner`, echoed without changing engine input/result types. Keep existing generation, immutable-plan/draft identity, input revision and allocation epoch guards. Change `setFormTaskIssues(form: HTMLElement, issues: readonly Issue[], view?: EditorViewSession): void` to store by owning form's record ID in the supplied session, retaining a DOM-cache fallback for standalone tests.

- [ ] **Step 1: Write failing retained-view tests.** Establish a valid unapplied 20% allocation preview, enter invalid text, dispose/remount with the same view session, and assert the exact earlier preview plus Invalid/stale labeling returns. Retain allocation year and entry-ID sequence; fresh fork sessions start without those preview/errors. Confirm property mortgage-calculation errors survive remount and remain isolated for the same record ID in another session. Ensure property disclosure maps cannot leak between scenario roots. Test plot year/series persistence with separate sessions and no financial revisions.

```ts
it('clamps view years when the applied forecast horizon changes', () => {
  const plan = makePlan({startYear: 2026, horizonYears: 2});
  const view = createEditorViewSession(plan);
  view.selections.forecastYear = 2027;
  view.selections.allocationYear = 2027;
  view.selections.hiddenPlotSeries.add('cashFlowCents');
  normalizeViewYears(view, {...plan, horizonYears: 1});
  expect(view.selections.forecastYear).toBe(2026);
  expect(view.selections.allocationYear).toBe(2026);
  expect(view.selections.hiddenPlotSeries.has('cashFlowCents')).toBe(true);
  expect(plan.revision).toBe(0);
});
```

Use the existing controlled-worker pattern to deliver replies after termination, with matching old plan ID/revision but stale owner generation; expect no publication. Test outgoing worker cancellation, remount restart of pending work, preview failures, and unchanged scenario report reuse without recalculation. Returning to an invalid draft must not replace its last valid preview with applied results.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/cash-flow-allocation-forms.test.ts tests/browser/allocation-preview.test.ts tests/browser/forecast-plots.test.ts tests/browser/properties.test.ts tests/browser/form-feedback.test.ts`; expect the added remount/ownership/state assertions to fail.
- [ ] **Step 3: Move ephemeral state into retained sessions.** Update session state as controls change rather than only at dispose time. Move preview status/errors, last valid plan/report, year and allocation row-ID sequence out of form closures. Preserve stale preview content while remount validation runs. Store task feedback and property disclosure expansion in the supplied view; summary callbacks and last-rendered-issues may remain rebuildable DOM caches. Record plot years as actual years. Use ownership checks before accepting worker results and review actions; disposal cancels work without clearing retained state.
- [ ] **Step 4: Verify green.** Repeat Step 2, then run `npm run test:browser -- tests/browser/review-feedback.test.ts tests/browser/issue-presentation.test.ts tests/browser/rsu-forms.test.ts tests/browser/backdoor-roth-forms.test.ts` and `npm run typecheck`; expect existing control focus, disclosures and preview guards to pass.
- [ ] **Step 5: Commit retained views.** Stage Task 4 files, run `git diff --cached --check`, then `git commit -m 'feat: retain scenario views and isolate previews'`.

### Task 5: Scenario Shell and Switching Controls

**Files:** Create `src/browser/editor-view.ts`, `src/browser/scenario-controls.ts`, `src/browser/scenario-app.ts`, `src/browser/app-lifecycle.ts`, and `tests/browser/scenario-forms.test.ts`. Modify `src/browser/main.ts` for shared cleanup only, `src/browser/styles.css`, `tests/helpers/dom.ts`, and `tests/browser/review-feedback.test.ts`.

**Interfaces:** Export `mountEditorView(root: HTMLElement, session: ScenarioEditorSession, manager: ScenarioManager, activationGeneration: number): {dispose(): void}`; it owns input-section navigation, existing forms, forecast rendering and scenario-bound review context. Export `mountScenarioControls(root: HTMLElement, manager: ScenarioManager): {dispose(): void}` for the labeled selector, fork dialog and management disclosure. Export `mountScenarioApp(root: HTMLElement, manager: ScenarioManager): void` from `scenario-app.ts`. Export `registerAppCleanup(root: HTMLElement, dispose: () => void): void` and `unmountApp(root: HTMLElement): void` from `app-lifecycle.ts`; `main.ts` reexports `unmountApp` so existing callers retain their cleanup entry point.

Add test helper `mountScenarioWorkspace(document: ScenarioWorkspaceDocument, storage?: StoragePort): {root: HTMLElement; manager: ScenarioManager}` with explicit persisted synthetic envelope initialization. Keep the existing `mountWorkspace` helper, legacy `mountApp`, and production `startBrowserApp` behavior through this task; Task 6 cuts them over together with complete backup controls. Both independently mounted shells use the same cleanup registry. The final implementation retains only the scenario shell.

- [ ] **Step 1: Write failing shell tests.** Test Master/Baseline listing first, creation-order experiments, source-bound fork dialog and copy notice, creation/cancel/duplicate-name paths, literal HTML-like names, active rename without form remount/focus loss, inactive and active deletion confirmation/cancel, protected baseline, select focus and switch announcement, per-scenario section/year/toggles, coherent inputs/report heading, and global warnings across switches. Make an invalid salary draft, add an unsaved record, edit nested RSU/property values, then switch away/back; assert identical raw input text and draft indicators. Retain rejected-removal feedback by scenario/record; clear it on the relevant edit, discard or successful operation.

```ts
it('restores invalid household text after switching', async () => {
  const {root, manager} = mountScenarioWorkspace(makeScenarioWorkspace());
  const master = manager.captureTarget('master')!;
  manager.forkScenario(master, 'Lower growth');
  setField(root, 'Opening cash reserve ($)', '1.234');
  fireEvent.click(within(root).getByRole('button', {name: 'Save household', exact: true}));
  const forkId = manager.getState().document.activeScenarioId;
  fireEvent.change(within(root).getByLabelText('Scenario'), {target: {value: 'master'}});
  await waitFor(() => expect(manager.getState().document.activeScenarioId).toBe('master'));
  fireEvent.change(within(root).getByLabelText('Scenario'), {target: {value: forkId}});
  await waitFor(() => expect(manager.getState().document.activeScenarioId).toBe(forkId));
  expect(within(root).getByLabelText('Opening cash reserve ($)')).toHaveValue('1.234');
  expect(within(root).getByLabelText('Opening cash reserve ($)')).toHaveAttribute('aria-invalid', 'true');
});
```

Add a preparation-failure test proving the source's existing preview still publishes, and a stale review callback test with identical fork record IDs.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/scenario-forms.test.ts`; expect absent controls/session mounting or failed retention and focus assertions.
- [ ] **Step 3: Extract the editor binding and implement the scenario shell.** `scenario-app.ts` owns shell labels, global status, binding generations and subscriptions; `editor-view.ts` adapts the existing editor/report rendering. Pass allocation ownership guards and the retained view to the form and forecast; bind review callbacks to the same active session/generation. During cold preparation show busy state, defer calculation to allow it to paint, and disable conflicting controls. Keep the source binding alive until the manager accepts the target, then close transient overlays/dialogs, dispose outgoing views/workers, and bind the target as one visible update. Reject obsolete activation requests. Keep shell controls stable on draft notifications and active renames. Subscribe to relevant storage events, including clear, and unregister on unmount. Add full-width mobile selector, wrapping actions, accessible dialog focus/return, forecast name, draft lifetime hint and global recovery banner with workspace export/retry. Keep maps/feedback/session data when unbinding. Use shared cleanup for the legacy shell until Task 6 removes it; do not change production startup or legacy restore yet.
- [ ] **Step 4: Verify green.** Run `npm run test:browser` and `npm run typecheck`; expect all existing form/report/restore tests plus independently mounted scenario tests to pass. Verify `unmountApp` disposes subscriptions, overlays, workers and pending activation requests for both mount paths. The new scenario shell reports Saved locally and workspace recovery while the existing app remains functional until cutover.
- [ ] **Step 5: Commit the shell.** Stage Task 5 files, run `git diff --cached --check`, then `git commit -m 'feat: add seamless scenario switching controls'`.

### Task 6: Scoped Backups and Recovery

**Files:** Create `src/browser/workspace-backups.ts`, `src/browser/backup-controls.ts`, `tests/browser/scenario-backups.test.ts`, and `tests/browser/backup-controls.test.ts`. Modify `src/browser/scenario-manager.ts`, `src/browser/scenario-app.ts`, `src/browser/main.ts`, `tests/helpers/dom.ts`, and application status/restore cases in `tests/browser/forms.test.ts`.

**Interfaces:** Export `BackupPayload = {kind: 'plan'; plan: ValidatedPlan} | {kind: 'workspace'; document: ScenarioWorkspaceDocument}` and `parseBackup(json: string, expected: 'plan' | 'workspace' | 'either'): {ok: true; payload: BackupPayload} | {ok: false; issues: readonly WorkspaceIssue[]}`. Use the envelope discriminator to distinguish formats; existing plain-plan export remains `exportPlan`.

Add manager methods `importScenario(plan: ValidatedPlan, name: string): ScenarioOperationResult`, `replaceScenario(target: ScenarioTarget, plan: ValidatedPlan): ScenarioOperationResult`, `restoreWorkspace(document: ScenarioWorkspaceDocument): ScenarioOperationResult`, `replaceUnreadableData(payload: BackupPayload): ScenarioOperationResult`, `exportScenario(id: string): string`, and `exportWorkspace(): string`.

Export `mountBackupControls(root: HTMLElement, manager: ScenarioManager): {dispose(): void}`. Its file reads capture `{workspaceGeneration: number; target?: ScenarioTarget; requestGeneration: number}` before reading. Switching, superseding reads or disposal invalidate that flow. The final action rechecks ownership and all target generations. Pure file parsing never writes storage; only a named final Import, Replace, or Restore commits.

Change `startBrowserApp(root: HTMLElement, storage?: StoragePort): ScenarioManager` to load/migrate the workspace, create the default Master only for missing/recovery startup, and mount the scenario shell with complete backup controls. Remove legacy `mountApp`; reexport `mountScenarioApp` for tests as needed. Update `mountWorkspace` to return `{root, controller, manager}` from a Master-only scenario shell, with `controller` referring to its initial editor. After replacement tests read the fresh controller from `manager.getActiveSession()`. Browser date/UUID access stays in startup. Existing `entry.ts` ignores the return value and requires no change.

- [ ] **Step 1: Write failing backup transaction and control tests.** Assert scenario export is plain applied JSON; workspace export contains all names/plans/selection and no runtime state. Import a plain plan as a new named experiment without changing existing drafts, including unsaved applied source inputs. Replace one target without affecting other sessions; preserve its metadata and imported plan revision. Reject malformed files, unsupported formats, duplicate names/IDs and bad financial links before any write. Test valid but coverage-incomplete plans and storage failures after acceptance.

For full restore, use a two-scenario workspace with revision 9 while current revision is 12; assert restored workspace revision 13, preserved embedded revisions, imported active selection, and all sessions replaced. Repeat with identical IDs/revisions but changed money and deliver an old preview/file callback: assert the new amount stays and the reply is ignored. Revision overflow and active calculation exceptions preserve current collection/drafts/bytes. Reading a file for A, then deleting/replacing A or restoring the same IDs before completion must reject the obsolete file. Invalid reads must retain all draft text.

```ts
it('replaces matching imported identities with a fresh session', () => {
  const doc = makeScenarioWorkspace(makePlan({revision: 4}));
  const store = memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY, exportWorkspace(doc)]]));
  const manager = createScenarioManager(doc, store.port, loadRuleSet(), {persisted: true, persistenceIssues: [], suspension: 'none', observedRaw: exportWorkspace(doc)});
  const oldTarget = manager.captureTarget('master')!;
  const imported = {...doc, scenarios: [{...doc.scenarios[0]!, plan: makePlan({revision: 4, openingCashCents: 12345})}]};
  expect(manager.restoreWorkspace(imported).accepted).toBe(true);
  expect(manager.isCurrentTarget(oldTarget)).toBe(false);
  expect(manager.getActiveSession().controller.getState().savedPlan.openingCashCents).toBe(12345);
  expect(manager.getActiveSession().controller.getState().projection.inputRevision).toBe(4);
  expect(store.writes()).toBe(1);
});
```

For recovery, assert unreadable raw bytes remain downloadable through normal edits/switches; normal retry makes no write; deliberate validated legacy-plan recovery creates Master only and retains the legacy key; failed replacement writes retain accepted in-memory inputs and protected original bytes. A detected external conflict rejects restore/recovery writes until reload. Check dialog count/baseline/active summaries, named target consequences, cancellation, final confirmation, file-read errors, and safe filenames for emoji/HTML-like names. Imported-document error feedback must not navigate to same-ID records in the current workspace.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/scenario-backups.test.ts tests/browser/backup-controls.test.ts`; expect missing transactions/controls or failed restore and ownership assertions.
- [ ] **Step 3: Implement scoped transactions and controls.** Validate and prepare the imported active/target projection before replacing anything. Create fresh controller/session generations for replacement and full restore; revoke removed sessions and increment workspace generation for whole-workspace changes. Preserve untouched sessions and plan revisions; full restore uses `max(current, imported workspaceRevision) + 1`. Keep replacement metadata/fork provenance and omit provenance for imported new experiments. Use one envelope write per accepted transaction. Unreadable-data recovery is the only deliberate overwrite path: read the current new-key observation immediately before its guarded write, retain original recovery bytes, and clear protection only after success. A failed recovery remains protected and can retry its staged replacement action; generic Retry local save stays disabled. External conflicts require reload, including before explicit restores.

Install Export scenario JSON, Export workspace backup, Import scenario JSON, Replace this scenario from JSON, and Restore workspace backup within Backups and recovery. New imports prompt for name after validation; replacements/restores preview their scope and require the final consequence action. Capture/guard each asynchronous read and confirmation, reset file inputs after settlement, and cancel pending reads/flows on switch/unmount. Render rejected imported-document errors with their backup scenario names/field paths, without review links into matching current records. Recovery export always serializes the in-memory envelope without requiring storage. Raw recovery export returns original bytes unchanged. Use safe fallback filenames and revoke download object URLs.

Cut production startup and the single-plan DOM helper over only after these controls work. Delete the old shell and its direct `restorePlan` import so production writes exclusively use the manager. Update startup tests to key-aware ports, manager persistence reads, scoped confirmation actions, and Saved locally text; retain their original invalid-draft, raw-byte and failed-write assertions.

- [ ] **Step 4: Verify green.** Run `npm run test:browser` and `npm run typecheck`; expect all old and new atomicity, obsolete-callback, control-focus and failure-recovery checks to pass after cutover. Update any remaining application text assertions while retaining financial values and standalone `createWorkspace`/legacy storage expectations.
- [ ] **Step 5: Commit backups.** Stage Task 6 files, run `git diff --cached --check`, then `git commit -m 'feat: add scoped scenario and workspace backups'`.

### Task 7: Acceptance Flows and Existing Feature Regressions

**Files:** Create `tests/e2e/scenarios.spec.ts` and `tests/e2e/helpers/workspace.ts`. Modify `tests/e2e/workspace.spec.ts`, `tests/e2e/forecast-overview.spec.ts`, `tests/e2e/cash-flow-allocation.spec.ts`, `tests/e2e/monthly-budgeting.spec.ts`, `tests/e2e/estimated-mortgage.spec.ts`, `tests/e2e/rsu.spec.ts`, `tests/e2e/salary-cap.spec.ts`, `tests/e2e/child-planning.spec.ts`, `tests/e2e/backdoor-roth.spec.ts`, and `README.md`.

**Interfaces:** Test-only `preloadWorkspace(page: Page, plan: PlanDocument): Promise<void>` seeds a deterministic Master-only envelope only when the new key is absent, then opens `/`; initialization scripts run again after reload. `readActivePlan(page: Page): Promise<PlanDocument>` finds the scenario by `activeScenarioId`, never array position. `preloadLegacyPlan(page: Page, plan: PlanDocument): Promise<void>` is used only for explicit migration tests, likewise opens `/`, and seeds legacy only when both storage keys are absent. All imports/exports use the scope-specific controls from Task 6.

- [ ] **Step 1: Write failing e2e acceptance and regression assertions.** Pin the spec's central flow: migrate legacy Master unchanged; fork Lower growth with deep-equal applied inputs; Save a lower growth rate only there; edit Master independently; retain invalid salary text and unapplied allocation edits across switches; reload preserves active/applied scenarios and removes drafts; full workspace backup round-trip preserves identities/names/links. Use synthetic fixtures with at least two forecast years and compare each scenario's forecast to independently calculated expected results. Include keyboard switching and dialog focus, 375px/1440px layout without page overflow, rename/delete/cancel, and literal names.

Add a quota-failed fork/save followed by switch, full in-memory workspace export, reload of old stored data, and successful restore/retry recovery. Test storage-event suspension from another page on the same origin without attempting race-free multi-tab guarantees. Update all nine existing feature specs' preload/read helpers and scoped restore controls; plain scenario export checks continue asserting bare plan equality. Keep legacy-seeding coverage in the explicit migration test only, preventing reload scripts from overwriting current scenarios.

```ts
test('keeps the selected fork and its applied inputs after reload', async ({page}) => {
  const plan = makePlan({openingCashCents: 12345});
  await preloadWorkspace(page, plan);
  await page.getByRole('button', {name: 'Fork scenario', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Fork Master', exact: true});
  await dialog.getByLabel('Scenario name', {exact: true}).fill('Lower growth');
  await dialog.getByRole('button', {name: 'Create scenario', exact: true}).click();
  await expect(page.getByLabel('Scenario', {exact: true})).toContainText('Lower growth');
  await page.reload();
  await expect(page.getByLabel('Scenario', {exact: true}).locator('option:checked')).toHaveText('Lower growth');
  expect(await readActivePlan(page)).toEqual(plan);
});
```

- [ ] **Step 2: Verify red.** Run `npm run test:e2e -- tests/e2e/scenarios.spec.ts tests/e2e/workspace.spec.ts`; expect new acceptance/regression assertions to expose any incomplete flows. If targeted scenarios already pass after Tasks 5–6, record that integration result and retain those independent acceptance assertions; do not manufacture failures by changing product behavior.
- [ ] **Step 3: Complete acceptance integration and documentation.** Resolve failures in the task that owns their behavior, preserving the spec's exact-copy, session and persistence contracts. Document Master/fork controls, independent editing, draft lifetime, workspace key/migration, separate export/import scopes, per-origin storage, global failure recovery and cross-tab conflict limits. Replace the README's former single-plan storage/restore descriptions so they match the shipped workflow. Keep engine and existing feature expectations intact.
- [ ] **Step 4: Verify the complete implementation.** Run `npm run check`, then `TZ=America/Los_Angeles npm run test:engine`; expect typecheck, all engine/browser tests, production build and Chromium e2e to pass. Inspect the scenario header at 375px and 1440px and verify keyboard/focus flows. Run `git diff --check`; inspect the final diff for accidental private-data fixtures, dependency additions or changes to financial calculation semantics. Broaden/repeat checks only after new fixes or unresolved failures.
- [ ] **Step 5: Commit acceptance integration.** Stage Task 7 changes and any reviewed task-owner corrections, run `git diff --cached --check`, then `git commit -m 'test: verify scenario workflows and recovery'`. Complete the selected execution workflow's whole-branch review and integration handoff. Do not push without exact repository/remote/branch confirmation.

## Execution Handoff

Read and approve this plan before implementation, then choose an execution method. Subagent-driven execution is recommended because the storage and retained-session boundaries warrant a separate review before the next task consumes their interfaces. Native execution keeps implementation in the current agent and uses one independent review at the end.
