# LifeLook Chart-Led Growth Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LifeLook's Overview a polished, interactive growth workspace where scenario-wide return sliders show an accurate net-worth preview while individual assets retain explicit exceptions.

**Architecture:** Extend the existing plan with optional category defaults and explicit inheritance markers, and resolve effective rates through the existing engine. Add one scenario-owned growth edit target to the registered preview/Apply pipeline, then compose a persistent comparison chart and reviewed assumptions rail into layout A. Reuse native controls, existing scenario publication, and current detailed reports.

**Tech Stack:** Node 22+, TypeScript 5.7, Vite 6.4, native DOM/CSS/SVG and module workers, Decimal.js, Vitest/jsdom/Testing Library, Playwright.

**Spec:** [LifeLook chart-led growth workspace](../specs/2026-10-18-lifelook-growth-workspace-design.md). Read the complete spec before executing this plan. Both documents are drafts for user review; layout A is selected, while reviewed bulk setup and the other detailed decisions remain planning proposals.

## Global Constraints

- Keep Node 22+, TypeScript 5.7, Vite 6.4, native DOM/CSS, module workers, and Decimal.js; add no runtime dependencies.
- Keep plan schemaVersion 1 and the existing workspace envelope, storage keys, JSON backup scopes, record identities, and explicit unknowns.
- A legacy plan without growth defaults or inheritance markers must produce the same financial results and must not be rewritten during loading.
- Store applied category defaults inside each scenario's PlanDocument; drafts and chart preferences must not enter financial backups.
- Keep existing per-asset rates required and preserved, even when a category default is active.
- RSUs use their own price-target schedule and trailing annual rate; never inherit the stock category default in this iteration.
- Property calendar-year overrides take precedence over the inherited or custom base appreciation rate; ADU assessment growth remains independent.
- Preview changes without persistence; Apply publishes the exact current calculated candidate and clears only its owning draft.
- Use 100 ms quiet-time and 300 ms maximum-wait scheduling with an immediate committed-input flush; do not promise that a full forecast completes within those scheduling windows.
- Accept validated integer rates from -9999 through 100000 basis points; slider bounds must not clamp a valid exact input.
- Use 180 ms chart/switch transitions and 200 ms panel transitions; reduced motion makes them immediate.
- Preserve Unknown / Yes / No controls; use switches only for genuinely binary choices.
- Never invoke git push without confirmation for the exact repository, remote, and branch.

## Review Focus

1. A reviewed membership ID disappears, duplicates another selection, or becomes an RSU before Apply: preserve raw choices and reject the entire transaction — Task 2, `rejects changed or ineligible membership without a partial apply`.
2. A brokerage default changes while automatic deposits and a purchase/ADU withdrawal share its ledger: effective growth and funding must match an equivalent explicit-rate plan — Task 1, `uses inherited rates in a shared brokerage funding ledger`.
3. An inherited ordinary account changes to RSU and back: active RSU data must never carry inheritance, while reversible draft values survive — Task 3, `retains reversible growth modes across RSU conversion`.
4. A restore reuses scenario/record IDs and input revisions while a growth worker is outstanding: reject its result and old Apply action — Task 2, `rejects restored growth completions with reused identities`.
5. Native date edits cross leap days, month ends, or the forecast purchase boundary in different timezones: keep ISO dates, manual linked values, and editor focus — Task 7, `preserves date-only edits and manual linked dates`.

---

## File Structure and Execution Order

