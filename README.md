# LifeLook

LifeLook is a local browser application that projects household cash, investment accounts, property equity and net worth for a California household filing jointly. Saved inputs, source versions and explicit assumptions determine the results. The calculation engine contains no browser, storage or clock access.

## Run locally

Use Node 22 and run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1421`. This package binds to localhost. For the production build and preview:

```sh
npm run build
npm run preview
```

Open the production preview at `http://127.0.0.1:4174`. The repository contains this browser application and its independent TypeScript calculation engine. The former desktop application has been removed from the current tree; its code remains in Git history. No server account, cloud connection or desktop packaging is required.

## Scenarios, editing and recovery

The **Scenario** selector starts with an editable **Master** baseline. **Fork scenario** creates a named, independent copy of the active scenario's applied inputs, including its financial record IDs and input revision. Later changes stay in the scenario where you Save them. **Manage scenarios** renames scenarios and deletes experiments; the baseline can be renamed and edited but cannot be deleted. Names accept 1–80 Unicode code points and must be unique without regard to capitalization.

Switch freely without a Save/Discard prompt. Each scenario retains invalid text, unsaved records, allocation drafts and their last valid preview, validation feedback, input section, forecast year and plot choices while the tab stays open. A fork starts clean and inherits the source's view selections. The forecast heading names the active scenario. **Draft edits not applied** describes unfinished inputs; **Unsaved locally** means applied changes have not reached storage. Unapplied edits stay here while this tab is open. Save to keep them after reload.

Household, Income, Expenses and Debts, Investments, and Properties contain labeled native controls. Each record has its own Save action; dated raises, appreciation overrides and related tax history are saved together. Boolean histories use **Unknown / Yes / No**. Other histories retain an explicit Unknown choice; required numeric blanks are errors. Confirmed zero and unknown remain distinct. Advanced property and rental histories start closed with status summaries; failed saves reveal the affected field. Mortgage opening balances can use a labeled schedule estimate or an entered known value.

A valid Save updates the in-memory input revision, recalculates, and attempts local persistence. Invalid drafts retain their text while the projection remains tied to the last saved input revision. Removing a referenced salary, account, property or loan requires resolving the references first.

In **Income**, the optional **Automatic salary raise cap ($)** limits the annual gross salary reached by automatic annual raises. Leave it blank for unlimited growth, or enter a ceiling at least as high as the initial annual gross salary. Dated percentage changes and annual salary overrides may exceed the cap; later automatic positive raises hold that higher salary without reducing it. Decreases still apply. Saved plans and JSON backups retain the cap.

Expenses use monthly budgets for this version. An entered annual expense is divided by twelve and spread over active months, including property and rental expenses. Cumulative cent rounding preserves the full-year annual total. Growth applies on January 1; start and end dates bound the active monthly budgets without daily proration. Saved annual amounts and frequencies retain their entered units, so existing plans and backups automatically use this budgeting model when recalculated. Detailed bill-payment schedules can be added later.

In **Expenses and debts**, open **Child planning** and choose **Add child**. Enter a name and **Birth month**, then use the child's Save, discard or remove action. Each child has an independent schedule: budgeting starts in the birth month and changes in each birthday month. By default, budgeting ends before the 18th birthday month. **Include full year at age 18** extends it through the month before the 19th birthday month.

| Age | Annual budget per child |
| --- | ---: |
| 0 | $9,000 |
| 1–2 | $8,000 |
| 3–5 | $8,500 |
| 6–8 | $10,000 |
| 9–11 | $11,000 |
| 12–14 | $12,000 |
| 15 | $12,500 |
| 16–18 | $16,000 |

This user-supplied modeled Oceanside budget stays fixed in today's dollars without inflation. **It excludes housing, medical costs, education (including college), and day care**, as well as lost income. Each annual amount is divided by twelve, with cumulative cent rounding preserving each full age-year total. The complete ages 0–17 schedule totals $194,000 per child; including age 18 totals $210,000. Child records do not establish tax-dependent status or model child tax credits. Saved plans and JSON backups retain the optional `children` records with `id`, `name`, `birthMonth` (`YYYY-MM`) and `includeAge18`; older plain-plan backups without children remain compatible with plan schema version 1.

