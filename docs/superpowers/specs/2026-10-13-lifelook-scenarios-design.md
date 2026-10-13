# LifeLook baseline and forked scenarios

Date: 2026-10-13

Status: Draft for review.

LifeLook will turn the current applied JSON inputs into an editable baseline named **Master**. A user can fork that baseline into a named scenario, experiment independently, and switch between scenarios inside the existing workspace. Each fork starts with exactly the same applied inputs and forecast as its source. Later changes belong only to the scenario being edited.

The user confirmed that switching must preserve each scenario's unfinished edits and bring them back when they return. Record Save and Apply allocation retain their current meaning: unfinished edits do not change the applied forecast.

## Scope and design decisions

The first version supports one baseline, named forks, switching, renaming, deleting experiments, and JSON backup and recovery. Master is editable just like an experiment; its Baseline badge identifies its role rather than a lock. The baseline cannot be deleted. It can be renamed without losing that role.

Forking is available from any active scenario, including another experiment. The source is copied once. Subsequent source edits never propagate into that copy, and editing an experiment never changes its source. Fork history describes where a scenario began; it does not establish ongoing inheritance.

| Approach | Consequence |
| --- | --- |
| Complete plan copies in one workspace, selected for this design | Exact starting inputs, independent changes, straightforward recovery, and continued use of the existing calculation engine. JSON backups grow with scenario count. |
| Baseline plus per-scenario overrides | Smaller stored changes, but edits and deletions need inheritance rules, and later baseline changes can alter experiments unexpectedly. |
| Separate JSON files loaded as needed | Reuses current backups, but file management and restore semantics interrupt switching and discard unfinished edits. |

Side-by-side forecast comparisons, diffs, merges, automatic rebasing, promotion of an experiment to baseline, history timelines, cloud synchronization, and persistent draft recovery are outside this version. The existing forecast always describes the one active scenario. Financial calculation behavior remains governed by the existing inputs and rule set.

## Workspace experience

Put the scenario controls in the global header, above the input-section navigation and forecast. The selector must remain easy to reach in both desktop and mobile layouts. Keep the current green and cream palette, native form controls, two-column desktop workspace, and stacked mobile workspace.

The header contains a labeled **Scenario** select, **Fork scenario**, and a secondary **Manage scenarios** disclosure. List the baseline first, then experiments in creation order. Show the baseline's name with a Baseline label; show an experiment's draft indicator when it has unfinished edits. Renaming does not reorder the list. Render names as text, including names containing HTML-like characters.

```text
LifeLook

Scenario  [ Master · Baseline                 v ]
[ Fork scenario ]   [ Manage scenarios ]

Saved locally · Inputs v12
2 drafts · Draft edits not applied

Household | Income | Expenses and debts | Investments | Properties
Financial inputs                         Forecast · Master
```

On a narrow screen, let the selector occupy the full row and wrap the actions beneath it. Long names may be visually truncated, but their full text must remain available to assistive technology and in the management disclosure. Controls and status lines must fit without introducing horizontal page scrolling.

Show the active scenario name alongside the forecast heading so the relationship between inputs and results is explicit. Distinguish **Draft edits not applied** from **Unsaved locally**: the former describes unfinished form edits; the latter means applied workspace changes have not reached browser storage. A storage warning is global and stays visible even after switching to a previously persisted scenario.

Manage scenarios lists the names, Baseline role, fork source when applicable, and draft indicators. Each row offers Rename; experiment rows also offer Delete. Keep creation and switching available directly in the header so everyday use does not require opening management.

## Creating a fork

Fork scenario opens a small dialog titled **Fork Master**, or the active source's current name. It has a labeled **Scenario name** input, a Create scenario action, and Cancel. Suggest `<source name> copy`, with a numeric suffix when necessary; truncate the source portion to fit the name limit. Users can replace the suggestion immediately. Trim outer whitespace, require 1 through 80 Unicode code points, and reject duplicate names using case-insensitive comparison of the trimmed names. Preserve internal spacing and the user's capitalization. Capture the source scenario ID when opening the dialog; switching, deleting, or replacing that source closes the obsolete flow.