| Files | Responsibility | Task |
| --- | --- | --- |
| `src/engine/model/plan.ts`, `src/engine/validation.ts`, `src/engine/growth.ts`, `src/engine/projection.ts`, `src/engine/index.ts` | Stored defaults, eligibility, effective rates, all growth consumers. | 1 |
| `tests/helpers/growth.ts`, `tests/engine/growth-assumptions.test.ts` | Synthetic growth inputs and independent monetary/compatibility checks. | 1 |
| `src/browser/growth-assumptions.ts`, `src/browser/state.ts`, `src/browser/edit-types.ts`, `src/browser/edit-candidate.ts`, `src/browser/edit-preview.ts` | Pure growth draft preparation and receipt-based atomic publication. | 2 |
| `src/browser/forms/account-fields.ts`, `src/browser/forms/property-basics.ts`, `src/browser/forms/rsu.ts`, `src/browser/record-collections.ts` | Individual growth source editing and effective-rate summaries. | 3 |
| `src/browser/growth-assumptions-view.ts` | Mounted rail, precise inputs, reviewed membership, preview actions. | 4 |
| `src/browser/growth-chart-model.ts`, `src/browser/views/growth-chart.ts`, `src/browser/styles/growth-chart.css` | Availability-safe chart data and persistent SVG interaction. | 5 |
| `src/browser/views/overview.ts`, `src/browser/editor-view.ts`, `src/browser/workspace-route.ts`, `src/browser/scenario-session.ts`, `src/browser/scenario-manager.ts`, `src/browser/scenario-app.ts`, `src/browser/scenario-controls.ts`, `src/browser/report-snapshot.ts`, `src/browser/styles/workspace.css` | Layout A, active preview ownership, selection/fork preferences, mobile impact, draft counts. | 2, 6 |
| `src/browser/ui/switch-control.ts`, `src/browser/ui/date-control.ts`, `src/browser/fields.ts`, `src/browser/styles/tokens.css`, `src/browser/styles/controls.css`, `src/browser/styles.css` | Native controls and shared visual/motion tokens. | 7 |
| `tests/e2e/growth-workspace.spec.ts`, `tests/e2e/date-controls.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `README.md` | Responsive acceptance, targeted WebKit smoke, existing CI and usage. | 8 |

Use the existing test files named under each task for regressions. Do not rewrite the previous UI plan or the financial rules/source register. Create an isolated execution workspace at implementation time through `using-git-worktrees`; no worktree is needed to review these documents.

Dependency order: **1 → 2 → 3/4; 2 → 5; 3/4/5 → 6 → 7 → 8**. Task 5 can be built against snapshots while Task 3 or 4 proceeds. One implementer owns shared `state.ts`, session/route types, `editor-view.ts`, and test helpers at a time. Apply commits locally after each passing task; pushing is a separate user-confirmed action.

## Task 1: Effective Category Rates Throughout the Engine

**Files:**
- Modify: `src/engine/model/plan.ts`, `src/engine/validation.ts`, `src/engine/growth.ts`, `src/engine/projection.ts`, `src/engine/index.ts`.
- Create: `tests/helpers/growth.ts`, `tests/engine/growth-assumptions.test.ts`.
- Extend tests: `tests/engine/growth.test.ts`, `tests/engine/adu-brokerage-projection.test.ts`, `tests/engine/future-purchase-projection.test.ts`, `tests/engine/rsu-projection.test.ts`.

**Interfaces:**
- Consume: `PlanDocument`, `Account`, `Property`, `BasisPoints`, `validatePlan(raw:unknown)`, `calculateProjection(inputs:ValidatedPlan,ruleSet:RuleSet)`, `propertyRate(property:Property,year:number):BasisPoints`.
- Produce: exported `GrowthAssumptions {readonly stocksBps?:BasisPoints;readonly propertyBps?:BasisPoints}`, optional `PlanDocument.growthAssumptions`, `Account.growthSource?:'stocks-default'`, and `Property.appreciationSource?:'property-default'`.
- Produce: `accountGrowthRate(account:Account,assumptions?:GrowthAssumptions):BasisPoints`; extend `propertyRate(property:Property,year:number,assumptions?:GrowthAssumptions):BasisPoints` compatibly.
- Produce test helpers: `makeGrowthPlan(overrides?:Partial<PlanDocument>):PlanDocument` and `makeScheduledGrowthPlan():PlanDocument`. The former extends `makePlan` with ordinary brokerage `stock` opening at 1,000,000 cents/raw 500 bps, Roth `custom` opening at zero/raw 650 bps, and paid-off owned property `home` opening at 1,000,000 cents/raw 300 bps. The latter adds an independent RSU `scheduled`, one fully vested pre-2026 share held at forecast start, opening share price 10,000 cents, target 20,000 cents on 2027-01-01, own trailing rate 200 bps, and two forecast years; use known opening basis and no new vest income.

- [ ] **Step 1: Write failing engine tests.** Define the helper inputs above using existing `makePlan`/`mustValidate` and full valid property/RSU structures. Pin these assertions:

```ts
it('resolves explicit defaults without replacing custom fields', () => {
  const p = makeGrowthPlan({growthAssumptions: {stocksBps: 770, propertyBps: 400}});
  const stock = {...p.accounts[0]!, growthSource: 'stocks-default' as const};
  expect(accountGrowthRate(stock, p.growthAssumptions)).toBe(770);
  expect(stock.annualGrowthBps).toBe(500);
  expect(accountGrowthRate(p.accounts[1]!, p.growthAssumptions)).toBe(650);
  const home = {...p.properties[0]!, appreciationSource: 'property-default' as const,
    appreciationOverrides: [{year: 2027, rateBps: -100}]};
  expect(propertyRate(home, 2026, p.growthAssumptions)).toBe(400);
  expect(propertyRate(home, 2027, p.growthAssumptions)).toBe(-100);
});
```

Add cases asserting: one-year inherited stock closes at 1,077,000 cents and property at 1,040,000 cents; explicit 5% custom stock closes at 1,050,000 cents; optional zero defaults validate; absent referenced defaults, unsupported markers, RSU inheritance, and rates outside -9999…100000 fail; old inputs are not enriched by validation/export. For `makeScheduledGrowthPlan`, both category changes leave scheduled closing values 20,000 and 20,400 cents and all RSU quantities unchanged. In the existing purchase/ADU synthetic plans, `uses inherited rates in a shared brokerage funding ledger` compares all monthly account balances, sales, basis, tax, cash, and net worth against the same inputs with the effective rate explicitly entered; include the existing automatic-deposit/timing case.

- [ ] **Step 2: Verify red.** Run `npm run test:engine -- tests/engine/growth-assumptions.test.ts`; expect missing types/helpers or unresolved inheritance assertions, rather than unrelated fixture failures.

- [ ] **Step 3: Implement the declared types and helpers.** Validate each supplied optional rate with `Validator.rate`, require its category when a marker is present, reject RSU inheritance, and preserve raw fields. Replace direct ordinary-account growth at `projection.ts` and brokerage-ledger rate assembly with `accountGrowthRate`. Pass defaults through both property growth calls. Preserve the separate RSU calculation, year overrides, ADU assessment rates, effective monthly compounding, rounding, and tax/provenance contracts. Export helpers from `src/engine/index.ts`; do not alter the brokerage solver's input shape or rewrite a derived plan's rates.

- [ ] **Step 4: Verify green.** Run `npm run test:engine -- tests/engine/growth-assumptions.test.ts tests/engine/growth.test.ts tests/engine/adu-brokerage-projection.test.ts tests/engine/future-purchase-projection.test.ts tests/engine/rsu-projection.test.ts` and `npm run typecheck`. Expect all tests passing with existing monetary fixtures unchanged.

- [ ] **Step 5: Commit.** Stage the named Task 1 files, run `git diff --cached --check`, and commit as `feat: add explicit scenario growth defaults`.

## Task 2: Scenario-Owned Growth Draft and Atomic Apply

**Files:**
- Create: `src/browser/growth-assumptions.ts`, `tests/browser/growth-assumptions-state.test.ts`.
- Modify: `src/browser/state.ts`, `src/browser/edit-types.ts`, `src/browser/edit-candidate.ts`, `src/browser/edit-preview.ts`, `src/browser/report-snapshot.ts`, `src/browser/record-ui-state.ts`, `src/browser/workspace-route.ts`, `src/browser/focused-editor.ts`, `src/browser/prerequisite-flow.ts`, `tests/helpers/editing.ts`.
- Extend tests: `tests/browser/edit-preview.test.ts`, `tests/browser/edit-receipts.test.ts`, `tests/browser/scenario-backups.test.ts`, `tests/browser/scenario-manager.test.ts`.

**Interfaces:**
- Consume: Task 1 stored fields, `prepareEdit`, `completePreparedEdit`, `applyCalculatedEdit`, and the existing `EditPreviewCoordinator`.
- Produce in `growth-assumptions.ts`: `GrowthAssumptionsDraft {readonly value:RawObject;readonly baseSnapshot:string}`, `growthAssumptionsSnapshot(plan:PlanDocument):string`, `createGrowthDraft(plan:PlanDocument):GrowthAssumptionsDraft`, and `decodeGrowthDraft(draft:GrowthAssumptionsDraft,plan:PlanDocument):Readonly<{value:RawObject;issues:readonly Issue[]}>`.
- The raw `value` shape is `{defaults:{stocksBps?:string;propertyBps?:string},inheritAccountIds:readonly string[],inheritPropertyIds:readonly string[]}`. Decoding omits blank optional rates and produces integer defaults; both membership lists describe the desired final membership, including opt-outs. Initial defaults reflect applied values only, with absent categories omitted. Initial membership contains only applied inheritance markers. The view stages a proposed rate only after an explicit Set default action for that category.
- Extend `EditTarget` with `Readonly<{kind:'growth-assumptions'}>`. Export `FocusedEditTarget=Exclude<EditTarget,Readonly<{kind:'growth-assumptions'}>>`; focused-editor routes and prerequisite flows use this narrower type because growth is hosted in Overview.
- Add `WorkspaceState.growthDraft?:GrowthAssumptionsDraft` and controller methods `getGrowthDraft():GrowthAssumptionsDraft`, `editGrowthDraft(draft:GrowthAssumptionsDraft):void`, `discardGrowthDraft():void`. No separate projection or synchronous growth-Apply API.

- [ ] **Step 1: Write failing transaction tests.** Reuse `createEditHarness`, `calculateEdit`, and `installPreviewWorker`; extend `setDraftField` with an explicit growth branch, without a fake record ID.

```ts
it('applies defaults and membership as one reviewed transaction', () => {
  const {controller} = createEditHarness(makeGrowthPlan());
  controller.editGrowthDraft({...controller.getGrowthDraft(), value: {
    defaults: {stocksBps: '7.70'}, inheritAccountIds: ['stock'], inheritPropertyIds: []}});
  const target = {kind: 'growth-assumptions'} as const;
  const receipt = calculateEdit(controller, target);
  expect(controller.getState().savedPlan.growthAssumptions).toBeUndefined();
  expect(applyCalculatedEdit(controller, receipt).accepted).toBe(true);
  expect(controller.getState().savedPlan).toMatchObject({revision: 1,
    growthAssumptions: {stocksBps: 770}});
  expect(controller.getState().savedPlan.accounts[0]).toMatchObject({
    annualGrowthBps: 500, growthSource: 'stocks-default'});
  expect(controller.getState().growthDraft).toBeUndefined();
});
```

Also assert: opening/getting a proposed draft causes no write; checking/unchecking a source restores its retained raw rate; blank defaults are omitted; duplicates/missing IDs/RSUs or clearing a referenced default fail atomically; other record/allocation drafts stay raw and excluded; formatting/reversals are no-ops. `rejects changed or ineligible membership without a partial apply` changes applied membership ownership or eligibility after staging, then verifies stale/invalid status and unchanged inputs. An unrelated salary Apply instead rebases. Use controlled workers for the 100/300 ms scheduler, drag-end flush, Apply projection reuse, scenario inactivity, and `rejects restored growth completions with reused identities`. Fork/export/reload carry only applied fields and no growth draft. Simulate failed local storage and verify the existing in-memory/recovery behavior.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/growth-assumptions-state.test.ts`; expect missing growth controller/target behavior.

