# LifeLook retirement analysis

Date: 2026-11-01

Status: builder-reviewed design, awaiting user approval; not approved for implementation.

## Intent

Answer: **If we both retire in a particular year, what annual income would our assets provide after tax?** Compare possible retirement years, then inspect each retirement path through December 2100.

Retirement is a what-if analysis belonging to the active LifeLook scenario. The normal working-life forecast supplies its starting assets, liabilities, expenses and tax history. A retirement definition changes the retirement analysis; it does not replace the scenario's ordinary forecast with a retired household.

The feature should be easy to configure. The default uses the projected portfolio. Optional reallocation describes the desired retirement properties and puts remaining investment value into a visible stock portfolio. The engine handles sales, loan payoffs, conversions, purchases, transaction costs and taxes needed to reach that result.

## Decisions made with the user

- Add a **Retirement** destination.
- Retirement income consists of rental cash income and stock withdrawals, after modeled household taxes. Rental tax calculations include depreciation and applicable deductions.
- An editable annual stock withdrawal percentage is paid in monthly installments.
- Choose withdrawal source accounts automatically with tax consequences taken into account.
- Analyze each retirement path through **2100 inclusive**. Ignore inflation.
- Both household filers retire in the selected year.
- Start from assets, allocation and expenses projected for that year.
- Allow an optional retirement target portfolio with multiple homes and multiple independent rental properties; allocate the remainder to stocks with an editable growth rate.
- For existing properties, retain personal use, retain rental use, convert a personal-use home to a rental, or sell. A retained property's mortgages can optionally be paid off at retirement.
- For new properties, choose cash or mortgage financing. Enter the **down payment as a percentage**, not dollars.
- A new property's entered purchase price is **fixed across candidate retirement years**.
- Use clearly labeled, editable planning assumptions when financial/tax history is incomplete.
- Keep the visual language close to **Overview**. The graph is the main view; early/late retirement cards were rejected.
- Reallocation needs a roomy visual GUI. A narrow sidebar form was rejected. Show the destinations of assets at a glance, with separate property cards, dollars, shares and an automatic stock remainder.
- The user selected approach 1 below: retirement analysis within each existing scenario.

## Approaches considered

### 1. Retirement analysis within each scenario — selected

Use the ordinary forecast as the source for multiple candidate retirement dates. Apply a separate retirement definition, calculate the transitions and retired years, and publish a dedicated Retirement report. Existing LifeLook scenarios compare different retirement definitions and working-life assumptions.

This keeps exploration focused and supports the main graph directly. It requires a retirement runtime and reporting boundary rather than publishing a derived retirement plan into the ordinary projection slot.

### 2. Retirement as part of the main forecast

Applying a selected retirement date would change Overview and the other forecast surfaces as well. This makes one combined life plan, but choosing a date has broader effects throughout the app. The user preferred the separate analysis.

A scenario copy for every candidate retirement year was not presented as an option: it would work against the requested simple year comparison.

## Goals and limits

Deliver a useful first-year retirement-income comparison, an annual/monthly path through 2100, reconciled asset transitions, multiple independently configured properties, account-aware withdrawals, and saved/recoverable assumptions.

Keep the current local-browser TypeScript architecture, decimal money arithmetic, integer cents/basis points, source-versioned tax rules, explicit availability and scenario isolation. No framework migration or cloud account is needed.

This is deterministic scenario analysis. Monte Carlo success probabilities, inflation-adjusted display, Social Security benefit estimation, pension-specific taxation, death/survivor filing, inherited accounts, relocation and automatic future-law predictions are outside this project. Existing supported nonemployment recurring income can continue; do not invent new benefits.

Ordinary residential rentals and whole-property transactions are the initial tax scope. Do not claim support for exchanges, installment sales, cost segregation, complex grouped rental activities, partial ownership dispositions or other exceptional cases merely by applying an arbitrary tax percentage. Locate unsupported dependencies and retain independent results.

## Designer calls for review

These make the design concrete; they are proposals rather than previously agreed details:

1. Retirement starts on **January 1**. The first candidate uses the plan's opening state; later candidates use the preceding December closing checkpoint.
2. The annual gross stock target is the chosen percentage of that year's opening stock value **after any retirement transition**, recalculated each year and spread across 12 monthly withdrawals.
3. The main graph compares **first-full-year recurring after-tax income** across candidate retirement years. A separate graph/table shows calendar years after the selected retirement date through 2100.
4. Keep original dated nonemployment income, spending, child budgets and debt schedules unless retirement choices replace them. Add no CPI uplift or purchasing-power conversion. Existing explicitly configured growth rates and the scenario's tax-index policy retain their meaning and remain visible assumptions.
5. A surplus after living expenses stays in household cash; a shortfall is shown rather than automatically increasing the chosen withdrawal rate. Transition reallocation invests its remaining deployable cash in taxable stocks. Mandatory retirement distributions above the selected stock target are handled separately below.
6. Stop salaries, wage-classified other income, employment contributions and unvested service-dependent RSU vesting at retirement. Retain already vested shares and their basis. No severance, acceleration or ongoing employer grants are invented.
7. Through 2100, the household remains two living married-joint California residents. No mortality or inheritance process is inferred.

## Retirement years and report meaning

Candidate retirement years are the ordinary scenario's forecast years up to 2100. Do not silently extend the working-life forecast beyond its configured horizon or create a retirement start after 2100. A scenario with no overlap needs an explicit unavailable explanation. Selecting a candidate is view state, not a financial Apply.

Each candidate branches independently from the working-life source. Work before retirement is preserved, including accrued basis, previously purchased assets, mortgage amortization, rental loss/depreciation history and completed projects. Outcomes for an earlier retirement never become inputs to a later retirement candidate.

The default report has:

- Annual after-tax recurring income, and its monthly equivalent.
- Rental cash after vacancy, operating costs and full rental loan payments; taxable rental income is a separate calculation.
- Planned gross stock withdrawals, realized gains, returned basis, taxable retirement distributions, tax-free amounts and additional distribution taxes.
- Household living expenses and personal/nonrental debt payments separately, so rental debt service is not subtracted twice.
- Annual surplus/shortfall, cash, stock balances/basis, property value, property debt/equity and net worth.
- One-time transition costs, taxes, cash movements and funding shortfall in their own report.

Sale proceeds, borrowing, returned purchase deposits and transfers are not recurring retirement income. Unrealized growth is not spendable income. A property mortgage principal repayment is a cash/debt movement, not another loss of net worth in addition to the equity already calculated.

The retirement-year tax return includes all that year's supported gains, distributions, rentals and deductions. To avoid double charging, first solve the complete annual facts and cash schedules. Attribute tax using fixed-facts counterfactuals: (A) recurring income and planned withdrawals, with transition and mandatory-excess tax facts excluded; (B) A plus mandatory-excess tax facts; (C) the complete facts including transition tax facts. Recurring tax is A, mandatory-excess tax is the signed difference B−A, and transition tax is C−B. Those components must sum exactly to C. Charge each component to its own cash source once: recurring income, excess-distribution proceeds, or transition funding. Hold the accepted schedules and basis movements fixed during attribution; these are accounting counterfactuals, not separate tax returns or proposed legally sufficient RMD schedules. Replay-verify the decomposition jointly with the withdrawal/funding solve.

## Overview-style workspace

Use the existing shell/header/scenario picker, destination buttons, typography, surface colors, numeric controls, switches, accessible chart interaction and report-table conventions.

The upper workspace follows Overview: a primary mint-line graph on the left, a narrow assumptions rail on the right, then a selected-year totals strip. The rail holds stock withdrawal rate, applicable retirement growth assumptions, horizon information and a link to the portfolio GUI; it does not contain the entire allocation editor.

Main graph:

- X axis: **candidate retirement year**. Y axis: **annual after-tax income in the first full retirement year**.
- Hover/drag/tap, year selector and Arrow/Home/End inspection. Reuse the current chart's missing-value gaps, zero-inclusive scale, keyboard focus and reduced-motion conventions.
- Year windows and chart selection are per-scenario view preferences. Window labels describe candidate years rather than years already retired.
- A comparison toggle can overlay the projected-portfolio retirement result, using a dashed line on the same scale. This baseline also stops employment and applies the same withdrawal rule; it is not the working household's income from Overview.
- A selected candidate drives the totals, allocation view, transition details and selected row together.
- A second graph below the comparison shows the selected candidate's annual retirement income/balances through 2100, with a clearly distinct calendar-year axis. Do not mix the two meanings of year.

The visual allocation section spans the available width below the primary comparison, matching Overview's open layout. Include:

1. Active mode and selected retirement year; **Keep projected portfolio** is the initial effective mode for an unconfigured plan.
2. A value/cost/debt summary with explicit labels. Do not present net worth or tax-sheltered balances as immediately available purchase cash.
3. A segmented allocation graphic and textual legend. Shares use one stated asset-value denominator. Costs are outside the asset graphic; liabilities are shown separately. Show gross property value, debt and equity/cash commitment so financed properties are understandable. Projected mode also shows inherited cash and any other modeled assets/debts; do not silently label cash as stock or omit it from the stated denominator.
4. One card per property and one aggregate stock card, each with exact dollars and a share. Property cards show personal/rental use, existing/new status, mortgage balance or paid-off status, and rent/cost summary where applicable. Each rental has its own color/label; color alone cannot convey identity.
5. Select a card to open a roomy detail editor. Support adding/removing/reordering targets without losing another property's raw inputs. Removing a target is not selling an applied real-world property.
6. A visible stock remainder, plus the underlying brokerage/traditional/Roth breakdown in details. Aggregate presentation does not merge tax identities.
7. Existing-property decisions, transition costs and editable planning assumptions reachable from the same workspace.

At narrow widths, put the chart first and stack the assumptions and property cards. Keep readable chart axes by calculating responsive SVG geometry; a fixed desktop viewBox scaled to a phone is insufficient. Preserve scroll/focus while previews complete and keep horizontal scrolling inside report tables.

## Property choices and budgets

Existing-property choices reference stable source property IDs and only apply when the property is actually owned on the candidate date. A scheduled purchase that has not occurred is not sale proceeds or owned equity. Show its status rather than silently crediting its projected future value.

Default existing properties to their projected use with their current mortgages. An absent decision means keep; a target list omitting a source property must never silently sell it. Reallocation requires explicit sale instructions.

For each eligible existing property:

- Keep projected personal/rental use.
- Convert its personal-use portion to an ordinary rental at retirement, entering rent, recurring costs and conversion tax assumptions.
- Sell the whole property at its projected retirement-date value, with an editable sale-price override and selling-cost assumptions.
- Independently select payoff of one/all retained property loans. Use the outstanding retirement-date principal and any entered payoff fees; cease future payments on those loans. An already paid-off loan has zero payoff and is not charged again.

Preserve supported existing mixed-use/ADU allocations and distinct rental units when keeping them. A property remains one asset value, even if it contains several rental units. Changing use does not erase accumulated depreciation or other history. Advanced unsupported partial-disposition cases need a specific explanation.

Each new target property has stable ID, name, use, fixed nominal purchase price, acquisition costs, appreciation assumption, annual ownership/operating costs, and, for rentals, monthly rent, vacancy and rent-growth assumptions. Rental units remain independent. Buying several rentals is a first-class flow, not a single rental form copied into one shared record.

Financing is either:

- **Cash:** full purchase price and acquisition costs require funding.
- **Mortgage:** save `downPaymentBps`; derive cent-settled down payment and borrowed principal from the fixed price. Enter APR and term; use a normal amortizing loan schedule. Show derived payment and total cash needed. No underwriting approval is implied. Keep down-payment entry in percent everywhere, including restored drafts.

Cash financing is the simple initial choice. Proposed mortgage setup defaults are 20% down and 30 years, visibly editable; APR requires an entered value, including an explicit zero if intended. These are setup choices, not market-rate forecasts.