Explain the copy boundary beside the name field: **Copies applied inputs. Unapplied edits stay in Master.** Substitute the source name. If the workspace is unsaved locally, the copy still uses the latest valid applied inputs held in memory, rather than an older local-storage snapshot.

Creating a scenario must:

1. Read the captured source scenario's current applied plan when Create scenario is submitted.
2. Validate the name and make an independent deep copy of the complete plan, preserving all input fields, record IDs, array order, revisions, optional-field absence, and explicit unknowns.
3. Assign a new scenario ID outside the copied financial plan and record the source name, scenario ID, and input revision at fork time.
4. Create a clean editor session without the source's pending record drafts, allocation draft, or validation feedback. Begin with the source's input section and selected forecast/allocation years.
5. Add the fork, select it, publish its inputs and matching forecast together, and attempt one workspace storage write.

With the same rules, the initial forecast must equal the source forecast, including unavailable amounts, funding warnings, and provenance. Do not reset assumptions to defaults or regenerate any financial record IDs. Cancel, an invalid name, or an unexpected calculation failure leaves the collection, selection, and all source edits unchanged. A storage-write failure leaves a successfully created fork available in memory and exportable, with the global unsaved warning.

## Switching and independent editing

Selecting another scenario requires no Save or Discard prompt. Prepare the target session and its applied projection before deactivating the source. Once preparation succeeds, capture the outgoing scenario's session, cancel its pending preview work, and show the incoming scenario's own applied inputs, forecast, drafts, validation feedback, and view selections. If preparation fails, the source remains active with its subscriptions and preview scheduling intact. Returning to a scenario restores unfinished text exactly, including blank fields, invalid money input, newly added unsaved records, and nested property or RSU edits. Allocation edits and their last valid preview also belong to that scenario.

Remember each scenario's selected input section, forecast year, allocation preview year, and plot-series selections during the open browser session. A newly created fork inherits those selections from its source. Close transient issue popovers and dialogs on a switch; their review actions must never target a different scenario's records. Keep keyboard focus on the scenario selector and announce **Switched to Lower growth** through the existing status region. The selector, fork dialog, and management actions must support keyboard operation and visible focus; closing a dialog returns focus to its invoking control.

Publish the selected scenario name, form state, and report as one visible change. If a calculation is needed, retain the previous scenario's coherent display with a busy indication until the target is ready. Reject an unexpected calculation exception without changing selection or losing either session. A valid plan with Needs data or Unsupported results remains selectable. Revisiting an unchanged scenario can reuse its calculation under the same rule set.

Every Save, Apply allocation, Discard, add, remove, issue-review action, and asynchronous callback is bound to its owning scenario ID. An action captured in one scenario cannot act on another even when their record IDs are identical. Existing stale-record checks continue within each scenario: preserving a draft includes preserving the base snapshots needed to detect conflicting changes to its record or linked inputs. Saving the same record in another scenario does not make that draft stale.

Record Save and Apply allocation validate and calculate before replacing that scenario's applied plan and projection together. Only that plan's input revision increments. Other scenarios' inputs, projections, drafts, and revisions remain unchanged. Switching, renaming, and deleting another scenario do not increment a financial input revision.

Drafts and view selections survive switching for the lifetime of the open app session. As in the current app, reloads and JSON backups retain applied inputs only. State this beside the draft indicator: **Unapplied edits stay here while this tab is open. Save to keep them after reload.** Returning after a reload selects the last persisted active scenario and recalculates its applied plan.

## Renaming and deleting

Rename uses the same name rules as creation, excluding the scenario itself from duplicate checks. It changes scenario metadata only. Renaming an active scenario updates the selector and forecast heading without rebuilding its forms or losing focus, draft text, or report state. Historical source names in fork metadata retain their value at fork time.

Delete is offered only for experiments. Its dialog identifies the scenario by name and explains that its applied inputs and unfinished edits will be removed. Cancel changes nothing. Deleting an inactive experiment keeps the active scenario and its session intact. Deleting the active experiment activates the baseline and its retained session as part of the same operation; prepare the baseline's projection before removing the experiment. If preparation fails unexpectedly, retain the experiment and selection.