- [ ] **Step 3: Implement the declared transaction.** Pin the first growth snapshot across edits. Include defaults, account IDs/types/sources/raw rates, and property IDs/sources/raw rates/year overrides; exclude unrelated income and financial facts. Add a growth branch to `buildEditCandidate(base:ValidatedPlan,target:EditTarget,decoded:RawObject):PlanDocument` that updates defaults and markers in array order without reading unrelated drafts. Remove omitted defaults/source keys rather than serializing undefined placeholders. Use the existing full-plan validator, generation tokens, fingerprints, receipts, publication, and persistence path. Extend the private commit clear scope explicitly for growth, clearing only growth on its Apply or Discard; clear it on full reset. Handle growth draft identity in coordinator scheduling, reuse, and discard branches. Keep `WorkspaceOperation` free of invented financial IDs: growth uses ordinary controller notifications and coordinator issues. Label snapshots `Preview · Growth assumptions`; make edit target keys exhaustive and narrow focused/prerequisite routes to `FocusedEditTarget` so no branch assumes growth has a recordId.

- [ ] **Step 4: Verify green.** Run `npm run test:browser -- tests/browser/growth-assumptions-state.test.ts tests/browser/edit-preview.test.ts tests/browser/edit-receipts.test.ts tests/browser/scenario-backups.test.ts tests/browser/scenario-manager.test.ts` and `npm run typecheck`. Expect atomic revision/write behavior and no old receipt accepted after reset or activation changes.

