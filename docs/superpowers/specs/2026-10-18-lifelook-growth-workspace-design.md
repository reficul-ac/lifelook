# LifeLook chart-led growth workspace

Date: 2026-10-18

Status: Draft for review alongside the implementation plan. The user selected a chart-led Overview and visual layout A. Detailed behavior below is a planning proposal; it does not record approval of an implementation or of financial assumptions.

## 1. Outcome and agreed direction

Make it easy to see how a proposed change affects future wealth. A user should be able to drag a category return slider, see a clearly identified forecast change, inspect a particular year, and apply the reviewed change without editing several accounts separately.

The user requested slick, clean, simple visuals with SpaceX/Tesla influences, Robinhood-like chart interaction, useful animation, sliders with precise editing, Apple-style switches, reliable date entry, category growth defaults, and individual exceptions. The user explicitly selected **layout A: a dominant chart with a slim assumptions panel beside it**. The balance sheet and existing detailed reports remain available below the primary chart.

The visual-companion study is retained locally at `.superpowers/brainstorm/123357-1792389145/content/growth-overview-layouts.html`. It uses illustrative numbers and simplified curves; neither its calculations nor its sample balances are implementation requirements. The companion's server and private session key are not product dependencies.

Planning assumptions, open to correction during review:

- Use one reviewed bulk setup to choose which existing assets inherit category defaults. Nothing changes merely because an old plan is loaded.
- Use the user's 7.7% example as a proposed stock default during setup, not as a recommended market return or a silently saved assumption. Leave the proposed property default blank until entered.
- Keep the established preview → Apply workflow. Dragging does not persist financial changes.
- RSUs remain independent in this iteration, including accounts without price targets. Anduril retains its dated targets and its own annual rate after the last target.
- Show annual year-end projections. This is a financial forecast with market-style interaction, not a historical or daily stock-price feed.

Success means a user can identify the source of every effective growth rate, change defaults without disturbing exceptions, compare a current preview with its applied base, edit accurately on a phone, and retain all existing scenario, recovery, tax, funding, and property capabilities.

## 2. Scope and constraints

This is one coordinated feature: scenario-wide growth inputs feed the existing engine and preview transaction, and the Overview makes their effect immediately understandable. Common control polish supports that same editing experience. It does not require a new application framework or financial model.

Global constraints, copied into the implementation plan:

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

Excluded: bank connections, cloud storage, daily market data, new tax rules, portfolio composition inference, new RSU valuation mechanics, milestone-goal modeling, Monte Carlo projections, persistent drafts, undo history, automatic saving, and unrelated form restructuring. No implementation work begins merely because this draft or its plan exists.

## 3. Overview layout and visual behavior

### 3.1 Layout A

The Overview opens with a large net-worth figure for the selected year, a signed preview delta when a current comparison exists, a dominant trajectory chart, and a narrow growth-assumptions rail. Put the annual balance sheet, financial overview, cash-flow chart, tax/monthly detail, and applied ADU comparison below that focal region. Do not duplicate the net-worth plot inside the secondary charts disclosure.

Use open spacing and restrained separators rather than a stack of outlined cards. Initial tokens are dark page `#0b0e0d`, primary text `#eff2f1`, muted text `#aab5ae`, border `#344039`, and chart accent `#b7efdc`. The light theme uses page `#f7f8f7`, primary text `#17211b`, muted text `#53635a`, border `#a7b4aa`, and accent `#236c52`. Verify actual control/text contrast in both themes. Preserve existing Dark / Light / System behavior and semantic severity colors. Scope the new composition so collections and advanced financial forms remain readable.

On sufficiently wide screens, use approximately `minmax(0, 1fr) 280px` for the chart and assumptions. At narrower widths, stack the rail below the chart. Fit, text size, and useful control width determine the breakpoint; do not force a squeezed desktop chart onto a phone.

While a record editor is open, keep its existing report/editor arrangement. The growth rail shows applied rates and an **Edit growth assumptions** action instead of editable competing controls. That action retains the record draft, closes its editor, and activates the growth transaction. It must not apply or discard either draft.

### 3.2 Mobile editing

