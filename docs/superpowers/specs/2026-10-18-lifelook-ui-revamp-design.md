# LifeLook interface and live financial preview

Date: 2026-10-18

Status: Proposed specification for written review. The interaction direction has been approved; implementation requires written-spec and implementation-plan review.

## 1. Intended outcome

LifeLook should make household financial planning easy to enter, understand, and experiment with. Its current interface exposes dense financial records, requires Save before most forecast changes appear, and places competing editor and report panels on screen permanently. Users must read too much before understanding either an input or its consequence.

The redesign makes the balance sheet the main workspace. A focused editor opens only when needed, produces an explicitly unapplied live preview, and commits changes through Apply. Property, salary, and account entry become short, understandable flows. Advanced settings stay available with clear requirements and active-setting summaries. Issues lead directly to the input that needs attention.

The visual direction is sharp and restrained: dark graphite surfaces, white typography, limited blue accents, clear spacing, and fluid motion, inspired by the simplicity requested through the Tesla/SpaceX reference. Financial meaning and keyboard usability remain more important than decoration.

Success means a user can:

- Add or adjust a salary, account, owned property, or planned purchase without working through unrelated advanced fields.
- Change an assumption and see its effect in the annual balance sheet and selected-year totals before applying it.
- Identify which record is being previewed, what is applied, and whether applied inputs have reached local storage.
- Understand what an advanced option needs, retain its values while hidden, and return to those details directly from an issue.
- Use precise amounts, dates, sliders, keyboard controls, and phone-sized screens without losing unfinished work or obscuring unavailable results.

## 2. Selected approach and scope

Use **A: full-width overview with a temporary focused editor**. Guided entry is used inside complex add flows; existing records open directly for adjustment.

| Considered approach | Trade-off | Decision |
| --- | --- | --- |
| Overview with a temporary editor | Keeps the whole financial picture prominent; editing needs a deliberate responsive layout. | Selected. |
| Guided steps as the main application | Reduces initial decisions but makes repeated adjustments slower and places the full table behind another action. | Reuse guidance for adding records. |
| Permanent editor/report split | Direct for repeated edits but recreates competing panels and struggles at narrow widths. | Do not use as the default. |

This is one coordinated browser-interface redesign: navigation, visual primitives, record editors, live preview, reports, diagnostics, and their existing scenario/persistence integration. Preserve the application’s existing financial features rather than shipping a polished subset.

Included:

- All existing household, income, expense, child, debt, account, contribution, allocation, RSU, property, rental, future-purchase, and ADU capabilities.
- Dark/light/system appearance, accessible motion, responsive layouts, precise numeric and date controls, progressive disclosure, and compact record collections.
- Current-record live projection previews and before/after deltas against the active scenario’s applied inputs.
- Existing scenario management, JSON backups, recovery, rule provenance, tax explanations, monthly detail, plots, and ADU comparisons through a simpler interface.

Excluded:

- New tax rules, financial instruments, calculation methods, or unsupported-case coverage.
- Cloud accounts, bank connections, synchronization, a server, or a framework migration.
- Persistent draft recovery, automatic application, undo history, multiple-draft Apply, side-by-side scenario comparison, scenario merging, or historical snapshots.
- Promoting mockup sample figures or illustrative calculations into production logic.

The engine remains independent of browser APIs, storage, and the clock. Keep the existing TypeScript/Vite application and validated financial model. Financial schema version 1, workspace envelope format, record IDs, explicit unknowns, provenance, and backup compatibility remain unchanged. Existing stored arrays and inputs are not normalized or rewritten during loading.

## 3. Workspace, navigation, and responsive behavior

### 3.1 Global shell

The compact header contains LifeLook, the active scenario selector, secondary scenario actions, and a local-save status. Keep Fork and management easy to find without presenting every management control or backup explanation continuously.

The primary destinations are Overview, Income, Accounts, Properties, Spending & debts, and Household. Accounts replaces the visible Investments label. Backups, recovery tools, appearance, and application/source information are available through Settings; an active recovery problem also has a prominent direct action outside that menu.

Navigation uses stable destination identifiers, never equality against visible button text. Existing issue targets continue to resolve their logical sections through an explicit mapping. Renaming Investments to Accounts must not break Review links.

Each collection destination contains compact record summaries with Add and Edit actions. Do not render every record as an expanded form. Show the few facts needed to identify a record, its active features, any draft badge, and unresolved-attention count. Existing records open directly; no repeated setup wizard is required.

Editing opens the overview and the contextual editor together, retaining the originating destination. Closing returns to that destination or the overview, with applied results restored. Issue navigation follows the same editor route and remembers its return destination. Empty collections have one clear Add action and a short explanation.