The purchase-price target stays fixed when a different retirement year is selected. An acquired property's appreciation after purchase is a separate assumption. Existing retained/sold property values follow their original appreciation path until retirement.

Existing property-linked expenses, rent, taxes, depreciation and debt schedules must stop or change when the lifecycle event requires it. Do not retain the sold home's linked insurance/tax budget and add the replacement's costs again. Unlinked household expenses remain unless explicitly overridden; do not guess their association from names. Do not manufacture replacement housing if no personal-use property is selected; expose that assumption in the expenses review.

## Rental and property-sale tax model

Continue separate federal, California, federal-AMT and California-AMT rental books. Preserve depreciation, suspended at-risk/passive losses, QBI loss vintages, activity identity, basis adjustments and loan tracing across the handoff. Combine all properties with the rest of the household before choosing legal deduction/tax candidates.

Conversions need historical gain basis and a distinct depreciation/loss basis. Use conversion-date FMV and adjusted basis with the applicable lesser-of basis rule for depreciation, excluding land; do not reset historical gain basis to FMV. Preserve the placed-in-service date and regular residential recovery convention. New rentals can use the existing editable 80% building/20% land planning split, qualified residential straight-line recovery, and explicit estimates for unanswered history. [IRS Publication 527](https://www.irs.gov/publications/p527)

Sales need gross proceeds, selling costs, mortgage settlement, adjusted tax basis and gain character as separate facts. Home-sale exclusion depends on ownership/use and prior-exclusion eligibility; a current personal-use label alone does not establish it. Preserve rental/nonqualified-use history and depreciation that cannot be excluded. Default missing exclusion eligibility to **no exclusion assumed**, with a conspicuous editable eligibility assumption and a way to supply actual history. Support the ordinary full-exclusion case; identify reduced-exclusion and unusual histories outside modeled scope. [IRS Publication 523](https://www.irs.gov/publications/p523), [FTB sale of a home](https://www.ftb.ca.gov/file/personal/income-types/income-from-the-sale-of-your-home.html)

Distinguish ordinary recapture where applicable, unrecaptured section 1250 gain, remaining section 1231/capital gain and loss rules. Mortgage principal does not reduce taxable gain. Apply federal gain-character worksheets and California treatment through the household tax engine, not a flat combined rate. Personal-use sale losses do not create an assumed deduction. [IRS Publication 544](https://www.irs.gov/publications/p544), [FTB capital gains](https://www.ftb.ca.gov/file/personal/income-types/capital-gains-and-losses.html)

Release suspended passive losses only where the modeled complete taxable disposition/activity conditions permit it. Retention, mortgage payoff and change of use alone do not release every loss. Default each new rental to its own activity; unknown existing grouping is an editable assumption. Cases involving an excluded home-sale gain plus rental loss releases need an explicit supported treatment or an affected-result explanation. [IRS Publication 925](https://www.irs.gov/publications/p925)

New tax rules and worksheets need versioned provenance, source-register entries and independent arithmetic fixtures. The existing tax packs remain the 2026 baseline with their existing provisional/projected labels; future rules through 2100 are scenarios, not predictions of law.

## Stock portfolio and distributions

Keep original account type, owner, balance, basis and access history even when the GUI shows one stock allocation. Do not turn a 401(k)/IRA into a brokerage cash pool. The new common retirement growth rate applies to the reallocated stock investments; projected mode retains original account growth unless explicitly overridden.

The annual planned gross distribution is `opening stock market value × withdrawalBps / 10000`, cent-settled. Use the post-transition opening balance for the first retired year. Split the annual target into 12 cent-reconciled installments; a monthly balance/eligibility cap may produce a reported shortfall. Apply monthly growth before month-end withdrawals, consistently with the existing engine's growth/deposit order. Rate zero remains valid; depletion never creates negative shares/balances.

Gross distribution is the chosen percentage, not a net spending promise. Deduct modeled tax/penalty from spendable income; do not silently sell extra shares each year to restore a desired net amount. Funding explicit transition costs is a separate gross-up solve.

Taxable brokerage sales consume aggregate proportional basis. Generalize basis tracking to every taxable account, including those never used for ADU/purchase funding. Preserve the app's established long-term proportional-sale planning assumption and its visible unknown-basis/no-loss-tax-benefit estimates; do not claim lot selection or short-term accuracy. Held employer shares need their own share/basis ledger and taxable diversification event if reallocated.

Traditional distributions use ordinary-income facts and applicable owner-level nondeductible basis/pro-rata treatment. Roth IRA ordering/qualification and designated Roth employer-plan proportional rules remain distinct. Retain five-year/conversion histories where relevant and avoid silently rolling accounts over. Support age-based early-distribution additional taxes and modeled explicit exceptions; retirement before 59½ is not automatically prohibited or tax-free. Federal/California basis differences need actual inputs or a labeled equal-basis estimate. [IRS Publication 590-B](https://www.irs.gov/publications/p590b), [IRS designated Roth rules](https://www.irs.gov/retirement-plans/retirement-plans-faqs-on-designated-roth-accounts), [FTB early distributions](https://www.ftb.ca.gov/file/personal/income-types/early-distributions.html)

Required distributions are owner/account/DOB-specific, use prior December balances and sourced tables, and satisfy the planned target first. Take the first required distribution within its calendar year; do not assume the optional April deferral. Amounts above the planned target are mandatory transfers: reserve their additional tax, reinvest remaining excess in taxable brokerage, and show them separately from the planned recurring income metric. No Roth-owner lifetime RMD is invented. Implement the age-75 rule for the relevant birth cohorts from authoritative regulations, not an age-73 summary hardcoded for all future years. [IRS final regulations](https://www.irs.gov/irb/2024-33_IRB), [IRS RMD guidance](https://www.irs.gov/retirement-plans/retirement-plan-and-ira-required-minimum-distributions-faqs)

An eligible distribution used to fund the transition counts toward that year's RMD requirement, but its spent proceeds do not also supply recurring income. The planned rate still applies to post-transition opening investments. Determine any remaining mandatory excess after counting eligible transition distributions and planned retirement-account draws once. Do not assume distributions drawn from a retirement account can be redeposited into it as ordinary unrestricted contributions.

### Proposed automatic source selection

“Optimal” must have a stated objective and a bounded claim. The proposed implementation compares a finite set of feasible source policies over the full modeled path through 2100: taxable-first, traditional-first, Roth-first, and a blended policy minimizing each year's modeled combined tax/penalty. Include mixed account draws and real legal/access/balance constraints in the annual evaluator. Required distributions are handled before discretionary ordering.

Choose the policy providing the greatest cumulative after-tax recurring income through 2100; break ties by greater remaining net assets, then fewer additional distribution taxes, then stable policy ID. All policies obey the same chosen gross-rate rule. Report the selected strategy and say **best of modeled strategies**, not globally optimal. The full-horizon comparison is proposed to match the user's preference for automatic optimal withdrawals and a 2100 horizon; its objective is a material designer call to review.

Each strategy's annual household-tax evaluation must include rental deductions, capital-gain stacking, AMT, NIIT and distribution-tax interactions. A sum of independent marginal account tax rates is insufficient. Replay the chosen schedule and transition together before publication. More sophisticated policy search, elective Roth-conversion ladders and mathematical proof of a lifetime optimum are outside the first implementation.

## Planning assumptions and required facts

Provide a simple **Planning assumptions** review with a count and per-amount provenance. Every estimate has a stable field/record ID, displayed value, explanation and editable override. Keep estimated facts separate from confirmed historical inputs; calculation-time resolution must not rewrite unknown answers into known facts.

Known entered facts always win. Proposed initial assumptions:

- Missing brokerage basis: existing conservative zero-basis estimate, visibly labeled.
- Missing property improvements/acquisition adjustments: zero entered adjustment, labeled as an estimate; original purchase facts and known tax books remain intact.
- New rental land/building split: existing editable 20%/80% planning convention.
- Unknown rental participation/QBI eligibility: no related benefit assumed.
- Unknown home-sale exclusion eligibility: no exclusion assumed until reviewed.
- Unknown federal/California differences: assume equal basis/books only where no known contrary data exist; label it.
- Selling-cost setup: editable 6% all-in modeling allowance. Buying-cost setup: editable 2% of purchase price. These are versioned planning presets, not legal requirements or market quotes. Advanced cash-cost/basis/deduction classification must keep nondeductible cash, capitalized costs and current deductions separate.
- Unknown special distribution exceptions: no exception assumed. Unknown recoverable Roth contribution/conversion basis: no invented tax-free basis.

Allow explicit per-property/account assumptions for the remaining supported gaps, including estimated prior rental depreciation from entered dates/basis where appropriate. Display unresolved advanced cases honestly.

Essential structural facts still need input: price/budget, selected use, mortgage terms when financing, owner, and age/date assumptions when an account's legal calculation depends on them. Do not invent a person's birth date. If needed, accept a clearly marked retirement-only age/date assumption. Invalid numerical text is a draft error rather than a planning estimate.

Uncertainty labels must reach the main comparison point/readout, not exist only in an advanced panel. A missing/unsupported value is not zero; an independent calculable candidate can remain visible without bridging unavailable graph segments. Lack of funding is distinct from missing tax data or a solver failure.

## Transition events and funding

Compile the reviewed configuration into immutable, dated transition events: sale, loan payoff, conversion/placed-in-service, purchase/origination, investment sale/distribution, reinvestment and tax reserve. Preserve gross assets, liabilities, cash and tax basis as different ledger dimensions.

At the retirement boundary:

1. Read the complete opening checkpoint before retirement-year growth, wages or transactions.
2. Resolve all source-property actions and their dependent rent/expense/debt lifecycle changes.
3. Calculate sales, retained-loan payoffs, conversions and target purchases at their fixed or projected values.
4. Solve required funding across eligible cash/investment accounts, including incremental transaction/distribution tax and fees. New mortgage proceeds fund the purchase once; never also count them as income or additional stock remainder.
5. Rebalance remaining eligible investments inside their wrappers, realize required taxable diversification gains, and invest residual deployable cash in the retirement taxable-stock destination. Do not liquidate every taxable stock holding just to give it a generic label.
6. Resolve the year's monthly planned withdrawals, mandatory distributions, recurring cash and household tax jointly; replay and verify the final result.

A sale settles property and associated debt once. A retained-mortgage payoff decreases cash and debt once. A purchase increases property value and debt as applicable and consumes down payment/cost cash once. Related loans and expenses cease at the correct event. Tax reserves cannot be charged again as ordinary expenses.

Seek a sufficient, verified cent-settled funding amount within actual monthly balances. Retain signed tax increments. Do not assume strict monotonicity across tax rounding/bracket interactions. Bound iterations and distinguish nonconvergence from a genuine funding shortfall. Reuse the existing propose → recompute annual household tax → replay/verify pattern, generalized beyond brokerage-only ADU funding.

If a target cannot be reached, show the amount missing, affected purchases/payoffs and any feasible independent values. Never create borrowing, a negative investment balance or an invented sale from a property not yet owned. Conditional paths must be clearly identified and must not masquerade as fully funded ranked income results.

### Scheduled purchases and ADUs after retirement — proposed handling

Keep-projected mode retains scheduled nonemployment commitments, including future purchases and ADUs, and shows them under a visible **Scheduled changes** review. Reallocation is an end-configuration: planned purchases/projects not yet started are excluded by default and listed explicitly for review rather than silently added after the target is reached. The user can choose to continue an identified commitment.

An in-progress project is never erased. Default it to continue with its existing committed costs and financing. Selling its host property requires an as-is valuation and settlement/cancellation assumptions for drawn debt and remaining commitments, or leaves that candidate unavailable. Do not replay completed projects or revive settled loans. This treatment is a material designer call for review.

## Engine architecture

Existing reporting rows are not sufficient opening state. Refactor the ordinary projection into reusable, pure year/month stepping with an explicit runtime context and checkpoint. Preserve the original validated plan and original date anchors. **Do not rebase `startYear`, reset tax books or cast an overlong document to `ValidatedPlan`.**

A resumable checkpoint includes decimal exact values serialized as strings where needed, cash/earmarks/funding-gap status, every account's balance/basis, RSU shares/price path/service state, property/ADU lifecycle and capital books, loan balances/payment provenance, all four rental books, QBI/IRA basis and minimum-tax-credit coverage. Cents reporting continues to settle at established boundaries.

Retain the existing 1–40-year saved-plan validation. Separately validate a retirement runtime calendar ending in 2100. Adapt ADU/loan helpers that currently assume the working-plan horizon, while preserving source dates and ordinary results. Generate working checkpoints once, then branch for each candidate. Omitted retirement inputs must preserve existing ordinary numeric results exactly.

Share money/date helpers, rule resolution, amortization, recurring schedules, rental depreciation/tax facts and legal annual household-tax selection. Add explicit distribution and property-disposal facts; do not encode them as negative contributions or ordinary recurring-income records. Unsupported historical household tax circumstances retain their own coverage boundary rather than being suppressed wholesale.

Suggested responsibility boundaries:

| Area | Responsibility |
| --- | --- |
| Retirement model/validation | Saved definition, references, assumptions and applicable calendar. |
| Forecast runtime/checkpoints | Immutable source state and shared month/year stepping. |
| Property transition module | Lifecycle events, sale/convert/payoff/purchase facts and basis books. |
| Distribution module | Access, basis, mandatory/planned draws and additional taxes. |
| Funding/strategy coordinator | Full tax evaluation, bounded policy comparison, replay and reconciliation. |
| Retirement result/report model | Candidate summaries, selected path, transition trace, availability/provenance. |
| Browser scheduler/editor | Scenario-owned raw drafts, worker authority and Apply/Discard. |
| Views | Overview-style charts/table plus visual multi-property allocation GUI. |

Exact module/file boundaries and safe refactor sequencing are left to the implementation plan. Avoid a broad unrelated state rewrite.

## Saved definition and scenario behavior

Proposed storage choice: an optional `PlanDocument.retirementAnalysis` definition, ignored by ordinary projection mathematics. Keep plan and workspace schema version 1 with additive validated fields so old backups load and omitted definitions round-trip without invented defaults. This makes plain scenario export/import, workspace backup, fork and replace carry the retirement definition with the same applied plan.

The definition includes mode, withdrawal rate, common reallocated stock growth, existing-property actions/payoff selections, independent new property targets/financing, retirement-specific assumptions and explicit scheduled-commitment choices. Store only inputs; derived down-payment dollars, projected values, selected strategy, results and candidate checkpoints are not financial backup data.

One applied retirement definition per existing scenario is sufficient; fork the scenario to compare alternative portfolios. Candidate year, inspected calendar year, chart windows, expanded cards and report scroll belong to per-scenario view state. Raw uncommitted retirement drafts survive switches within the tab and remain out of exports/forks/reload.

Use explicit **Apply retirement changes** / **Discard edits** with live preview and the same saved/not-saved recovery semantics as other editors. Viewing the tab or selecting a year does not persist a definition. Applying retirement inputs advances the financial revision and saves once; the ordinary report remains an accumulation report, recalculated/reused only through its established publication contract. Retirement results publish to a separate slot.

Validate source account/property/owner references. A removed or replaced source record must show a resolvable dependency, never silently redirect funding or reuse another record with the same label. Known source Apply changes refresh derived retirement results; drafts retain raw inputs and rebase or become stale according to ownership conflicts.

Use the ADU-comparison scheduler's authority pattern: immutable source-plan identity, source revision, rule identity/version, workspace/scenario/session/activation generations, retirement-definition/draft generation and request generation. A restore may reuse plan IDs and revision numbers; those alone cannot authorize a result. Cancel/discard stale workers and reject obsolete completions after switches, edits, restores and source removal.

## Responsiveness and calculation delivery

Keep all nontrivial forecasts off the browser UI thread. Publish comparison summaries in controlled batches with honest progress, retaining an explicitly labeled last completed result while work is pending. Do not publish a half-evaluated strategy as the best result. Cache by source inputs, definition and rule version; chart hover must not rerun an entire multi-decade calculation.

Send small candidate summaries first. Retain or request detailed monthly traces for the selected candidate, rather than transferring every trial policy's entire ledger for every retirement year. Bound caches and worker ownership. Financial overflow has a located unsupported result; it must not become an infinity/zero plotted point.

## Acceptance and verification

Use synthetic households and independent worksheets. Required coverage includes:

1. Old plans/backups have unchanged ordinary numeric results, no invented retirement defaults and no retirement configuration loss on scenario/workspace export, import, fork, replace or restore.
2. Every candidate uses its own pre-retirement checkpoint; first candidate uses opening state. Preserve exact growth anchors, all brokerage basis, four rental books, loans, ADU capital and previously completed events.
3. Both wages stop January 1; retained stock survives, unvested service-dependent awards stop, and nonemployment/child/debt dates remain coherent.
4. Multiple independent rentals, a personal home, a converted primary home, a retained mortgaged rental, an optional payoff, a sold property and new cash/mortgaged purchases can coexist without shared form state or duplicate cash/tax postings.
5. Down-payment percentages derive exact cash/principal. Fixed target prices remain fixed across candidate years; existing-property values and loan payoffs vary with the source forecast. Show financed asset value/debt/equity consistently.
6. Sale cost/basis/gain, residence exclusion, conversion lesser-of depreciation basis, depreciation-related gain, supported passive release and federal/California differences use independent tax fixtures and preserve unknown-versus-zero history.
7. Brokerage, traditional IRA/401(k), Roth IRA/designated Roth, qualification/basis, early penalties and DOB-specific RMD paths use sourced fixtures. Excess required draws are reinvested once, not treated as extra planned spending or unrestricted retirement contributions.
8. Annual percentage targets equal their monthly totals; zero rate, zero balance, depletion, age boundaries, tax rounding, insufficient transition funds and solver nonconvergence remain distinct and reconciled.
9. Strategy choice is reproducible across the full horizon, all policies use the same target, and the UI states the finite strategy objective. Transition-tax attribution plus recurring tax equals total household liability once.
10. Main chart points, readout, totals, portfolio graphic and table select the same candidate. The separate retirement-path graph ends at 2100 inclusive, and unavailable years have gaps.
11. Portfolio GUI supports several rentals with independent values/use/financing, visible dollars/shares, percent down payments, roomy editors and a correct stock remainder. Invalid raw input persists; no stale or estimated result is relabeled complete.
12. Scenario switches, applied source changes, rapid edits, restores with reused IDs and storage failure cannot publish stale retirement results or overwrite another scenario's data.
13. Check desktop/phone widths including 320px, light/dark, keyboard/touch, focus retention, reduced motion, 200% text and readable chart axes. Preserve Overview's existing behavior.

Run appropriate engine/browser tests, TypeScript/build and affected Playwright flows; run the full required repository checks before claiming implementation complete. Cover money/date behavior in UTC and America/Los_Angeles. Observe responsiveness on a synthetic 40-candidate analysis through 2100 without brittle wall-clock assertions.

Update README and the source register. The local brainstorming HTML remains a disposable visual reference; product implementation should reuse the app's components and real calculation contracts.

## Builder review focus

Before presenting this document for approval, check particularly:

- Whether the proposed full-horizon finite-strategy objective matches the delegated “optimal” requirement and can be bounded sensibly.
- Whether scheduled future commitments need a product decision beyond the explicit proposed defaults.
- Whether the definition location preserves plain-plan backups without compromising source isolation.
- Whether essential tax/basis/age inputs and estimates are sufficient to build the ordinary supported cases without invented legal conclusions.

Resolve already-answered and minor engineering questions in the document. Bring only material user-owned choices back in one review round, then update the design before requesting approval.

Builder-check outcome: a fresh independent software-engineer reviewer reported **“nothing important left”**. The remaining designer calls are stated above for the user's approval; no implementation plan or product code has been started.