On phones, show the same chart with geometry sized for the actual container. Labels and plotted height must remain legible rather than shrinking a 720px SVG into a letterboxed strip. During growth editing, a compact sticky impact ribbon shows the selected year, net worth, current signed delta when available, and the preview source/status. Place it where it cannot cover the active field or Apply controls. Users can inspect the full chart without losing their slider or exact input.

Preserve vertical page scrolling during touch scrubbing, keyboard access, 44px minimum control targets, increased text size, and narrow-screen Forecast/Edit navigation for existing complex editors.

## 4. Category defaults and asset precedence

Add an optional `GrowthAssumptions` object to `PlanDocument`:

```ts
interface GrowthAssumptions {
  readonly stocksBps?: BasisPoints;
  readonly propertyBps?: BasisPoints;
}
// PlanDocument.growthAssumptions?: GrowthAssumptions
// Account.growthSource?: 'stocks-default'
// Property.appreciationSource?: 'property-default'
```

An absent source marker means **Custom**. A present marker means **Default** and requires its corresponding category value to exist. An absent default is unconfigured; a present zero is a real zero-percent assumption. Decode blank optional defaults as omitted. Omit the whole defaults object when both categories are absent. Reject unsupported source values and stock inheritance on RSUs. Retain and validate the existing `annualGrowthBps` and `appreciationBps` even while inherited.

Use two pure effective-rate helpers, exported through the engine boundary:

```ts
accountGrowthRate(account: Account, assumptions?: GrowthAssumptions): BasisPoints;
propertyRate(property: Property, year: number, assumptions?: GrowthAssumptions): BasisPoints;
```

The account helper uses the stock default only for an explicitly marked non-RSU account. Property precedence is matching `appreciationOverrides` year → marked property default → stored `appreciationBps`. Call the account helper in ordinary monthly growth and when creating the brokerage funding ledger's inputs. Pass defaults to both property-growth calls, including the existing-home component of an ADU property. Do not mutate a derived plan's raw rates to make inheritance work.

This feature selects a modeling category explicitly. An account's tax wrapper does not prove its holdings are stocks. Cash reserves retain their existing behavior. RSU vesting, withholding, settlement, held/unvested distinctions, targets, and post-target growth remain unchanged.

## 5. Growth controls and reviewed setup

### 5.1 Rail

Show Stock accounts and Properties with their effective annual rates, category membership counts, precise percentage inputs, and companion sliders. Stock sliders span -10% to 20%; property sliders span -5% to 15%; both step by 0.1 percentage point. Exact entry retains two percentage decimals and the full validated range. A value outside the convenience range remains visible and unchanged; the range thumb must not silently replace it.

Unconfigured categories show **Set default**. Choosing Set default explicitly stages a proposal for that category: stock `7.70`, or a blank property rate awaiting entry. Viewing the rail, opening membership review, or obtaining the current draft does not create a financial draft or storage write. Never add a proposed stock default merely because the user edits property growth. Label proposed values before Apply. Show a clear zero-members message if a changed default affects no assets.

**Choose assets using defaults** expands a reviewed list with names, existing custom rates, membership checkboxes, and Select all / Clear selection actions per category. Existing inherited assets begin checked; existing custom assets begin unchecked. RSUs are shown separately as Custom or Scheduled and cannot be selected for inheritance. The list represents the final inheritance membership, so unchecking an inherited asset restores its retained custom rate in the preview.

Changes to category values and membership are one growth transaction. The user can configure only stocks, only properties, or both. Clearing a category while members still reference it is invalid and explains that those assets must first return to custom rates. Validate checked IDs as unique, present, and eligible; do not silently ignore removed or retyped assets.

### 5.2 Individual editing

Ordinary account and property editors offer **Category default / Custom**. Default mode shows the effective rate and its source; Custom reveals the retained raw asset rate and previews its effect. Switching modes is reversible in the raw draft. Never copy a category rate over the stored custom rate just to display it.

Property year overrides remain available in either base mode, with a compact count and the applicable selected-year rate. Accounts with dated RSU targets show **Scheduled**; unscheduled RSUs show **Custom**. Label their existing own rate as applying after the final target, or throughout when there are no targets. Converting an ordinary inherited account to RSU clears the active inheritance marker while retaining reversible values in mode memory. Existing linked-contribution restrictions still apply.