- [ ] **Step 5: Commit.** Stage Task 2 files explicitly, diff-check, and commit as `feat: preview and apply scenario growth assumptions atomically`.

## Task 3: Asset Source Choices and Effective-Rate Summaries

**Files:**
- Modify: `src/browser/forms/account-fields.ts`, `src/browser/forms/property-basics.ts`, `src/browser/forms/rsu.ts`, `src/browser/record-collections.ts`, `src/browser/state.ts`.
- Extend tests: `tests/browser/account-editor.test.ts`, `tests/browser/property-editor.test.ts`, `tests/browser/rsu-forms.test.ts`, `tests/browser/record-collections.test.ts`.

**Interfaces:**
- Consume: Task 1 effective-rate helpers; Task 2 controller and existing `FieldContext`, `RecordEditorMemory`, `beginAdd(section,value?)`.
- Produce: no new public state API. Existing account/property form renderers expose source choices by setting/deleting the declared marker, retaining raw fields; existing collection renderers show the effective rate and Default/Custom/Scheduled source. New-record defaults depend on the applied category configuration, never on an unfinished growth draft.

- [ ] **Step 1: Write failing editor tests.** Use the existing editor harnesses with configured defaults. Pin exact values and mode meaning:

```ts
expect(accountGrowthRate({...makeGrowthPlan().accounts[0]!,
  growthSource: 'stocks-default'}, {stocksBps: 770})).toBe(770);
// After switching that account to Custom and applying:
expect(saved.accounts[0]!.annualGrowthBps).toBe(500);
expect(saved.accounts[0]!.growthSource).toBeUndefined();
```

In each test declare `saved` as the harness's `controller.getState().savedPlan` after the existing Apply action. Assert source choice/readout, custom raw value retention, reversible mode changes, property year-override summaries, unchanged unknown history, and no writes before Apply. `retains reversible growth modes across RSU conversion` checks that RSU candidates omit `growthSource`, dated targets/trailing rate remain intact, and reversing an unapplied conversion restores the previous ordinary source. Existing linked contributions still reject an invalid type change. New ordinary assets inherit only a configured applied category; legacy assets remain custom; new RSUs never inherit.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/account-editor.test.ts tests/browser/property-editor.test.ts tests/browser/record-collections.test.ts`; expect missing source controls/summaries.

- [ ] **Step 3: Implement source editing through existing form/mode helpers.** Use **Category default / Custom** labels. In default mode replace the raw rate editor with a readable effective-rate/source summary; preserve the raw rate in the draft. Keep property year overrides independent and label the selected-year precedence. Include inheritance markers in reversible RSU mode ownership, stripping them from active RSUs. Update new-record initialization and collection summaries without changing IDs, account prerequisites, or unrelated property bundle data. Export no browser-specific engine resolver.

- [ ] **Step 4: Verify green.** Run the four Task 3 suites and `npm run typecheck`. Expect source changes to preview/apply through the ordinary owning-record transaction and legacy collection summaries to retain their entered rates.

- [ ] **Step 5: Commit.** Stage the Task 3 files, diff-check, and commit as `feat: expose default and custom asset growth modes`.

## Task 4: Mounted Growth Rail and Reviewed Bulk Setup

**Files:**
- Create: `src/browser/growth-assumptions-view.ts`, `tests/browser/growth-assumptions-view.test.ts`.
- Modify: `src/browser/styles/controls.css` for the rail's semantic control classes only.

**Interfaces:**
- Consume: Task 2 growth draft/preview APIs; `mountNumericControl`; existing issue formatting and native disclosures.
- Produce: `mountGrowthAssumptions(root:HTMLElement,controller:WorkspaceController,options:{preview:EditPreviewCoordinator;activate():boolean;isCurrent():boolean;context:IssueViewContext}):{update():void;reveal(field:string):void;dispose():void}`.
- `activate` must succeed before editing or applying growth; the host decides preview ownership. The view never disposes the shared coordinator. `reveal` accepts `growthAssumptions.stocksBps`, `growthAssumptions.propertyBps`, `inheritAccountIds`, or `inheritPropertyIds`. The view reads operation status from the shared coordinator and local persistence from the controller.