### 3.2 Overview and focused editor

Without an editor, the overview owns the available content width. It shows the selected forecast year, key amounts, the annual table, and optional plots/detail. Inputs are available from relevant record summaries and primary navigation.

On a wide screen, a temporary editor uses enough width for meaningful labels, dates, and related fields. The remaining report area retains useful totals and the annual table; avoid shrinking the complete report into an unreadable column. The desktop composition needs at least approximately 600 CSS pixels for the report and 380 CSS pixels for the editor, in addition to navigation and spacing. Otherwise use the narrow-screen interaction. Property or ADU editing can use a wider editor within that constraint.

On narrow screens, the editor fills the main workspace. Keep a compact selected-year impact ribbon and an Apply footer available while scrolling. A clearly labeled Forecast view exposes the full draft report without applying or discarding the editor. Returning to Edit restores the field, scroll position, and draft. The entire editor must not precede the forecast in one long page.

The header, navigation, editor, and footer stay within the viewport. Only tables that need it have contained horizontal scrolling. On-screen keyboards, date pickers, expanded sections, long names, and increased text size must not hide the active input or make the primary action unreachable.

### 3.3 Scenario and session behavior

Keep existing baseline/fork semantics: forks copy applied inputs only; the baseline remains editable and cannot be deleted; names, independent scenarios, and restore scopes keep their current meaning.

Scenario switches cancel outgoing preview work, close the transient editor and issue overlays, retain each scenario’s raw drafts and view selections, and show the destination’s applied results. Returning does not silently reactivate an old preview; Draft badges let the user reopen unfinished records. New or reloaded sessions begin at Overview. A fork inherits applicable year/plot preferences and begins without drafts or an open editor.

Forecast year, allocation year, plot series, table view, expanded report detail, collection selection, and field/disclosure state belong to browser sessions. They do not become financial plan inputs. Normalize year selections against the producing plan when forecast bounds change.

## 4. Visual system and interaction primitives

### 4.1 Appearance and hierarchy

Replace hard-coded global green/cream styles with semantic design tokens for surfaces, text, borders, focus, accents, severity, spacing, typography, and motion. Separate shell, collections, editors, reports, and overlays through scoped component styles.

Dark is the initial appearance. Settings offers Dark, Light, and System. Persist the choice under a separate browser-owned preference key, `lifelook.ui.preferences.v1`; never add appearance fields to financial plans or workspace backups. Missing, invalid, or unwritable appearance preferences use an in-memory fallback without blocking the financial workspace. System follows operating-system changes only while selected.

Use tabular numerals for money, modest panel radii, clear primary/secondary/destructive actions, and sufficient contrast for muted text, charts, warnings, and focus. Color accompanies text and icons; it never carries meaning alone. Increasing debt, expenses, or taxes is not automatically colored as beneficial merely because its delta is positive.

Default screens contain short labels, values, and actionable status. Explanations, revisions, rule details, and tax worksheets remain available on demand. Material coverage, funding, or persistence problems stay visible in compact form.

### 4.2 Inputs, sliders, and dates

- Money inputs support readable grouping while preserving raw text during editing and exact cents on conversion. Rate labels distinguish nominal mortgage APR, effective investment return, salary growth, salary percentage, and percentage of cash flow.
- Sliders supplement precise numeric inputs for appropriate continuous assumptions and allocation percentages. Keyboard and direct-entry paths remain available. A slider’s useful range must not clamp, round, or overwrite a valid typed or saved value outside that range. Negative rates remain available wherever the model allows them.
- Dates support direct typing and calendar selection, with dark/light-compatible controls and visible formats. Use month-only controls for month-only concepts. A salary raise anniversary maps to the existing month/day fields through a readable month/day control; retain shorter-month behavior.
- Preserve distinct purchase, origination, first-payment, ADU completion, rental-readiness, and lease dates. Suggested linked dates and derived purchase amounts remain labeled and editable, and existing manual overrides keep precedence.
- Use selects or segmented choices for small, clear alternatives. Known zero, unknown, optional blank, estimated values, and unsupported cases keep their distinct meanings.

### 4.3 Motion and focus

Use approximately 160–240 ms opacity/transform transitions for editor entrances, navigation changes, and disclosures. Keep typing, slider readouts, and primary actions responsive immediately. Do not count financial amounts through fabricated intermediate values or animate every table cell continuously. A brief change highlight after a current preview arrives may identify affected figures without moving rows or changing layout.

Honor `prefers-reduced-motion`; replace movement with immediate state changes or subtle nonmoving feedback. Do not animate focus away, auto-scroll on every recalculation, or rebuild active controls for report updates.