After category defaults are applied, newly created ordinary accounts or properties initially select their configured category default, visibly, with Custom available immediately. If the category is unconfigured, retain the application's existing raw zero-percent creation default and Custom mode. New RSUs always remain independent. No existing record opts in merely because its current numeric rate equals a default.

## 6. Draft, preview, scenario, and Apply contract

Extend `EditTarget` with `{kind: 'growth-assumptions'}` and add an independent `growthDraft` to the existing scenario-owned controller. The raw draft contains optional entered default values and the desired final inherited account/property ID lists. Do not represent it as a fake financial record or place it in `PlanDocument`.

Use the existing `prepareEdit` → worker calculation → registered receipt → `applyCalculatedEdit` path. Build one candidate from applied inputs, updating the defaults and source markers together, retaining every record's order, IDs, raw custom rates, overrides, and unrelated fields. Exclude all unfinished account/property/allocation drafts. A genuine change advances the revision once on Apply; opening, formatting-only changes, and changed-and-reversed edits do not.

Pin the growth draft's first base snapshot. It covers applied defaults and the IDs, eligibility, source markers, raw rates, and property annual overrides relevant to membership. If those facts change elsewhere, preserve the draft and report a stale conflict. An unrelated applied change, such as salary, instead rebuilds the candidate against the new base. Restores and inactive generations invalidate all old callbacks even when IDs and revisions are reused.

Only one preview coordinator owns the report. Activating the rail suspends any record preview; opening a record suspends growth preview. Both raw drafts survive. Growth Apply clears only growthDraft. A record draft whose source marker was changed by bulk Apply becomes stale under its existing owning-record snapshot checks; an unchanged record can rebase against a new category rate.

Keep pending, current, paused, stale, failed, applied, and local-persistence states distinct. While updating or invalid, retain explicitly identified previous/applied results and hide current numeric comparisons. Apply remains unavailable without the latest matching completion. The worker protocol still carries a complete validated plan and captured rules; no parallel approximation calculator is introduced.

Scenario switches retain raw growth drafts in memory but cancel visible preview ownership. Returning shows applied results until the user resumes or edits that growth draft. Forks and JSON exports include applied defaults and source markers only. Forks start without drafts; replacements/restores clear obsolete sessions. Persistence failures retain applied in-memory changes and the existing recovery/export controls. Include growth drafts in existing draft counts.

## 7. Chart model and interaction

Use actual annual `ProjectionResult.years` values. The chart receives the producing plan/report through `ReportSnapshot`; it never reads raw inputs to estimate net worth. A current preview gets a solid accent curve and a muted dashed applied curve on the same time axis and value scale. Without a current comparison, show one labeled producing curve and no numeric delta. Missing or unsupported amounts leave gaps and actionable explanations; zero and negative values remain plotable.

The prominent figure, exact readout, annual table selection, and impact ribbon use the same selected year. Fresh sessions select the final forecast year so the long-term consequence is immediately visible; existing retained selections and inherited fork preferences remain valid. Scrub with pointer hover/drag, touch, ArrowLeft/ArrowRight/Home/End, or a native year selector. Pointer scrubbing updates the crosshair/readout without rebuilding the paths or both plots. Preserve focused controls and table scroll during completed previews.

Provide 5Y, 10Y, 15Y, and All forecast windows starting at `plan.startYear`. Show only distinct available window lengths; All is always available. A five-year window means five year-end points, including startYear through startYear + 4. Clamp an out-of-window selected year to the nearest visible year. Keep horizon and Show applied plan preferences in the scenario's view session, outside backups.

Both curves always share one value domain that includes zero and all visible available values; include negative values when present. Toggling the comparison must not rescale the preview misleadingly. A selected year with no overlapping applied point says **No applied comparison**. Overflow or unavailable deltas must not become zero. Color is supplemented by line style and text.

Animate only completed, correctly owned chart states. Use a 180 ms path morph when point topology matches, otherwise a short crossfade of valid segments. Do not bridge missing-data gaps. Exact monetary figures update immediately to the completed result rather than counting through fabricated amounts. During pending work, controls move immediately while the old chart remains honestly labeled. Honor reduced motion and avoid recurring pulses or decorative motion.

## 8. Shared switches, precise inputs, and dates

Keep `mountNumericControl` and existing parsers as the numeric source of truth. Restyle slider tracks/thumbs and focus states consistently; do not replace integer basis-point/cents parsing with floating-point display math.