- [ ] **Step 1: Write failing view tests.** Mount the rail with a real test coordinator and controlled worker; use an activation spy that selects the growth target. Assert names and exact values:

```ts
expect(stockSlider.min).toBe('-1000');
expect(stockSlider.max).toBe('2000');
expect(stockSlider.step).toBe('10');
expect(propertySlider.min).toBe('-500');
expect(propertySlider.max).toBe('1500');
expect(propertySlider.step).toBe('10');
```

Resolve these variables through the rail's labeled native range inputs after setup. Also assert: passive viewing/membership review is nonmutating; Set default explicitly stages stock `7.70` or a blank property rate; configuring only property never adds an unconfigured stock default; only existing inherited IDs begin checked; Select all excludes RSUs; clear selection preserves raw custom values; membership counts update; and a zero-member category states that it affects no assets. Enter `25.13` and `-12.34` in exact stock input and verify the retained raw/candidate values are not clamped by the slider. Verify invalid partial text retains the active input/caret and produces paused rather than current deltas. Apply uses the current receipt; Discard clears only growth; failed activation/detached actions cannot write or apply another target. Persistence failures remain visible as distinct applied/local-save state.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/growth-assumptions-view.test.ts`; expect missing mounted rail.

- [ ] **Step 3: Implement the declared mount.** Keep numeric inputs mounted while updating status/counts. Show Set default for absent categories; after activation its explicit action stages only that category's proposal, with stock `'7.70'` or property `''`. Use a native disclosure for membership review, with separate account/property Select all and Clear selection actions. Decode optional blanks through Task 2 rather than the required-value numeric parser. Use the spec's ranges, two-decimal exact entry, source summaries, zero-member feedback, **Apply growth changes**, **Discard edits**, and explicit Draft/Updating/Preview/Paused labels. Handle committed input by requesting an immediate preview. Use the controller's raw draft as the single source of edited data; no internal projection or storage writes.

- [ ] **Step 4: Verify green.** Run the Task 4 suite plus `npm run test:browser -- tests/browser/numeric-control.test.ts` and `npm run typecheck`. Expect stable active inputs, exact basis points, and no synthetic ID-based issue routes.

- [ ] **Step 5: Commit.** Stage Task 4 files, diff-check, and commit as `feat: add reviewed category growth controls`.

## Task 5: Persistent Comparison Chart and Accurate Scrubbing

**Files:**
- Create: `src/browser/growth-chart-model.ts`, `src/browser/views/growth-chart.ts`, `src/browser/styles/growth-chart.css`, `tests/browser/growth-chart-model.test.ts`, `tests/browser/growth-chart.test.ts`.
- Modify: `src/browser/scenario-session.ts` for view-only chart preferences.

**Interfaces:**
- Consume: `ReportSnapshot`, `Available<Cents>`, annual projections, and `ReportIssueContext`.
- Produce model types: `GrowthChartHorizon=5|10|15|'all'`; `GrowthChartViewState {horizon:GrowthChartHorizon;showComparison:boolean}`; `GrowthChartPoint {readonly year:number;readonly netWorth:Available<Cents>;readonly appliedNetWorth:Available<Cents>|null;readonly delta:Available<Cents>|null}`; `GrowthChartModel {readonly points:readonly GrowthChartPoint[];readonly selectedYear:number;readonly horizon:GrowthChartHorizon;readonly availableHorizons:readonly GrowthChartHorizon[];readonly status:ReportSnapshot['status'];readonly sourceLabel:string;readonly canCompare:boolean}`.
- Produce `buildGrowthChartModel(snapshot:ReportSnapshot,selectedYear:number,horizon:GrowthChartHorizon):GrowthChartModel`. Clip points from the producing plan's start year and normalize selection; obtain comparison only from a current snapshot with `allowDeltas`.
- Produce `mountGrowthChart(root:HTMLElement,initial:GrowthChartModel,options:{view:GrowthChartViewState;context:ReportIssueContext;onSelectYear(year:number):void;onViewChange():void}):{update(model:GrowthChartModel,context:ReportIssueContext):void;dispose():void}`. Updates replace the current producing-plan issue context as well as data; retained handlers must not route through an earlier plan/context.
- Add `EditorViewSession.growthChart:GrowthChartViewState`, initialized to `{horizon:'all',showComparison:true}`. Keep it separate from persisted financial inputs; clone applicable view preferences for a fork.

- [ ] **Step 1: Write failing model and DOM tests.** Build snapshots using `makePlan`, independent known amounts, and existing producing-plan helpers. Pin comparison behavior:

```ts
expect(buildGrowthChartModel(snapshot, 2026, 'all').points[0]).toMatchObject({
  year: 2026, netWorth: {status: 'available', value: 12500},
  appliedNetWorth: {status: 'available', value: 10000},
  delta: {status: 'available', value: 2500}});
expect(buildGrowthChartModel({...snapshot, comparison: null, allowDeltas: false},
  2026, 'all').points[0]!.delta).toBeNull();
```