Save validates effective shared and loan allocations and calculates the candidate projection before replacing saved state. A property draft includes its linked rental and expense records. If another Save changes one of those records, the older draft is retained and its Save is rejected. Use the record's **Discard edits** action, then reapply changes to the newer saved inputs. Unrelated drafts and saves remain independent.

Embedded plans retain JSON schema version 1. The browser stores the complete scenario envelope under `lifelook.foundation.workspace.v1`, including names, the baseline role and active selection. On first load, an existing `lifelook.foundation.plan.v1` plan becomes Master without changing its inputs or revision; its original legacy bytes remain intact. A valid workspace takes precedence over that legacy key. Missing data creates an unsaved Master in memory; unreadable or unsupported data stays protected for recovery.

**Backups and recovery** offers separate scopes:

| Action | Contents or effect |
| --- | --- |
| Export scenario JSON | The active scenario's applied plain plan; compatible with existing plan backups. |
| Export workspace backup | Every scenario's applied inputs, names, identities, baseline role and selection. |
| Import scenario JSON | A validated plain plan becomes a new named experiment; existing drafts stay intact. |
| Replace this scenario from JSON | After confirmation, replace only the named scenario's inputs and drafts. |
| Restore workspace backup | After confirmation, replace the entire collection and clear every scenario session. |

All exports exclude unfinished record/allocation drafts, view state, previews and calculated results. Reload and restore recalculate applied inputs using this package's rule set. Invalid JSON, unsupported versions, duplicate scenario metadata and invalid financial links leave existing inputs and drafts intact. Restored financial revisions remain unchanged; the workspace revision advances independently.

Storage belongs to the current origin: development on port 1421 and preview on port 4174 have separate workspaces. Use a workspace backup to move the whole collection between origins, or a scenario JSON to move one plan. A failed write retains accepted changes in memory and keeps a global warning visible across switches. **Export workspace backup** works without storage access; **Retry local save** writes the complete current collection without changing revisions. For protected unreadable data, download its original bytes and use **Replace unreadable saved data** with a validated workspace or plain-plan backup. A plain-plan recovery creates Master only. Failed recovery keeps the accepted workspace in memory and offers a separate replacement retry while preserving the original bytes.

An external workspace change detected through a storage event or pre-write check suspends writes. Export local changes as needed, then reload before further restores or writes. Concurrent multi-tab merging and race-free synchronization are outside this version; there is no automatic merge. Drafts survive switching only during this tab's lifetime and are never recovered from backups.

The former desktop application's SQLite profiles and `.lifelook` backups are not imported by this JSON format. Removing its source code does not delete existing device data or backups. Keep those files separately; enter a new plan or restore a compatible browser JSON backup.

Storage read/write and quota failures are visible. A failed write leaves the valid in-memory plan available as Unsaved and exportable; downloading its backup does not require a successful local-storage write. A valid restore that cannot persist likewise retains an exportable in-memory plan. Recovery warnings and export actions stay visible through edits, adds, discards and rejected Saves until a successful storage write resolves them. Ordinary editing does not announce a save; operation outcomes have a separate status announcement.

## Read the projection

Annual rows sum flows and use December balances. Show months expands individual settled movements; account, property and loan detail shows opening amounts, deposits/payments, growth and closing amounts. Tax explanation shows legal federal/California deduction comparisons, actual selected methods, assessed versus paid California tax, separate AMT/NIIT/surtax components, contribution limits, rental allocations and carried loss state.

Income-tax liabilities are reserved over months using positive gross cash-income weights, or equal monthly amounts when positive income is zero. Additional tax from selected ADU brokerage funding is reserved in the sale month. Employee payroll follows cumulative wages. Contributions are legally eligible planned deposits, including when cash is insufficient; prevented contributions stay in cash. Without a cash flow allocation policy, surplus remains in cash. Asset sales occur only for explicitly selected ADU construction funding; other borrowing and retirement withdrawals are not invented. Once a cash gap occurs, later balances remain conditional on funding it. Asset growth changes value without creating spendable cash.