All controls have accessible names, visible keyboard focus, appropriate descriptions, and sufficient touch targets. Dialogs contain focus and restore it on close; disclosures expose expanded state. Use nonmodal editor semantics on wide layouts so both report and editor remain reachable. Escape closes an editor unless a child popup needs the first Escape. Focus returns to its invoking record/action, with a stable collection-heading fallback if that action no longer exists.

## 5. Record entry and progressive disclosure

### 5.1 Shared editing behavior

An editor has a clear record name, short required groups, optional advanced groups, preview status, and a sticky action area. Existing configuration is summarized while collapsed. For example, show `Annual raise · 3% each January 1` or `Rental tax history · 2 details needed`.

Show/hide changes visibility only. Hidden values continue to affect calculations. A separate feature or mode control changes modeled behavior; it explains the effect, reveals the needed fields, and shows incomplete requirements. Switching modes preserves the original applied record until Apply and retains reversible values in the browser draft. Inactive cached values never enter the candidate or backups. Applying a mode change uses only its active, valid model fields; the original saved record changes only at that explicit action.

Do not silently erase saved tax history or linked inputs when collapsing a section. Type changes that would break applied references are rejected with an actionable explanation rather than silently removing linked records. Existing removal and stale-record safeguards remain.

Validate steps when advancing; surface field errors after blur or a deliberate Review/Apply attempt. Do not flood a new form with errors before interaction. A compact requirement count can guide completion without marking a currently focused partial value red on every keystroke.

### 5.2 Salary and other income

Salary basics are name, person, employer, annual gross pay, and start date. Employer identity is presented through a human-readable label/selection while preserving the existing linked employer identity. An unknown employer name is not permission to break contribution or RSU links.

Growth and changes contains annual raise, raise anniversary, optional automatic cap, dated percentage/amount changes, and optional inclusive end date. Display its active summary on the initial screen. Required growth inputs must have explicit values before Apply; existing creation defaults can be shown transparently and edited.

Other income retains amount/frequency, active dates, growth, and tax classification. Reveal owner/employer fields for wage income and NIIT treatment for ordinary taxable income. Classification changes must preserve unfinished values for reversal in the draft and expose unsupported cases clearly.

### 5.3 Accounts, contributions, and RSUs

Ordinary account basics are name, owner, type, balance at January 1 of the forecast start year, and effective annual return. Label the balance date rather than implying it is today’s balance. Relevant brokerage or traditional-IRA basis history appears in a contextual section, with unknown and confirmed zero distinct.

After applying an account, offer Add contributions in that account’s context. Contribution inputs retain fixed monthly versus salary-percentage modes, dates, priority, owner/sponsor references, legal-limit results, and source salary. Apply contribution is a separate transaction from Apply account; do not add unseen contribution edits to an account preview.

An account or salary required by another editor must be applied before it is referenced. A guided detour retains the originating draft, creates the prerequisite through an explicit Apply account or Apply salary, then returns and recalculates the originating preview. Canceling that detour does not create an applied record.

RSUs use their own grant/holdings flow rather than an ordinary account-balance field. Preserve employer/salary linkage, multiple grants, share-count overrides, vesting frequency/cliff, withholding, settlement mode, opening held shares and basis, dated price targets, and the existing live grant summary. Unvested or deferred shares must remain distinguishable from held, available assets.

### 5.4 Properties, rentals, purchases, and ADUs

Begin with Owned at forecast start or Purchase after forecast start, displaying January 1 of the selected forecast start year beside the choice. These describe the model’s forecast boundary, not ownership relative to today: a purchase strictly after that date uses the existing future-purchase path. Use short groups for Property, Financing, and Rent & costs, with advanced tax/history detail associated with the relevant group. Existing records can jump directly to any group without completing the sequence again.

If an edited purchase date crosses that boundary, update the draft’s displayed classification, explain the newly relevant funding/history requirements, and retain reversible inputs in the draft. Do not silently drop confirmed history or replace manual overrides. Existing helpers may update only values they already track as automatic; require the resulting active fields to validate before Apply. Changing the household forecast start can also reclassify properties and must expose resulting requirements through the same validation/issue path.

Owned-property entry establishes name, use, purchase date, value at forecast start, and appreciation, then purchase price/down payment and financing. The full structurally required record must be complete before Apply. Value-only text is not a valid substitute for missing purchase or mortgage facts.

Planned-purchase entry establishes name, use, purchase date, price, down payment, funding source, and mortgage terms where relevant. Preserve existing simple mortgage helpers, payment estimates, automatic-value tracking, editable defaults, manual overrides, and planning-estimate versus detailed modes. A down payment from brokerage remains linked to the actual source account and its funding/tax assumptions.