Here `snapshot` is a current preview fixture with 12,500 candidate and 10,000 applied cents, as in the existing overview-model tests. Add selected-year gaps, missing applied years, unsupported values, delta overflow, negative/zero curves, one-point horizons, and a 5Y range of 2026–2030. Derive available horizon chips from the full forecast, retaining 10Y/15Y/All when viewing 5Y; normalize an unavailable requested horizon to All after a plan change. DOM tests retain the same SVG/path nodes while pointer/keyboard selection changes, assert exact readout/selected year, and check Arrow/Home/End, native selection callback, comparison toggle, and series labels/styles. Hide comparison without changing the value domain. Model paused/pending snapshots must remove numeric comparison and retain source labels. Mock ResizeObserver for narrow geometry, verify updated issue actions use the latest producing context and old detached actions are inert, verify disposal, and assert reduced-motion updates skip animation. Use data attributes for domain/animation state only when they also serve component behavior, not test-only calculations.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/growth-chart-model.test.ts tests/browser/growth-chart.test.ts`; expect missing chart contracts.

- [ ] **Step 3: Implement model and persistent view.** Keep the model pure and availability-safe; reuse Decimal/settled-cents delta semantics from `overview-model.ts` without unsafe subtraction. Mount controls/SVG once. Update paths on new completed models, and only crosshair/readout on selected-year movement. Use container-sized SVG geometry, actual annual points, one shared zero-inclusive domain, missing-value segments, dashed applied and solid preview styles, and the spec's distinct horizons. Preserve `Net worth over time` accessible name, exact readout, keyboard alternatives, and polite committed-selection announcements without announcing every pointer movement. Store view preferences only in `EditorViewSession`. Implement 180 ms same-topology transitions or safe segment crossfades; honor reduced motion and cancel old animation frames on disposal.

- [ ] **Step 4: Verify green.** Run both new suites, `npm run test:browser -- tests/browser/overview-model.test.ts tests/browser/overview-state.test.ts`, and `npm run typecheck`. Expect correct ownership/gap handling and stable path/control identity while scrubbing.

- [ ] **Step 5: Commit.** Stage Task 5 files, diff-check, and commit as `feat: add persistent net worth comparison chart`.

## Task 6: Integrate Layout A and One Active Preview Owner

**Files:**
- Modify: `src/browser/views/overview.ts`, `src/browser/views/forecast-plots.ts`, `src/browser/editor-view.ts`, `src/browser/workspace-shell.ts`, `src/browser/workspace-route.ts`, `src/browser/scenario-session.ts`, `src/browser/scenario-manager.ts`, `src/browser/scenario-app.ts`, `src/browser/scenario-controls.ts`, `src/browser/issue-presentation.ts`, `src/browser/styles/workspace.css`, `src/browser/styles.css`.
- Create: `tests/browser/growth-overview-integration.test.ts`.
- Extend tests: `tests/browser/workspace-shell.test.ts`, `tests/browser/overview-state.test.ts`, `tests/browser/attention-routing.test.ts`, `tests/browser/forecast-plots.test.ts`, `tests/browser/scenario-review-regressions.test.ts`, `tests/browser/scenario-manager.test.ts`.

**Interfaces:**
- Consume: Task 4 `mountGrowthAssumptions`; Task 5 model/chart mounts; Task 2 `FocusedEditTarget` and shared coordinator.
- Extend `mountOverview(root,initial,context,view,options?:{growthControls?:HTMLElement})` with the same existing `{update(snapshot:ReportSnapshot):void;dispose():void}` return. The supplied rail is mounted once by the host; Overview positions it without owning its subscriptions.
- Extend `renderForecastPlots(root,rows,context,selections?,onSelectYear?,options?:{includeNetWorth?:boolean})` with a backward-compatible default of true. Overview passes false and keeps the secondary cash-flow plot, avoiding a duplicate net-worth graph.
- `targetForReview` may return the growth edit target for root `growthAssumptions` fields. `mountEditorView` handles that target in the rail and sends only `FocusedEditTarget` to focused editors/prerequisites.
- Keep `forecast-year-selected`, `ScenarioViewSelections.forecastYear`, `hiddenPlotSeries`, and existing report-control keys. New sessions choose the final forecast year; retained/forked valid year selections keep their existing meaning.
- Extend `createEditorViewSession(plan:PlanDocument,selections?:ScenarioViewSelections,growthChart?:GrowthChartViewState):EditorViewSession` with a cloned optional chart preference argument. Pass the source view's chart preferences through the scenario manager's private session factory during a fork, without copying drafts or open-editor state.

- [ ] **Step 1: Write failing integration tests.** Mount the actual editor view with controlled workers. Assert a primary visible chart and rail before the annual table; one net-worth plot; optional cash-flow/detail reports still present; and matching selected-year totals/table/chart/ribbon. Pin transitions:

```ts
expect(coordinator.getState().target).toEqual({kind: 'growth-assumptions'});
// After opening an ordinary account editor:
expect(coordinator.getState().target).toEqual({kind: 'record', section: 'accounts', recordId: 'stock'});
expect(controller.getState().growthDraft).toBeDefined();
```

Use an integration harness exposing the created coordinator through a controlled factory spy; do not add production globals. Also assert record edit → Edit growth assumptions retains the record draft; growth Apply never applies it; background/default controls cannot steal an active record preview; navigation cancels visible ownership; returning to a scenario shows applied results plus a resumable Draft label; fork/export exclude drafts; growth is counted in existing draft summaries. Review links for default fields reveal the correct rail input. Late worker replies and detached old actions cannot switch reports. Verify a bulk source change stales an existing owning-record draft, while changing only the shared rate safely rebases unchanged records. Keep ADU comparison labeled applied and all tax/detail/focus/scroll behavior intact.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/growth-overview-integration.test.ts`; expect missing layout/host ownership behavior.