An available zero is displayed as money. Missing or unsupported dependent amounts display **Needs data** or **Unsupported** without a numeric placeholder. Hover or keyboard focus shows a short preview; click, Enter/Space or tap opens full causes, affected periods and review actions. Escape or Close dismisses details. Repeated causes are grouped while retaining each field, record and earlier year. Independent income, loan, property or account schedules remain visible. Ratios use aggregate annual income; known zero-income ratios show **N/A · no income** while the underlying dollar amounts remain available.

Rule provenance and household coverage are separate. Verified, provisional and projected component labels identify the actual sources and assumptions. Modeled completeness, household tax completeness and funding status remain separate. Numeric deduction candidates are labeled as modeled inputs when household tax is incomplete. **How calculated**, **Forecast assumptions**, sources, tax calculation steps, comparisons, contributions and independent rental books are available in optional sections. A modeled contribution/growth scenario can remain available while distribution-dependent total household liability is incomplete. Material unmodeled income or credits, unknown relevant histories and monetary overflow prevent affected totals from being treated as complete.

For a qualified acquisition mortgage with complete proceeds history, scheduled opening balances and payments can support forecast mortgage deductions, taxes and cash flow. The loan editor and tax explanations retain the estimate notice; entering confirmed opening amounts refines the forecast. Missing qualification history or annual balance evidence still blocks the affected deductions.

The annual financial overview shows year-end net worth, total income including RSU compensation, cash income excluding retained stock, post-tax cash income, expenses and cash flow before investment contributions. Post-tax income credits RSU withholding against modeled taxes, and expenses include full mortgage and debt payments. Interactive plots show net worth and the income/expense comparison, with a year picker, keyboard navigation and series toggles. Missing amounts remain unavailable in the table and leave gaps in plots.

## Cash flow allocation

In **Investments**, use **Cash flow allocation** to set total account targets with an exact percentage or its slider. Every percentage uses the same year's cash flow after modeled taxes, expenses and debt payments, before investment transfers. Opening cash reserves, retained RSUs and asset growth are outside that budget. Eligible existing deposits count toward each account's target; their saved amounts and dates stay intact, and allocation funding fills only the remaining target.

New investment funding is spread across monthly installments rather than deposited at year end. Full-year funding uses the annual amount divided by twelve, with cumulative cent rounding that preserves the annual total: a $7,500 annual IRA target deposits $625 each month. Deposits enter at month end and grow from the following month. Excess funding adapts to monthly cash before changing feasible earlier target installments. Monthly cash availability, sponsoring wages and legal eligibility can require a different schedule; annual funding priorities and existing deposit dates remain protected. Traditional 401(k) contributions reduce modeled federal and California income tax, and allocations recalculate against the resulting cash flow. Roth contributions retain their after-tax treatment.

For supported retirement accounts, **Max out for the year** recalculates the legal dollar maximum and its share of cash flow for every forecast year. It uses the account owner, workplace sponsor, compensation, shared contribution limits and answered eligibility/history. The rule stays an annual maximum in saved inputs; the displayed percentage is calculated. Future limits retain their projected provenance. Earlier percentage targets and explicit **Cash / savings** earmarks can leave less cash for a maximum.

Choose **Excess allocation account** for the remainder after existing deposits, percentages/explicit cash and annual maximums. A workplace destination also needs **Excess sponsoring salary**. Excess may use an account that already has a target; both parts are combined into one deposit total. Cash saving earmarks the existing reserve. If the destination accepts only part of the excess, the remainder stays in cash; select **Allocation year** and open **Cash retained details** or **Allocation notes** for the year's amount and cause. Missing eligibility, contribution limits, compensation timing and unavailable cash can affect funding; unavailable results are labeled explicitly.

The pie and funding table show actual dollars and shares against the original annual cash flow, including existing deposits, top ups, accepted excess and retained cash. Changing **Allocation year** changes the view without saving a yearly override. **Apply allocation** validates, recalculates and saves the policy; **Discard allocation edits** returns to the applied rules. Invalid text remains editable and the last valid preview is marked stale. JSON backups contain only applied inputs, including annual maximum rules; they exclude unapplied edits, previews and calculated reports. Restore clears pending edits and recalculates the restored policy.