Deleting a source experiment does not delete or alter its forks. Remove only that scenario and its session, invalidate any pending work it owns, and attempt one complete workspace write. If persistence fails, the deletion applies in memory while the old stored copy remains; show that it may return after reload and offer workspace export and Retry local save. Protect the baseline through both the UI and controller, rather than relying on a disabled button alone.

## Stored JSON contract

Keep the embedded `PlanDocument.schemaVersion` at 1 and leave its financial fields unchanged. Add a browser-owned envelope with its own discriminator and version. Use the new storage key `lifelook.foundation.workspace.v1`.

```ts
interface ScenarioDocument {
  id: string;
  name: string;
  plan: PlanDocument;
  forkedFrom?: {
    scenarioId: string;
    scenarioName: string;
    planRevision: number;
  };
}

interface ScenarioWorkspaceDocument {
  kind: 'lifelook-workspace';
  schemaVersion: 1;
  workspaceRevision: number;
  baselineScenarioId: string;
  activeScenarioId: string;
  scenarios: ScenarioDocument[];
}
```

The workspace has at least one scenario, unique nonempty scenario IDs, and unique valid names. Its baseline and active IDs must reference members of the collection. Revisions are nonnegative safe integers. Validate every embedded plan using the existing financial validator; unresolved financial coverage is permitted wherever the existing validator permits it. Preserve JSON values without normalizing missing fields or unknown histories into defaults.

Scenario identity is independent of `plan.id`. Exact forks intentionally share their embedded plan ID, record IDs, and starting input revision. Financial record uniqueness and references are validated within each plan, never across the collection. Keep registries safe for IDs such as `constructor` through Map or equivalent safe keyed access.

The presence of `baselineScenarioId` establishes exactly one baseline role. Avoid a second per-row baseline flag that could disagree. Fork provenance is optional historical metadata: validate its shape and revision, but its source need not still exist. It never creates a financial reference or deletion dependency.

Increment `workspaceRevision` once for each accepted applied-plan change, fork, rename, delete, restore, or actual selection change. Draft edits and view-only selections do not increment it. Retry local save persists the current envelope without incrementing either kind of revision. No-op selections and unchanged renames do not write storage. Reject an increment outside the safe-integer range before changing live state.

## Browser architecture

The engine continues to receive one validated `PlanDocument` and an explicit rule set through `calculateProjection(plan, ruleSet)`. Scenario selection, metadata, browser persistence, session drafts, and clock access remain outside the engine. The engine need not know which scenario is baseline.

Introduce a focused scenario manager above the existing single-plan editor controller:

| Boundary | Responsibility |
| --- | --- |
| Workspace document validator | Validate envelope metadata and all embedded plans; expose issues with scenario identity. |
| Workspace storage adapter | Load, migrate, save, export, and restore whole envelopes; preserve recovery bytes. |
| Scenario manager | Own collection and selection, scenario-bound operations, sessions, workspace revision, and global persistence status. |
| Per-scenario editor session | Retain the applied plan, projection, record drafts and base snapshots, allocation draft and last valid preview, preview status/errors, view selections, ID sequence, and record/task feedback. |
| Browser views and preview scheduler | Bind the visible editor and forecast to one session; preserve view selections and cancel obsolete work. |

Retain a separate editor session per visited scenario. Adapt the current controller's persistence dependency so a Save publishes its candidate through the manager, which serializes the complete workspace once. Do not give multiple controllers the existing singleton plan-storage writer: it would overwrite the same legacy key. The manager's state is authoritative for persistence success; a successful full write persists all scenarios' applied changes together.

Switching is a distinct operation from restore. The current `resetPlan` discards record and allocation drafts; do not call it when merely selecting another scenario. Separate app-shell ownership from editor-session binding so changing scenarios does not dispose their stored editing state. After successful target preparation, dispose or invalidate outgoing view subscriptions and workers before binding the incoming view.

Move allocation preview state currently held in the mounted form closure, and record/task feedback currently keyed to DOM elements, into the retained scenario session. Rebuild views from that session when switching back. In particular, an invalid allocation draft must recover its own earlier valid unapplied preview and stale label; recalculating the invalid draft cannot reconstruct that preview. Disposing view instances must leave this state intact.