Mortgage details retain original principal, APR, term, origination/acquisition dates, first payment, opening balance evidence, qualified use/history, and known versus schedule-estimated values. Principal-and-interest estimates are labeled separately from taxes, insurance, and other ownership costs.

Rental income and costs reveal lease/readiness dates, rent/growth/vacancy where supported, direct/shared expenses, allocations, basis/depreciation/loss history, and qualification facts. Clear feature summaries show which tax details remain unresolved. A valid asset forecast does not imply complete rental tax or spendable-cash results.

ADU setup remains within its owning property transaction. Preserve staged construction costs and draw attribution, financing/funding selection, completion value and timing, readiness/lease dates, incremental property assessment and paid-tax schedules, prospective expense sharing, independent tax histories, and the applied-project no-build comparison.

Applying from a nested loan, rental, or ADU view is labeled **Apply property changes** and commits the whole owning property bundle, including its linked rentals and expenses. It never appears to commit only the visible subpanel. Planning estimates stay explicitly estimated; they do not become confirmed history.

### 5.5 Spending, debts, children, and household

Spending & debts contains compact expense, debt, and child-planning collections. Preserve monthly/annual entered expense units, inclusive active dates, growth, tax treatment, property/rental links, allocation shares, mortgage-insurance qualification, and independent debt payment schedules. Explain that linked mortgage payments already enter the forecast to prevent duplicate expenses.

Child planning retains birth month, the existing age-budget model, the optional age-18 treatment, and its material exclusions in contextual help. Do not infer tax-dependent status from a child record.

Household starts with people, forecast bounds, and opening cash. Retirement coverage, employer catch-up facts, household tax coverage, actual state taxes paid, and policy/history detail use contextual advanced groups. They remain reachable through issue links and keep all explicit unknown-history states.

### 5.6 Cash flow allocation

Allocation remains a dedicated editor under Accounts, with its own draft, selected year, preview, Apply allocation, and Discard allocation edits. Preserve percentage and annual-maximum targets, ordering/priorities, salary sponsorship, existing deposits, excess destination, cash earmarks, funding shortfalls, and requested-versus-funded detail.

Percentage controls, dollar readouts, and funded shares use the engine’s original allocation budget for that year (`originalCashFlowCents`), not remaining funds after earlier targets and not a similarly named overview metric. Label this denominator Cash available for allocation and make its amount inspectable. ADU financing can make it differ from the overview’s cash flow before investment contributions; preserve that engine distinction and explain it in contextual detail. Unavailable or nonpositive budgets retain existing eligibility/funding behavior rather than creating a percentage by division.

The global overview can display the allocation candidate while this editor is active. The allocation pie/table and overview must use that same candidate and producing plan. Its selected allocation year remains independent of the overview year; both labels stay visible.

Backdoor Roth retains source-IRA selection and explicit clean-history confirmation. Replace the current helper that immediately saves an empty IRA with the explicit prerequisite-account detour in section 5.3. Entering preview or pressing an Add helper must never silently persist a financial record. New deposits/conversions and the source account are only applied by their named Apply actions.

## 6. Overview, tables, and financial meaning

The default annual table is a balance-sheet view with Year, Cash balance, Investments, Property value, Total debt, and Net worth. Map these to existing annual `reserveCents`, `accountBalanceCents`, `propertyValueCents`, `loanBalanceCents`, and `netWorthCents`. Investments include available held RSU assets; do not add unvested paper value. Total debt includes existing modeled property and general debt schedules. Detail preserves equity and individual account/property/loan reconciliations.

A Financial overview table retains the existing Year, Net Worth, Total Income, Cash Income, Post Tax Income, Expenses, and Cash Flow columns and definitions from `projection-summary.ts`. Preserve these distinctions:

- Cash flow in that summary is before investment transfers; it differs from other lower-level cash-flow or ADU allocation-budget fields.
- Expenses include full debt payments. Mortgage principal is a cash outflow even though it reduces debt.
- Retained RSUs are assets rather than spendable cash; their tax-withholding treatment remains explicit.
- Cash balance is an end-of-year stock; annual cash flow is a flow. Restricted ADU proceeds and unrestricted cash retain their existing detail and cannot be presented interchangeably as spendable cash.
- Year-end net worth is taken from the engine, rather than recomputed with a different UI formula or by double-counting property equity.

Selected-year totals show net worth, annual cash flow before investments, and cash balance, with the selected year in context. Keep the annual table central; charts are optional companions, not replacements. Preserve year selection, plot toggles/keyboard access, expandable months, taxes, sources, and reconciled asset/loan movement details without presenting the wide diagnostic table by default.

Preview deltas compare the current candidate with the active scenario’s current applied result for the same period and metric. They are signed numeric changes, not financial advice. No comparison with Master, a fork source, a prior revision, or another scenario is implied.