For the clean backdoor Roth route, select a Roth IRA allocation, enable **Use backdoor Roth**, and link a same-owner traditional IRA. **Add empty traditional IRA** can create the zero-balance source in the plan. Confirm the clean IRA history, then use **Max out for the year** or a percentage as usual. This models nondeductible deposits converted immediately each year, using the shared IRA contribution limit once. The asset table shows the cash deposit and conversion separately; the transfer does not debit cash again. The same route can be used for excess allocation.

This version requires zero existing traditional/SEP/SIMPLE IRA balances and known-zero traditional IRA basis, no outstanding rollovers, and no federal/California basis differences. Existing Roth IRA balances are supported. Existing traditional IRA balances, other traditional IRA funding, or unresolved history produce a data/unsupported explanation. Taxable pro-rata conversions and intervening earnings are outside this clean route. Only applied rules are included in backups.

## Employer RSUs

In **Investments**, add an account and choose **Employer RSUs**. An account represents one company and owner; use the same employer identity as the salary when applicable. Enter the current share price assumed on January 1 of the forecast start year and its effective annual growth. Add initial and refresher grants independently with their grant start dates, original total award values, original share prices, vesting terms and monthly, quarterly or annual frequency. The form shows awarded units, the final vesting date and years remaining at forecast start. An optional actual awarded-share quantity overrides value divided by award price; changing current price does not change units.

Optional **Share price target** rows let the growth assumption change over time. Enter each target date and price in chronological order. The price compounds smoothly from the opening price to the first target, then between successive targets, reaching each entered price on its date. The effective annual growth rate applies after the last target; with no targets it applies throughout the forecast. For example, a $95 opening price, a $170 target four years later, and 7.7% annual growth reaches $170 at four years and $183.09 one year afterward. All grants in the account use the same price path, including for vesting compensation and retained-share valuation. Target prices are assumptions, and saved plans and backups retain them.

Enter the percentage of each vest sold for tax withholding. Ordinary RSUs delivered at each vest add their projected fair-market value to federal/California wage income and employee payroll, sharing the owner's wage caps with salary and other grants. Retained shares become assets; unvested paper value stays separate from net worth. Sell-to-cover proceeds reduce retained shares and fund the modeled tax reserve once. The percentage is an entered withholding assumption, not the final tax rate. The projection still calculates assessed household taxes and any additional funding requirement; its reserve is a planning estimate, not an actual payroll-remittance or refund timetable.

Optional cliff months defer the first vest and catch up earned units at the cliff. Dates retain the original day, clamp in shorter months, and finish any partial final interval. For grants already vesting before the forecast, enter the actual net shares still held and their known or unknown opening basis. Earlier vesting is not taxed again or used to guess historical retained shares. Basis increases by the value of newly retained delivered shares. Unrealized price growth creates value without cash. Discretionary sales, sale fees and later capital gains remain outside this model; sell-to-cover assumes execution at the vesting valuation with no gain or fee.

Select deferred settlement only when delivery actually waits. The service vesting schedule remains visible, but dependent tax and cash totals are unsupported because income-tax and FICA timing may differ. The model does not assume all private-company taxes wait until an IPO. Options, 83(i) elections, 409A penalties and residency changes need additional tax modeling. See the [RSU design and official references](docs/superpowers/specs/2026-10-12-lifelook-rsu-accounts-design.md) and [source register](sources/register.md).

## Tax coverage and source updates

The baseline is 2026, with full-year California residency and married filing jointly. Covered inputs include wages, ordinary RSUs delivered at each vest, explicitly characterized ordinary taxable cash income, ordinary long-term residential rentals, employee payroll, workplace contributions, traditional/Roth IRA funding, personal acquisition mortgage deductions, and the modeled ordinary-tax, AMT, NIIT and rental-QBI paths. Qualification, owner limits, origin-year losses, federal/California basis and AMT books remain explicit. Existing or newly relevant minimum-tax-credit circumstances establish an unsupported future-credit boundary.