Key calculation caches by scenario ID, editor-session generation, input revision, and rule-set identity. Assign a fresh session generation whenever a scenario's plan is replaced, and to every session after a full workspace restore; never restore this generation from JSON. Invalidate the affected caches even when imported IDs and revisions equal the previous values. `plan.id` plus revision is insufficient because forks begin with the same values and imported content can reuse them.

Asynchronous publication guards additionally capture activation or request generation. A late allocation preview, file read, or other callback must be discarded or applied only to its explicitly captured scenario and current session; it cannot publish into the currently visible scenario by accident. Invalidated previews can recalculate from the preserved draft when the user returns.

## Migration and local persistence

On startup, read the workspace key first. A valid workspace is authoritative even if a legacy plan still exists. If the workspace key is absent, read `lifelook.foundation.plan.v1`. Wrap a valid legacy plan unchanged as Master, with newly assigned scenario metadata, baseline and active IDs pointing to Master, and workspace revision zero. Attempt one workspace write. Leave the legacy key and its original bytes intact and stop writing that key after migration. This migration does not modify the plan's revision or recalculate input assumptions.

If neither key exists, create the existing default plan as Master in memory and show Unsaved locally until the first accepted save writes the workspace. Missing data, failed storage reads, malformed JSON, unsupported versions, and invalid references retain distinct recovery states. A present but invalid workspace must not silently fall back to an older legacy plan. Preserve its bytes for download, show the recovery problem, and keep any recovery workspace in memory until the user deliberately restores a valid workspace or replaces the unreadable data through the recovery action. Ordinary edits and switching must not overwrite those original bytes. Apply the same byte-preservation rule to an invalid legacy document.

Provide **Replace unreadable saved data** in this recovery state. It offers a validated workspace backup or a legacy plain-plan backup; the latter becomes a new Master-only workspace using the migration copy rules. After validation, explain that replacement will overwrite the unreadable workspace and discard the current in-memory scenarios and drafts. Preserve the original bytes for recovery download before replacement, and leave the invalid legacy key intact when writing the new workspace key. Failed validation changes nothing; a failed replacement write retains the accepted workspace in memory and the original stored bytes.

A failed migration write retains the migrated Master in memory with Unsaved locally status. Later successful writes save the entire current envelope, including any experiments created since migration. Load itself never silently overwrites corrupt data or runs migration repeatedly over an existing workspace.

When persistence is available, use one serialized envelope and one local-storage write per accepted operation. Validation or an unexpected calculation exception rejects the operation before replacing live state. A quota or write failure after acceptance retains all valid applied inputs and operations in memory, marks the workspace unsaved, and provides **Export workspace backup** and **Retry local save**. Export does not depend on local-storage access. Switching, discarding a draft, or downloading a backup cannot clear a pending storage warning; only a successful workspace write resolves it.

Concurrent editing and merging across browser tabs are outside this version. Detect an external envelope change through storage events or a pre-write check against the last observed stored value; suspend writes on a detected conflict and keep the local workspace exportable. Explain that the saved workspace changed in another tab and offer export followed by reload. This is conflict detection, not a guarantee against simultaneous write races. There is no automatic merge of scenario collections.

Persistence suspension takes precedence over normal operation writes and retries. While protecting unreadable stored data or handling a detected external change, accepted editing and scenario operations remain in memory and Retry local save is disabled. Only a validated, deliberate restore or the recovery replacement action can release unreadable-data protection. An external-change conflict requires export as needed followed by reload before further writes, including restores. Preserve these reasons in the global warning so a successful in-memory edit cannot make the suspended workspace appear saved.

## Backup and restore

Replace ambiguous backup controls with separate actions whose scope is visible:

| Action | Contents or effect |
| --- | --- |
| Export scenario JSON | The active scenario's applied plain `PlanDocument`, compatible with existing plan backups. |
| Export workspace backup | The entire envelope, including all applied scenario inputs, names, baseline role, and active selection. |
| Import scenario JSON | A plain plan backup imported as a new named experiment; existing scenarios and drafts survive. |
| Replace this scenario from JSON | A plain plan backup replaces only the named target's applied inputs and clears only its drafts. |
| Restore workspace backup | A workspace envelope replaces the whole collection and clears all scenario sessions. |