- [ ] **Step 3: Integrate the mounts and routing.** Let `editor-view.ts` own one coordinator and the rail's activation callback. Activating growth closes/suspends the focused editor without discarding its raw inputs; opening/navigating away suspends growth and rejects late work. Never mount growth as a pretend record editor. During record editing, disable competing growth inputs and expose Edit growth assumptions. Build the chart from each producing snapshot and pass the current producing-plan issue context on update; reuse mounted controls/paths and keep existing reports below. Use approximately a 280px desktop rail with a `minmax(0,1fr)` chart; stack when space is insufficient. Add a nonobscuring sticky year/net-worth/delta/source ribbon for mobile growth editing. Route default issues before generic Household handling, update draft counts, clone fork chart preferences through the declared session interface, and normalize shared selections/preferences on horizon/plan changes. Import the focused chart stylesheet through the existing styles entry.

- [ ] **Step 4: Verify green.** Run the new integration suite and all Task 6 regression suites, plus `npm run typecheck`. Expect one current report owner, no duplicate chart, no focus loss, and existing advanced reports still accessible.

- [ ] **Step 5: Commit.** Stage the Task 6 files, diff-check, and commit as `feat: make the overview a chart led growth workspace`.

## Task 7: Native Dates, Switches, and Shared Interaction Polish

**Files:**
- Create: `src/browser/ui/switch-control.ts`, `src/browser/ui/date-control.ts`, `tests/browser/switch-control.test.ts`, `tests/browser/date-control.test.ts`.
- Modify: `src/browser/fields.ts`, `src/browser/views/growth-chart.ts`, `src/browser/styles/tokens.css`, `src/browser/styles/controls.css`, `src/browser/styles/workspace.css`.
- Extend tests: `tests/browser/forms.test.ts`, `tests/browser/income-editor.test.ts`, `tests/browser/future-property-purchases.test.ts`, `tests/browser/adu-project-forms.test.ts`, `tests/browser/child-planning.test.ts`.

**Interfaces:**
- Produce `mountSwitchControl(host:HTMLElement,options:{label:string;field:string;checked:boolean;onChange(checked:boolean):void}):{input:HTMLInputElement;update(checked:boolean):void;dispose():void}` using a native checkbox with switch semantics.
- Produce `mountDateControl(host:HTMLElement,options:{label:string;field:string;kind:'date'|'month';raw:string;onInput(raw:string):void;onCommit():void}):{input:HTMLInputElement;update(raw:string):void;dispose():void}` using native date/month inputs and ISO values.
- Extend `FieldOptions.kind` with `'switch'`; route existing binary checkbox controls through the same native switch styling/behavior while retaining their data-field identity. Preserve `renderHistory` boolean-history dispatch for checkbox, select, and switch presentation hints, so unknown histories still become three-state selects. Date/month `renderField` branches delegate to the date primitive. Keep the dedicated anniversary control and current money/rate parsing contracts unchanged.

- [ ] **Step 1: Write failing control tests.** Pin keyboard state and date-only values:

```ts
expect(dateInput.type).toBe('date');
expect(dateInput.value).toBe('2028-02-29');
expect(monthInput.type).toBe('month');
expect(monthInput.value).toBe('2028-02');
expect(switchInput.type).toBe('checkbox');
expect(switchInput.getAttribute('role')).toBe('switch');
```

Resolve these variables from the mounts with corresponding options. Check mounted input identity, direct/native input and commit callbacks, no change on passive update, disposal, accessible names, and three-state histories still offering Unknown/Yes/No; verify native Space activation in the browser acceptance test. `preserves date-only edits and manual linked dates` reuses existing purchase/ADU fixtures to cross 2026-01-01 → 2026-01-02, leap-day and month-end dates without overwriting manual first-payment, readiness, or lease dates. Verify the same field stays focused; an empty native value pauses the preview and leaves applied dates unchanged. Preserve native-managed unfinished date segments without fabricating a partial ISO string. Salary anniversaries still clamp under their current engine rules. Test these cases under both configured test timezones.

- [ ] **Step 2: Verify red.** Run `npm run test:browser -- tests/browser/switch-control.test.ts tests/browser/date-control.test.ts`; expect missing primitives.

- [ ] **Step 3: Implement the declared native controls and visual tokens.** Keep dates as ISO strings; never round-trip through Date timestamps or a locale parser. Preserve `financial-input-commit` behavior, avoid duplicate commits for unchanged blur, and do not replace an active control on report updates. Apply switch styling only to two-state values, including the chart comparison control; preserve unknown history selects. Use the spec's dark/light colors and 180/200 ms durations, semantic focus/severity tokens, restrained separators, readable sliders, and 44px hit areas. Reduced-motion styling makes transitions immediate. Do not introduce decorative number counting or change financially distinct date relationships.

- [ ] **Step 4: Verify green.** Run the seven Task 7 new/regression suites, `npm run test:browser -- tests/browser/numeric-control.test.ts tests/browser/appearance.test.ts`, and `npm run typecheck`. Update the child's existing binary-control role selector to switch while preserving its behavioral assertions. Expect stable focus, exact dates/rates, and unchanged unknown semantics.