Subtract only when both values are available; use safe exact money arithmetic with overflow handling. If either side is Needs data or Unsupported, show its status and explanation rather than a numeric delta. New candidate-only forecast years have no comparison and are labeled No applied comparison. Removed years do not remain in the candidate report. A complete zero remains a displayed zero.

Coverage, rule provenance, and cash-gap conditionality remain separate. A compact attention/conditional badge can replace paragraphs on the default overview, but its cause and effect must be one action away. Independently available balances remain inspectable when other dependent results are unavailable.

## 7. Preview, Apply, and error states

### 7.1 Transaction boundary

Preview exactly one active transaction against all other applied inputs:

| Editor | Preview and Apply scope |
| --- | --- |
| Ordinary record | That salary, other income, account, contribution, expense, child, debt, or standalone record. |
| Household | The existing grouped household/forecast/opening-cash transaction. |
| Property or nested mortgage/rental/ADU | The complete owning property draft with its nested records, linked rentals, and linked expenses. |
| Cash flow allocation | The existing allocation-policy transaction, excluding other record drafts. |

Other unfinished drafts are excluded, even if they appear in the same collection. An allocation draft and an account draft never silently apply together. Unapplied prerequisite accounts/salaries do not satisfy applied-record references.

Opening an unchanged record does not create an edit or write storage. Start a preview after actual draft changes. A new incomplete record has a draft presence but does not affect applied results.

An existing transaction is financially unchanged when its decoded active values, references, and record order equal the applied transaction after excluding revision and browser-only metadata. Ignore object-key order; preserve meaningful differences between absent values, unknown history, confirmed zero, and ordered records. Formatting-only edits or a value/mode changed and reversed show applied results, disable Apply, and consume no revision. Raw text and inactive mode caches can remain in the session without being treated as unapplied financial changes. A new record is not equivalent to the absence of that record.

### 7.2 State and action contract

| State | Overview | Primary action |
| --- | --- | --- |
| No unapplied changes | Applied plan and matching results. | Apply is unavailable; no calculation or write is needed. |
| Updating | Retain the previous valid result for this active editor, or the applied report if none exists. Label Updating and identify its previous/applied source. | Show Updating; do not publish an older candidate. |
| Current valid preview | Show the candidate and signed changes against current applied inputs. Label Preview and the owning record. | Apply changes, Apply property changes, or Apply allocation. |
| Invalid or incomplete draft | Keep raw text; retain the previous valid report with Preview paused, or show the applied report if no valid preview exists. Show a concise requirement/fix count. | Review inputs opens the first actionable field; it does not apply. |
| Stale owning transaction | Keep raw text and clearly mark the preview stale/paused. | Offer the existing discard-and-reload recovery; do not overwrite newer inputs. |
| Unexpected calculation failure | Retain known report data with Preview unavailable and retry/review detail. | Retry calculation; Apply remains unavailable. |
| Applied successfully | Publish the applied plan and its matching report, clear only this transaction’s draft, and remove preview deltas. Keep the editor open. | Announce Changes applied; subsequent edits can start another preview. |
| Applied but persistence failed | Keep the accepted plan/report in memory and show Applied · Not saved locally. | Preserve recovery export and Retry local save. |

The retained report must state whether it is an older valid preview or applied results. Never show the current raw controls beside an unlabeled older forecast. Closing the editor restores the applied report and releases its active record-preview state. Reopening restores raw inputs and recalculates; an invalid reopened record without a retained matching preview displays applied results with Preview paused. Existing retained allocation-preview behavior remains scenario-owned.

Field errors appear after blur or an explicit Review/Apply attempt. Incomplete text in the focused field stays editable without repeated announcements. Structural validation failure and unexpected calculation failure block Apply. A successful calculation containing Needs data, Unsupported, coverage warnings, or a cash gap may still Apply wherever the existing validator permits it. Issue severity alone does not decide whether the input document is valid.

Discard edits restores applied inputs and clears only the owning draft and its feedback. Discarding a new record removes its unfinished presence. Closing, changing records, or switching scenarios retains drafts in memory and does not Apply or Discard them. The footer makes their tab-lifetime limit available through a short description; reload and export still retain applied inputs only.

Removing a saved record remains a separate, explicitly named Remove operation with existing reference validation. Referenced records cannot be removed until links are resolved. No collapse, navigation action, or mode visibility change performs removal.

### 7.3 Scheduling and freshness

Numeric typing and slider readouts update immediately. Coalesce visual work into animation frames and throttle expensive full projection requests rather than creating a new worker for every pointer event. Use a short trailing delay for continuous text/slider changes, bounded periodic requests during a long drag, and an immediate flush on drag completion or committed input. The implementation plan should begin with approximately 100 ms quiet-time and 300 ms maximum-wait scheduling, then verify responsiveness on representative existing scenarios.