All exports exclude unfinished record drafts, allocation drafts, calculated reports, previews, and view state. Use filenames that distinguish scenario JSON from workspace backups, such as `lifelook-scenario-lower-growth.json` and `lifelook-workspace.json`; provide a safe fallback for names that cannot form a filename. Workspace export includes valid applied inputs that have not yet persisted locally.

Import scenario JSON validates the complete plan before offering its name and final Import action; use the creation name rules and a distinct scenario ID. Preserve the imported plan's IDs and input revision. An imported experiment has no fork provenance. Select it only after its calculation succeeds, then attempt one workspace write.

Replacing a scenario requires a consequence dialog naming the target and stating that its applied inputs and unfinished edits will be replaced. Preserve its scenario identity, name, baseline role if applicable, and existing fork metadata. Store the validated imported plan and its revision as provided, as with the current restore contract; increment the workspace revision and invalidate that target's sessions and pending callbacks. Other scenarios stay intact.

Whole-workspace restore validates the envelope and every embedded plan before replacement, previews scenario count, baseline name, and active name, and states that all current scenarios and unfinished edits will be replaced. Reject duplicate names/IDs, dangling baseline or active IDs, malformed plans, and unsupported envelope versions without changing the current workspace or drafts. Prepare the imported active projection before acceptance. Preserve imported scenario identities and plan revisions; set the restored workspace revision to one more than the greater of the current and imported workspace revisions. Recreate sessions from applied inputs and select the imported active scenario.

Capture the target scenario ID and request generation before reading a file. Disable conflicting controls within that import flow; if its target is deleted, restored, or otherwise replaced while reading, reject the obsolete result and retain the current collection. A read failure or rejected restore leaves all current inputs and drafts untouched. An accepted import or restore with a storage failure remains available in memory and exportable under the global unsaved warning.

Development and production-preview origins continue to have separate browser storage. A workspace backup moves the whole scenario collection between them; a scenario JSON moves one applied plan.

## Acceptance and verification

The central acceptance flow is:

1. Open an existing JSON-backed plan. It appears as Master with the Baseline badge, with its applied JSON values and input revision unchanged.
2. Fork Master as Lower growth. Before any edit, deep equality holds between the two applied plans and their calculated financial results under the same rules.
3. Change and Save an investment growth assumption in Lower growth. Its forecast changes; Master's inputs, revision, and forecast do not.
4. Leave an invalid salary draft and unapplied allocation changes in Lower growth, switch to Master, and edit Master independently.
5. Return to Lower growth. Its saved assumptions, invalid draft text, allocation edits, feedback, and view selections are restored. Master's later edits did not leak into it.
6. Reload after successful saves. The last active scenario and every applied plan return. Unapplied drafts are excluded, as stated by the interface.
7. Export and restore a workspace backup. Names, baseline identity, selected scenario, applied values, record links, and revisions survive.

Document and controller tests cover exact copies with optional children, salary caps, RSU grants, backdoor Roth routes, property/rental links, and allocation policies; shared embedded IDs across forks; scenario name validation; baseline deletion rejection; fork-of-fork provenance after source deletion; independent revisions; retained draft base snapshots; and accepted-operation atomicity.

Storage tests cover first migration, idempotent reload, retained legacy bytes, missing keys, read failures, malformed or unsupported workspace data, invalid embedded references, migration and quota failures, whole-envelope retries, unsaved status surviving switches, and external-change detection. Backup tests cover old plain-plan compatibility, import as a new experiment, replacement of one named target, full restore rejection with unchanged drafts, accepted restore with write failure, and obsolete file reads.

Browser tests cover keyboard switching and dialog focus, baseline and draft labels, coherent input/report updates, preserved invalid and nested drafts, independent new-record IDs, per-scenario view state, late previews after a switch, active and inactive deletion, responsive controls, literal text names, and global recovery visibility. End-to-end tests exercise the central acceptance flow and a failed-storage flow with workspace export and recovery.

Implementation verification uses the existing `npm run check` workflow and engine tests under `America/Los_Angeles`. Scenario metadata and selection must not change the financial engine's output for an unchanged plan and rule set.