Add a native-checkbox-backed switch primitive with accessible names, visible keyboard focus, Space activation, explicit checked state, and at least a 44px hit area. Apply it to Show applied plan and existing genuine boolean controls. Known/unknown history selectors remain three-state. A switch animation must not imply that a hidden financial feature was deleted or applied.

Extract a shared native date/month control behind `renderField`. Preserve ISO `YYYY-MM-DD` / `YYYY-MM` values and visible format guidance. Allow native calendar selection and direct typing without converting date-only inputs through UTC/local timestamps. Emit committed-input flushes on change/blur without replacing the focused element or overwriting unfinished native input segments. Empty or invalid native values pause the preview and leave applied dates unchanged; do not invent a JavaScript representation of partial date segments the browser does not expose. Keep salary month/day anniversaries in the existing dedicated control. Preserve distinct purchase, origination, first-payment, construction completion, readiness, lease, and other linked/manual date values. Do not use one picker to collapse financially distinct dates.

## 9. Architecture and responsibility boundaries

| Unit | Responsibility |
| --- | --- |
| Plan types, validation, engine growth helpers | Additive stored inputs, explicit inheritance, rate validity, consistent effective rates. |
| Growth draft helpers and controller transaction | Raw decoding, membership validation, stale snapshot, candidate assembly, atomic preview/Apply. |
| Growth rail | Exact inputs, sliders, membership review, status, Apply/Discard, source summaries. No calculator or storage. |
| Account/property editors | Explicit individual source choices, retained custom fields, readable effective-rate summaries. |
| Growth chart model | Availability-safe annual points, comparison pairs, visible horizon, selected-year normalization. No DOM or projection calculation. |
| Persistent growth chart view | SVG geometry, pointer/keyboard selection, accurate readouts, transitions, resize and disposal. |
| Overview/editor host | Layout A, one active preview owner, routing, mobile impact, existing detailed reports. |
| Shared controls | Native switch/date behavior, semantic tokens, precise numeric styling, reduced motion. |

Avoid a framework migration, broad state.ts rewrite, or a second form/worker ownership system. Put focused helpers in new modules and extend existing interfaces where their responsibility already fits.

## 10. Acceptance and verification

1. Load an old plan and export it without editing: no default/source fields appear and results remain unchanged. Preview/apply explicit membership with stock 7.7%, independently configured property growth, a custom account, a property year override, and scheduled RSUs.
2. A one-year, no-deposit $10,000 inherited account at 7.7% closes at $10,770. Its stored 5% raw rate remains unchanged. An equivalent explicit-rate plan produces the same ordinary and brokerage-funded purchase/ADU results.
3. One growth Apply saves values and membership together, consumes one revision, reuses the completed projection, and excludes other drafts. Discard restores applied inputs; invalid or stale membership never partially applies.
4. Rapid dragging, switching scenarios/editors, reusing IDs during restore, and changing an applied growth owner reject obsolete workers and stale Apply actions. Unrelated applied changes rebase safely.
5. The primary chart/readout/table/ribbon agree exactly for the selected year. Comparison curves use the same domain, gaps stay gaps, and unavailable comparisons never display zero deltas.
6. Pointer, touch, native year selection, and keyboard controls work at 320px, 390px, 768px, 1180px, and 1440px. Check both themes, 200% text zoom, reduced motion, active-field stability, sticky ribbon clearance, and relevant advanced editors.
7. Date/month input round-trips stay unchanged in UTC and America/Los_Angeles, including leap days, end-of-month dates, salary anniversaries, purchase-boundary classification, and manually overridden linked dates.
8. Record a manual responsiveness observation on a synthetic 30-year salary/account/property/ADU plan: immediate controls, worker-based completion, honest Updating states, and no stale result publication. Avoid brittle timing assertions about full forecast speed.
9. Run `npm run check`, plus engine/browser tests in both UTC and America/Los_Angeles. Add a WebKit project for targeted date/control smoke coverage while retaining Chromium for the full acceptance suite; document any unavailable local browser check rather than claiming it passed.

Update README for inheritance, bulk review, chart-led navigation, preview ownership, and date controls. Preserve the prior UI design and plan as history. This design supplements their interface behavior while retaining their existing financial, tax, provenance, recovery, and compatibility contracts.