Calculate in a worker when supported. At most one active record/allocation preview calculation owns the visible overview. Terminate superseded calculations and reject obsolete replies. Worker absence may use the existing synchronous fallback pattern; a broken supported worker reports a failure rather than silently running the expensive calculation on the main thread.

Every request captures workspace generation, scenario ID, scenario-session generation, view activation, transaction identity, draft generation, applied-plan identity/base revision, and rule-set identity. Publication requires all of them still to match. An imported plan can reuse IDs and revisions; revision equality alone is insufficient.

If an unrelated applied transaction changes while an editor remains open, invalidate the old preview, rebuild the active candidate on the new applied plan, and recalculate its comparison. If the active transaction’s own saved snapshot changed, preserve its draft and report a stale conflict instead. The existing property-bundle snapshot covers linked records. Switching, replacement, restore, deletion, and disposal invalidate obsolete callbacks and issue actions.

Hide numeric deltas and change highlights whenever the displayed candidate and current applied comparison are not a current pair. An older report can remain with its explicit source/stale label, but its numbers must never be subtracted from a newer applied base. Restore deltas only when both sides belong to the current prepared context.

Apply requires the latest completed candidate for the current draft and applied base. Recheck freshness immediately before publication. If it changed, refresh the preview instead of applying a different result from the one displayed. A no-op action never consumes a financial revision or writes storage merely to update view state.

## 8. Browser architecture and data flow

### 8.1 Focused boundaries

| Unit | Responsibility and interface boundary |
| --- | --- |
| Application shell and navigation | Scenario controls, stable destination routing, record collections, editor open/close, appearance, global status, and responsive composition. |
| Design tokens and field primitives | Accessible money/rate/date/select controls, slider pairs, disclosures, steps, action footers, status badges, and focus behavior. No financial calculations or storage ownership. |
| Feature editors | Present the existing model through contextual groups, maintain raw drafts, and identify the owning transaction. Split property/ADU/RSU sections into focused modules rather than expanding a single renderer. |
| Candidate preparation | Decode one transaction, verify identity and stale snapshots, construct and validate the exact candidate, and return its immutable preparation context. No publication or persistence. |
| Preview coordinator/worker | Schedule and cancel calculations, retain explicitly stale results, guard ownership/freshness, and provide status plus the producing plan/report pair. |
| Report view model/renderers | Map existing results into table/plot/detail views and safe deltas. Always receive the producing plan; preserve year, expansion, scroll, and selection state. |
| Issue routing/presentation | Group causes, distinguish attention types, resolve stable record/field destinations, reveal nested groups, and restore focus. |
| Existing scenario manager/storage | Continue to own applied documents, revisions, scenario isolation, backup/recovery, external-change detection, and persistence outcomes. |

Suggested browser modules may include a UI token stylesheet, focused `ui/` primitives, `record-editors/`, `edit-candidate`, `record-preview`, `record-preview-worker`, an overview view model, and stable destination routing. These are implementation boundaries rather than a required scaffold. Reuse existing decoding, validation, property setup, scenario, disclosure, allocation, and publication behavior behind them.

### 8.2 Shared candidate preparation

Introduce a browser-owned preparation contract equivalent to:

```text
prepareEdit(owner, currentAppliedPlan, rawDraft, rules)
    -> ready(candidate, baseIdentity, draftGeneration, affectedRecords)
     | invalid(issues)
     | stale(issues)
```

Preparation performs existing stale-snapshot checks, raw decoding, ID/reference preservation, candidate assembly, and complete-plan validation. It consumes the actual edited draft, including purchase-default/manual-override decisions already made by draft helpers; it must not initialize a second set of defaults while previewing. Strip browser-only draft metadata through the shared decoder. It must not mutate applied inputs, clear drafts, advance live revisions, persist, or announce a successful operation.

Preview and Apply share that candidate construction. Extend the current allocation preparation pattern rather than implementing an alternative financial transformation in the UI. Household grouping, property-owned loans/rentals/expenses/ADU records, linked-record deletion rules, and allocation policy boundaries remain explicit.

Editing an existing record replaces it at its existing array position; truly new records append. Preserve unrelated array order and nested ordering, and remove only records intentionally omitted from the owning transaction. This deliberately removes the current incidental filter-and-append reorder on ordinary Save: contribution order can affect equal-priority funding. Preview and Apply must use the same stable policy, and loading existing plans must not reorder them. Allocation entries retain their explicit draft order and priority semantics.