The model does not claim complete support for capital gains/qualified-dividend schedules, additional credits, advanced mortgage/basis cases or distribution planning. An ADU is part of its property's single asset value, with separate allocation and rental tax history.

Rental at-risk books assume no unentered activity-level owner capital injections or distributions. Qualifying principal paid from activity funds reduces capacity in all four books before losses are released. Insufficient rental cash after debt service leaves repayment funding unknown; household wages or cash gaps do not establish owner capital. Negative capacity requires unmodeled prior deducted-loss and recapture history. The [independent two-year principal worksheet](fixtures/tax/qualified-principal-carry.json) documents the carried amounts and subsequent loss limitation.

The initial review was 2026-10-12. Official 2026 tax tables were unavailable, so the packs explicitly use provisional 2025 table methods with 2026 marginal amounts. California's published bracket expression contains an inconsistent boundary; the pack records the chosen continuous-boundary assumption. Unpublished California 2026 AMT/limitation amounts use named provisional 2025 proxies. Future legally indexed amounts are forecast scenarios with recorded rounding, fixed provisions and enacted transitions; future SDI is an explicit administered-rate assumption.

See [the source register](sources/register.md) and [retrieval/hash manifest](sources/manifest.json). To update a source, retain the original edition and bytes, record the URL/retrieval date/hash, review applicable-year differences, update field-level rules and assumptions, and independently recheck the affected fixture worksheets. Bump the affected pack and global rule versions when a rule or named assumption changes. Do not manufacture expected fixture values from production calculators or silently relabel provisional values as verified.

## Planning a future home purchase

In **Properties**, enter the future **Purchase date**, purchase price and down payment. The form shows **Property market value at purchase** and initially matches the price; a separately entered valuation stays unchanged. Choose household cash or a saved taxable brokerage under **Pay down payment from**. Brokerage funding uses proportional long-term holdings and aggregate cost basis, including the additional tax on sales. ADU builds and home purchases share one chronological account ledger.

**Add loan** calculates the mortgage principal as price minus down payment and shows APR, term and the first payment date. The down payment plus purchase mortgages must equal the price. Before closing, the home and mortgage have zero value and balance. At closing, the property value and mortgage principal enter once, and the down payment leaves its selected source once. Appreciation and regular mortgage interest begin the next month; the first payment defaults to that month's final day. Closing costs and prepaid closing interest need separate inputs.