- [ ] **Step 5: Commit.** Stage Task 7 files, diff-check, and commit as `feat: polish native financial editing controls`.

## Task 8: Responsive Acceptance, Browser Checks, and Documentation

**Files:**
- Create: `tests/e2e/growth-workspace.spec.ts`, `tests/e2e/date-controls.spec.ts`.
- Modify: `tests/e2e/forecast-overview.spec.ts`, `tests/e2e/ui-revamp.spec.ts`, `tests/e2e/ui-appearance.spec.ts`, `tests/e2e/child-planning.spec.ts`, their affected snapshot artifacts, `playwright.config.ts`, `.github/workflows/ci.yml`, `README.md`.
- Create: `docs/superpowers/reviews/2026-10-18-lifelook-growth-workspace-verification.md` during execution, containing measured/manual evidence and any actual browser limitation.

**Interfaces:**
- Consume: completed Tasks 1–7 and current Playwright workspace fixtures, `preloadWorkspace`, `readActivePlan`, and replacement helpers. No new production interface.
- Retain the existing full Chromium project. Add a `webkit-controls` project limited by `testMatch` to `date-controls.spec.ts`; install its browser in CI and keep its smoke coverage focused on native date/month, switch keyboard use, and preserving a focused input while a preview arrives.

- [ ] **Step 1: Write failing acceptance tests.** Use synthetic data only. At 320, 390, 768, 1180, and 1440px verify no page/control clipping, usable chart geometry, keyboard/touch scrubbing, visible selected-year impact, reachable Apply, and no active-field replacement. Assert previewing 7.70% does not change saved JSON; Apply changes values/membership once; a custom account, scheduled RSUs, and a property year override remain independent; scenario switch/restore reject obsolete work. Existing table, cash-flow, tax, ADU, backup, and complex-editor flows remain reachable. Date smoke exercises native direct entry/month selection, leap day, switching an appearance setting without losing focus/value, and preview completion. Run relevant views with both themes, reduced motion, and 200% text zoom; update layout snapshots only after behavior assertions pass.

- [ ] **Step 2: Run focused acceptance.** Before adding the WebKit project, run `npm run test:e2e -- tests/e2e/growth-workspace.spec.ts tests/e2e/date-controls.spec.ts --project=chromium`. Record concrete integration/presentation gaps for the next step; if the already implemented features pass, retain that evidence without manufacturing a failing test or suppressing old financial assertions.

- [ ] **Step 3: Complete acceptance wiring and usage documentation.** Add the scoped WebKit project and required CI browser installation while preserving current timezone jobs, locked dependencies, and preview-server behavior. Update existing selectors for the new visible hero/optional cash plot, final-year initial selection, and the child's binary switch role. Fix actual presentation issues in their owning Task 6/7 files, without weakening behavior assertions. Document configuring/inheriting defaults, bulk review, Custom/Scheduled exceptions, preview/Apply, new chart navigation, retained drafts, and origin-specific backups. Record browser versions, viewport/text-zoom checks, and one responsiveness observation on a synthetic 30-year salary/account/property/ADU plan: input feedback, worker scheduling/completion, pending labels, and stale-result rejection; do not turn the observation into a brittle full-forecast time budget.

- [ ] **Step 4: Run the final checks.** Run `TZ=UTC npm run check` (including the Chromium suite and scoped WebKit project), `TZ=America/Los_Angeles npm run test:engine`, and `TZ=America/Los_Angeles npm run test:browser`. The focused WebKit rerun command, if a failure needs isolation, is `npm run test:e2e -- tests/e2e/date-controls.spec.ts --project=webkit-controls`. Expect all available automated checks passing; if a local browser cannot run, record the exact limitation and CI result without claiming local success. Inspect affected screenshot changes, contrast/focus, and the manual mobile/date behaviors listed above. Do not broaden/repeat checks after success unless a subsequent change or unresolved failure justifies it.

- [ ] **Step 5: Commit.** Stage the Task 8 tests, configuration, approved snapshots, README, and verification record; diff-check and commit as `test: verify the growth workspace across editing and browser flows`.

## Coverage and Handoff

| Design requirement | Owning tasks |
| --- | --- |
| Additive defaults, legacy behavior, effective rates, property precedence, independent RSUs | 1 |
| Explicit bulk membership, atomic preview/Apply, stale ownership, persistence/fork/export compatibility | 2, 4, 6 |
| Individual override modes, source summaries, new-asset defaults, reversible RSU conversion | 3 |
| Persistent chart, comparison domain/gaps, accurate scrubbing and horizon selection | 5, 6 |
| Layout A, mobile impact, detailed reports and one active preview owner | 6 |
| Precise sliders, native dates/switches, semantic colors, motion/accessibility | 4, 5, 7 |
| Cross-browser/timezone/responsive behavior, performance evidence and usage docs | 8 |

Planning self-review checks: contracts above are defined by their producing task; all five Review Focus cases have an owning test; no new model calculation is implemented in the browser; no tasks depend on mockup values, a live companion, or its private key. During execution, use fresh evidence before claiming completion and keep all unapproved pushing out of commit steps.

Recommended execution: **Subagent-driven**, because the eight tasks cross financial-rate resolution, multi-asset publication, and preview ownership, where a focused review at each interface is useful. **Native** execution is a lower-cost alternative with one implementer and a final independent review. The user must review these documents and select an execution method before implementation.