The candidate carries the revision it would receive if applied. Distinguish the applied **base revision** from that **candidate revision**; the resulting projection’s `inputRevision` must match the candidate. Previewing does not consume or publish a revision. For an edited transaction, accepted Apply advances the live financial and workspace revisions under the existing manager contract. Remove, scenario management/selection, imports, and restores retain their existing independent revision rules. Appearance and within-scenario destination/year/plot selections do not advance financial/workspace revisions.

### 8.3 Report snapshots and publication

Keep a coherent browser display snapshot:

```text
{ producingPlan, projection, appliedComparison, owner,
  baseIdentity, candidateRevision, requestGeneration, displayStatus }
```

All names, account types, purchase/ADU assumptions, labels, issue targets, financial definitions, and tables read from the plan that produced the displayed report. Existing renderers that read `savedPlan` implicitly must receive a producing-plan context. A candidate projection must never be paired with applied-plan names or reference paths. Editing UI state remains a separate dependency for routing to the actual raw control.

Preserve mounted active controls and update reports independently. Reconcile stable report regions instead of replacing the entire report tree on each preview. Retain table scroll, selected year/series, and open monthly/tax/asset details by stable keys. If a detail disappears in the candidate, close that obsolete detail without moving focus unexpectedly. Do not leave detached issue actions targeting a prior report or scenario.

Apply rechecks the prepared candidate against the current base, draft, rules, and owner, then publishes the plan and matching projection atomically through the existing scenario-owned publication/persistence path. It may reuse the completed projection only when all freshness checks match. Do not run a second, different candidate builder or force a duplicate expensive main-thread projection merely because the user clicked Apply. Existing non-preview controller callers retain their validated calculate-and-publish path.

Clear only the applied transaction’s draft; other raw drafts, allocation drafts, and scenarios remain untouched. A rejected validation/calculation changes neither applied plan nor applied projection. A failed storage write after acceptance retains the valid applied pair in memory and keeps the existing global recovery warning.

### 8.4 ADU comparison and dependent reports

The existing build/no-build ADU comparison continues to describe applied property inputs. During a property preview, label it Applied project comparison and keep it inside optional detail; do not present it as a candidate comparison. Applying the property invalidates and recalculates that comparison using its existing guarded scheduler.

Allocation reports use the active allocation candidate when that transaction owns the preview. When another record owns the preview, its candidate report can show that plan’s applied allocation policy and resulting funding, but must exclude any separate unfinished allocation draft. All financial result sections obey the same producing-plan ownership rule.

## 9. Diagnostics, persistence, and recovery

Separate these attention types through short labels and appropriate actions:

- Input problem: correct a field to update/apply this draft.
- Missing financial data: supply relevant history; retain the engine’s availability or explicitly labeled planning-estimate status without substituting UI defaults.
- Unsupported case: explain the modeled boundary without implying a field edit can add unsupported engine coverage.
- Funding gap: show the affected period and conditional-balance meaning.
- Assumption/provenance: inspect the selected rule or estimate on demand.
- Save/recovery problem: export or retry through the existing workspace persistence safeguards.

Use the existing grouping of repeated causes while retaining affected records, fields, and periods. The overview attention count opens a compact actionable list, rather than a permanent wall of warnings. Each Review action selects the right scenario-owned editor, opens the correct step/disclosure, and focuses the exact input. If no editable correction exists, open the relevant coverage explanation instead of a dead-end field link.

An issue click can move from one editor to another while retaining the first draft. Render the target editor’s own preview after opening it; do not carry the old transaction’s report into that editor. A preview-only issue can resolve against a newly added record because its producing plan and raw draft are retained together.

Recalculations preserve issue detail while its underlying issue still exists. When resolved, remove the obsolete detail and announce resolution without stealing focus from the input. Use polite status announcements for meaningful transitions, Apply outcomes, and scenario switches; do not announce every recalculated amount or slider event.

Saved locally describes the applied workspace, never the current draft. Show preview/draft and persistence state separately. Keep the complete recovery behavior for quota/write/read failures, protected unreadable bytes, validated replacement, external-tab change suspension, scoped imports/restores, and retry/export without working storage. Ordinary navigation, Discard, preference changes, or exporting cannot dismiss an unresolved financial persistence warning.

Exports/forks contain applied financial inputs only. New UI preferences, inactive mode caches, preview results, unapplied records, and draft text are excluded. Closing a browser tab or reloading still loses unapplied drafts; present that constraint concisely near editor actions without repeating it in the global header.

## 10. Acceptance and verification

Use existing engine tests as the financial regression foundation. The redesign must produce identical amounts, availability, coverage, funding semantics, and provenance for identical applied plans and rule sets. Add focused browser/controller tests for new preparation and publication behavior; do not replace independent financial expectations with values produced by the new UI.