Future rentals and property expenses default to the purchase date. Rental receipts and depreciation respect their separate lease and readiness dates. **Planning estimates** supplies ordinary purchase-loan and rental assumptions without confirming saved unknown answers. The editable building share initially uses 80% of price and excludes the remaining land from depreciation. New rental books assume zero prior losses and depreciation, with household support for monthly operating deficits; tax benefits requiring unconfirmed participation or QBI status are not claimed. **Detailed tax inputs** retains explicit history requirements. These assumptions follow the existing [residential rental](https://www.irs.gov/publications/p527), [basis](https://www.irs.gov/publications/p551) and [mortgage deduction](https://www.irs.gov/publications/p936) methods.

The forecast shows purchase value additions separately from appreciation and shows investment sales, sale taxes, payments covered and funding shortfalls. Insufficient source funds leave a numeric, conditional funding gap. Where automatic deposits and a purchase withdrawal cannot settle consistently, the disclosed deposit-timing estimate holds new savings in cash until the final sale month. Historical opening assets and past down payments keep their existing behavior. Future refinances, property sales and ADU construction on a future purchase need separate support. Purchase estimates use `property-purchase-planning.1` under calculation version `us-ca-2026.5`.

## Building an ADU on an existing home

In **Properties**, **Build an ADU** opens a short setup for living area, total build cost, completion date, monthly rent, assumed added home value and cash or loan funding. A loan adds amount, APR and term fields. A new simple project pays its construction cost at completion and starts rent the following month; changing completion updates those generated dates. **Advanced ADU details** contains custom timing, staged payments, financing draws, allocations and tax assumptions. Existing projects with detailed schedules show totals without replacing their schedules. Existing home and mortgage inputs are under **Existing home details**.

Use **Use current home value per sq ft** in the simple setup to copy the original home's value divided by its living area as an explicit valuation assumption. The form shows that rounded rate and multiplies it by ADU area to estimate total added value. Original-home living area is requested there when needed; construction cost and tax basis remain independent.

Use **Pay construction cash from** to select household cash or a saved taxable brokerage. A selected brokerage covers construction not funded by attributed loan proceeds and the additional tax caused by selling investments. **Edit account cost basis** opens its investment editor while retaining the ADU draft. Enter the account's total cost basis at forecast start; later contributions add basis, while unrealized growth does not. Unknown basis uses a labeled zero-basis estimate without changing the saved answer. Sales assume proportional long-term holdings; realized losses are reported without tax deductions, offsets or carryforward benefits.

The forecast solves for investments sold after federal long-term capital-gain rates, California income tax, NIIT and applicable modeled household tax interactions, including tax on the additional investments sold to cover tax. Proceeds are asset-to-cash transfers, not recurring income. Construction and tax are counted once, and future account growth uses the reduced balance. The funding summary shows gross sales, gain/loss, additional tax, construction covered and shortfall; account details show remaining basis and balances. Sales cannot exceed available funds before month-end deposits. A selected-account shortfall remains conditional even if other household cash exists. Separate ADUs sharing an account use one chronological ledger.

If automatic savings into the funding account cannot settle consistently with construction withdrawals, the forecast uses a disclosed timing estimate: new automatic deposits resume at month-end after that year's final construction sale. Earlier savings remain in household cash for uncovered costs. Existing contribution schedules keep their dates, and all sales, taxes and balances must still reconcile exactly. A funding shortfall stays numeric and conditional rather than requiring more tax inputs.

Simple setup uses labeled planning tax estimates for unanswered inputs: an ordinary long-term rental, eligible building cost recovered over 27.5 years, no assumed QBI or active-participation tax benefit, and an editable 1.2% incremental property-tax planning rate. Construction cost is an assessment proxy, not an assessor's valuation. Estimated property-tax payments begin the month after completion, are prorated in that year, and use the entered assessment-growth assumption afterward. The estimate assumes original-home bills exclude these added payments. Known detailed answers and payment schedules take priority. Before completion, the estimate retains the original home value without adding a market value for unfinished construction. These are estimates, not confirmed tax facts; **ADU tax calculation** in **Advanced ADU details** can instead require detailed inputs.

Use **Save property** to apply the complete bundle. Saved unknown tax answers remain unknown; planning assumptions are derived for calculation and labeled in the forecast and its sources. **Remove ADU project** edits that bundle; **Discard edits** restores the applied project. The original home, mortgage and original expenses remain. Scenario switching retains unfinished text; exports and reloads use applied inputs only, on the existing origin-specific storage described above.

Keep four quantities separate: staged construction cash, added completion market value, confirmed building recovery basis in each tax book, and incremental assessed value. Costs do not automatically establish value or confirmed basis. An area-based value assumption multiplies ADU living area by the entered added-value rate; the whole-property rate includes the original home and land and is copied only when requested with either value-copy button. A direct added-value assumption is also available. These are planning assumptions, not appraisals. Original-home value grows independently during construction. Detailed tax mode leaves full property value, equity and net worth unavailable for unvalued work in progress; simple estimates retain the known original-home value. Completion adds value once after that month's growth and starts earning appreciation the following month.

Construction completion, readiness for rent and lease-income start are separate dates. Readiness activates confirmed building basis under cumulative 330-month, mid-month depreciation. New rentals begin with explicitly zero prior histories; construction-period deductions and origin-year losses carry into later years without being reset at readiness. Federal, California and their AMT books remain independent. Qualification, paid-amount splits, proceeds tracing, amount-at-risk borrowing and owner support of monthly operating deficits including principal must be answered where relevant. Missing answers block dependent amounts; suspended losses are shown separately from allowed deductions. Existing rental repayment-funding rules remain unchanged; the new project adds its explicit owner capital, qualified borrowing and confirmed operating support once.

Dedicated financing draws arrive at the beginning of the month and remain restricted to attributed, unpaid stages. Interest is paid monthly before fixed amortization begins; the full contractual term and final principal settlement remain intact when the forecast horizon changes. Loan receipts are not income. Total reserve includes draws, while unrestricted cash excludes remaining construction earmarks. Peak household funding need comes from the lowest unrestricted cash balance. Investment allocation uses before-investment cash flow plus financed construction actually paid, preserving the earned-income pool without investing future-stage proceeds. Earlier cash gaps constrain later deposits; opening savings do not enlarge earned-income allocation targets.

Assessed-value planning uses entered added/progress assessments, the marginal tax rate, enrollment year, separate charges and supported assessment growth. Planned regular, supplemental and construction-progress payments are distinct cash records. Copying an estimated regular payment creates an editable row with unknown tax treatments; it does not infer a supplemental bill or confirm that year's paid schedule. Confirm each relevant year as complete, including a known-zero answer, and confirm original property-tax bills exclude the incremental payments.

The applied **ADU build versus no build** comparison removes only the selected project and its owned records. Both complete forecasts independently resolve the same saved allocation policy and carried taxes. Reports use the forecast's selected year, annual flow sums and December balances. Household tax changes appear beside contribution changes because the allocation policy can change deductions. Funding needs include any preexisting household gap in each forecast.

Owner cash commitment is the negative sum of incremental before-investment cash flow plus selected loan draws through the completion month. It includes precompletion interest, principal, paid tax and modeled household tax changes once. Cash recovery begins the following month using incremental cash flow alone, excluding loan receipts and unrealized equity. Cash-on-cash return uses that calendar year's postcompletion cash flow divided by positive commitment; partial years are labelled and not annualized. Payback can be not reached within the forecast, undefined for nonpositive commitment, or unavailable when required cash or completion is outside the horizon. Value and cash returns stay separate.

This lifecycle supports ordinary qualified residential ADU projects on existing primary homes, confirmed treatments and the stated dedicated fixed-rate funding contract. ADU builds on future purchases, refinance/reimbursement, unused or overlapping financing, sales, personal use, interrupted production, loan fees/points without separate recovery, later improvements without separate schedules, recapture and advanced basis cases remain outside this ADU lifecycle. Tax packs retain the provisional/projected limitations above; the ADU planning method is `adu-construction.1` under calculation version `us-ca-2026.5`.

See the [ADU design](docs/superpowers/specs/2026-10-13-lifelook-adu-build-design.md), [independent value/loan/return worksheets](fixtures/math/adu-build.json), [mid-month depreciation worksheets](fixtures/tax/adu-depreciation.json), and [construction/loss carry worksheet](fixtures/tax/adu-loss-carry.json).

## Verify

```sh
npm run typecheck
npm run test:engine
npm run test:browser
npm exec playwright -- install chromium
npm run test:e2e
npm run check
```

Playwright starts the built localhost preview on 4174 and uses fresh browser contexts. Its [web-server configuration](https://playwright.dev/docs/test-webserver) builds before standalone acceptance runs. Linux CI installs Chromium system dependencies with `playwright install --with-deps chromium`. If a custom browser cache is used, set `PLAYWRIGHT_BROWSERS_PATH` consistently for installation and execution.

Engine reference fixtures use synthetic inputs and independent primary-source worksheets. The full engine suite is checked in UTC and America/Los_Angeles. The [CI workflow](.github/workflows/ci.yml) runs the locked application's typecheck, engine/browser tests, build and Playwright flows in both timezones.

The lockfile uses the compatible security patch releases [Vite 6.4.4](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) and [Vitest 4.1.11](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). These patches apply to this package's development tools.

## Design records

The [foundation design](docs/superpowers/specs/2026-10-11-lifelook-foundation-rebuild-design.md) and [implementation plan](docs/superpowers/plans/2026-10-11-lifelook-foundation-rebuild.md) are retained as historical records of the rebuild. Their `foundation/` package paths and separate legacy integration boundary describe the implementation phase before this application was promoted to the repository root. Use the commands and paths in this README for the current application.