Required acceptance cases:

1. Open a populated workspace at a full-width overview, find records through compact collections, and add/edit each financial record category without losing existing capability.
2. Adjust a salary amount/raise, account return, property appreciation, purchase mortgage, or allocation slider. Read the candidate’s table/totals before Apply; JSON export and stored applied inputs remain unchanged.
3. Apply the exact reviewed transaction. Its resulting plan/report matches the current preview, increments revisions once, preserves record order and identities, and leaves unrelated drafts/scenarios unchanged. Formatting-only or changed-and-reversed edits are no-ops without new revisions or writes.
4. Edit equal-priority contributions and verify that changing a value does not move the record or change funding order accidentally. New contribution records append predictably.
5. Enter incomplete/invalid text and unknown history. Preserve raw text and distinguish invalid input from valid inputs with unavailable calculations. Show genuine zero as zero and unavailable amounts without fabricated deltas.
6. Rapidly drag sliders/type, switch records/scenarios, close an editor, replace an imported plan with reused IDs/revisions, or restore a workspace. Stale worker results and callbacks never publish into the wrong view or enable Apply.
7. Apply an unrelated record while another draft exists: rebuild its candidate if its own saved snapshot is unchanged; preserve and reject a genuinely stale property/record draft. Hide old deltas until a current candidate/current-base pair is ready.
8. Hide and reopen advanced details, change and reverse a mode, and navigate through an advanced-field issue. Retain applicable values, reveal requirements, focus the correct input, and avoid silent deletion/application.
9. Create prerequisite accounts/salaries, including a backdoor-Roth source IRA, through explicit Apply actions. Canceling an add detour creates no applied account; applying allocation commits only its policy. Verify an ADU year where the allocation budget differs from overview cash flow: percentage targets and shares use the original allocation budget.
10. Apply a complete property bundle including nested mortgage/rental/ADU changes and linked expenses. Preserve future-purchase helper overrides, independent event dates, planning-estimate labels, and applied-only ADU comparison semantics. Cross the January 1 forecast boundary by editing purchase date or forecast start; reveal the correct requirements without losing manual values or silently changing applied inputs.
11. Preserve typed focus/cursor, open report details, selected years/plots, and table scroll during preview updates. Closing/discarding/new-record removal and scenario switching retain the correct draft/session state.
12. Exercise Dark, Light, and System appearance; reduced motion; keyboard-only editing; focus return; screen-reader labels/status; phone/tablet/desktop layouts; long names; and increased text size. No page-wide horizontal overflow or inaccessible sticky actions.
13. Exercise failed persistence, unreadable storage, external-tab changes, legacy migration, import/export, scenario replacement, and workspace restore. Cosmetic preference failures do not interfere with financial recovery.
14. Demonstrate responsive typing and slider feedback on representative multi-year salary/account/property/ADU scenarios, with calculation in a worker and honest pending/stale labels. Use performance observations to tune scheduling; avoid brittle wall-clock assertions in ordinary unit tests.

Run the repository’s complete `npm run check` after implementation: typechecking, engine/browser tests, production build, and Chromium acceptance flows. Update browser acceptance selectors to stable roles/labels/destination IDs rather than retaining obsolete layout assumptions. Add focused visual coverage for both themes and responsive states, plus explicit reduced-motion/focus/preview checks. Test underlying behavior separately from screenshots. Where available, manually smoke-test browser-native date/select behavior in another browser; document any remaining browser coverage limitation.

## 11. Delivery boundaries and documentation

Implement in reviewable layers: shared visual/input primitives and shell, candidate/preview ownership, primary editors and overview, remaining feature integration, then responsive/accessibility/persistence acceptance. The implementation plan must name dependencies and concrete validation for each layer. The final delivery must include all existing feature paths listed in section 2; internal sequencing is not permission to drop complex editors.

Keep files focused on one unit’s responsibility. In particular, separate report snapshot ownership from rendering, candidate preparation from publication, and property/RSU/ADU subeditors from generic input primitives. No new engine-side browser dependency or duplicate financial calculator belongs in this work.

Update README usage for destinations, live preview/Apply, retained drafts, advanced summaries, appearance, and recovery. Preserve historical specs/plans rather than rewriting their earlier design decisions; this spec supersedes their interface descriptions while retaining their financial and persistence contracts. Local visual-companion mockups are illustrative references and are kept in ignored `.superpowers/`; implementation must not depend on their session paths or sample figures.

Follow repository instructions to work and commit on `main`. No `git push` is part of this design stage; any later push requires explicit confirmation for repository `reficul-ac/lifelook`, remote `origin`, branch `main`.
