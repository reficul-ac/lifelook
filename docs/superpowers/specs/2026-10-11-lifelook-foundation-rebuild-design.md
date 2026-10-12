# LifeLook foundation rebuild

Date: 2026-10-11

Status: Conversational design approved; written spec awaiting user review.

## 1. Purpose and success criteria

Rebuild LifeLook around understandable, accurate financial calculations, then add a plain browser interface. The intended first user is a California household filing married jointly. The app must make entering financial assumptions easy and explain how those assumptions produce cash flow, investment balances, property equity, and net worth over time.

The user explicitly prioritizes tax accuracy, investment growth accuracy, and mathematical accuracy over visual design. The foundation must support the actual requested household model, while keeping unrelated product features outside this rebuild.

Success means:

- Multiple salaries and other income can be entered with annual growth and several dated changes.
- Expenses, debts, investment contributions, property costs, and rental income participate in one consistent forecast.
- Federal and California deductions are calculated separately, with standard versus itemized treatment selected automatically.
- Primary homes, whole-property rentals, and a primary home with an ADU rental are represented without double-counting assets, debts, or expenses.
- Account types determine contribution eligibility and income-tax effects.
- A yearly table, expandable to monthly detail, explains the financial results and any funding gap.
- Independent reference calculations and primary-source tax fixtures establish accuracy before the interface is built.

This spec sets the rebuild direction in place of the broader first-release vision in `PLAN.md`. Existing code and history remain reference material until the replacement is verified.

## 2. Confirmed scope, assumptions, and exclusions

### Confirmed with the user

| Area | First-version requirement |
| --- | --- |
| Platform | Fresh browser app using plain HTML forms and a separate TypeScript calculation engine |
| Household taxes | Gross income; US federal, California, and employee payroll taxes; married filing jointly |
| Income growth | Annual raises plus multiple dated percentage raises or replacement salary amounts |
| Investments | Account totals; fixed monthly contributions or a percentage of a selected salary |
| Account tax treatment | Taxable accounts, traditional and Roth 401(k)s, traditional and Roth IRAs |
| Deductions | Automatic housing/tax deductions and standard-versus-itemized comparison for both jurisdictions |
| Property | Purchase details, linked mortgages, current values, and independent annual appreciation assumptions |
| Rentals | Long-term whole-property rentals and an exclusively rented ADU alongside the primary home |
| Reporting | Monthly calculations, yearly summaries, traceable tax and balance breakdowns |
| Persistence | One locally saved plan with a downloadable backup |
| Later work | Withdrawals and retirement planning are explicitly deferred |

### Assumptions made explicit for written review

- USD only; two adult tax filers who are full-year California residents.
- Direct household ownership of the modeled properties and accounts. No partnership or corporate tax returns.
- Forecasts begin January 1 of a chosen year. Starting balances and values are assumptions as of that date; they are not automatically reconstructed historical balances.
- Properties already exist at the forecast start, and included rental units are already available for rent at that date. Enter their acquisition and rental history. A future lease-income start can be entered for an already available unit. Future property purchase, conversion to rental availability, sale, construction, and refinance events are outside this version.
- ADUs and whole-property rentals use ordinary long-term, fair-market leases without personal use of the rental unit or substantial tenant services.
- The first tax coverage is wages, ordinary taxable/non-taxable other income, the specified retirement contributions, and the specified housing/rental activities. Additional household income types or tax credits need an explicit coverage decision before they can be presented as included.

### Outside the first version

Withdrawals, retirement optimization, Roth conversions/backdoor workflows, inherited accounts, securities trading, transaction ledgers, CSV transaction import, bank sync, cloud accounts, multiple saved scenarios, short-term rentals, vacation-home day sharing, ADU construction planning, property sales, charitable/medical deductions, other states, other filing statuses, and desktop packaging are deferred.

Unsupported tax circumstances are identified by the coverage validator. They are not silently treated as zero deductions or zero tax. Adding a newly required circumstance is a scope change with its own verified calculation contract.

## 3. Architecture and component boundaries

Keep the calculation engine independent of browser APIs, persistence, presentation, and the existing Tauri repository. Inputs and results are typed, immutable values. The same saved plan and rule versions must produce the same result.

| Component | Responsibility | Inputs and outputs |
| --- | --- | --- |
| Plan validation | Validate amounts, dates, references, supported tax profiles, and required history | Raw plan to validated plan or actionable issues |
| Income and contribution model | Resolve dated salaries, ordinary income, expense growth, requested contributions, payroll deferrals, and final contribution records | Plan/year and tax-resolved IRA eligibility to monthly streams and annual contribution records |
| Property and loan model | Amortization, appreciation, expense allocation, and rental building depreciation | Property/loan/unit records to monthly balances and annual tax facts |
| Household tax model | Rental loss treatment, federal/CA deductions, applicable tax components, and deduction-method comparison | Annual facts, opening tax state, and rule packs to tax result and closing tax state |
| Projection coordinator | Apply annual tax results to monthly cash flow; reconcile accounts, properties, liabilities, and net worth | Validated plan to monthly and annual projection results |
| Browser storage | Save, load, export, and restore a versioned plan | Plan documents; no financial formulas |
| Plain browser views | Edit inputs and display calculations, issues, and save status | Validated/draft inputs and projection results |

Use focused modules for these responsibilities. Avoid a generic scenario-event framework or a large application file combining formulas, forms, tax rules, and storage.

The engine boundary is `calculateProjection(plan, ruleSet)`. Its output contains monthly rows, annual rows, tax explanations, contribution records, rental loss state, rule provenance, and issues. It never reads the clock or mutates its inputs.

Withdrawal-specific interfaces and calculators are not implemented now. Account types, ownership, separate opening balances/contributions/growth, and versioned documents provide the extension boundary for later work.

## 4. Data model

### Plan and household

Store a schema version, plan ID, two filer IDs, start year, horizon in years, opening cash reserve, and tax-rule policy. The default horizon is 30 years, adjustable from 1 through 40. A new plan defaults to the next calendar year; the user can choose another supported forecast year.

Each filer has an ID, name, birth date, and workplace retirement coverage. Coverage is explicit: owning an old 401(k) does not establish current workplace coverage. Relevant annual coverage and employer wage assumptions can override the baseline when contribution eligibility requires them.

### Income and expenses

Salary records include owner, employer/source identity, annual gross salary, effective start/end dates, default annual raise percentage, yearly raise month/day, and a list of dated changes. A change either increases the current salary by a percentage or sets a new annual salary. Setting a salary to zero or ending its date range stops that stream.

Ordinary other income has a name, amount, frequency, date range, annual growth, and explicit wage/ordinary-taxable/non-taxable classification. Every wage-classified record requires an owner and employer/source identity for payroll and contribution rules. Unsupported income classifications cannot be coerced into wages. Rental income is generated from rental records, rather than entered again as ordinary income.

Expenses have a name, amount, monthly or annual frequency, date range, and annual growth. Property-linked expenses also carry their personal/rental/shared allocation and tax category. Linked property costs appear in household totals once.

### Investment accounts and contributions

An account stores an ID, name, owner, type, opening balance, and effective annual value-growth assumption. Supported types are taxable brokerage, traditional 401(k), Roth 401(k), traditional IRA, and Roth IRA.

A contribution rule specifies its account, date range, and either fixed monthly dollars or a percentage of a selected gross salary. Payroll 401(k) contributions reference the sponsoring salary/employer. A fixed amount is due at month end when that date is within the rule's range. A salary percentage applies to salary earned within the rule's active dates and is settled at that month's end. A rule has a stable priority used when several rules share an owner's legal limit; that order is visible and editable.

Store requested and eligible planned contributions separately. Within each owner/year, apply the applicable combined plan/IRA limits, compensation rules, catch-up conditions, and IRA income eligibility. Amounts prevented by a limit remain in the cash forecast and produce an explanation; they are not redirected to another account.

Traditional IRA funding and deductible IRA funding are separate amounts. Nondeductible contributions create identifiable basis. Unknown opening tax basis remains unknown. The app does not infer previous contribution basis from an account balance or require conversion/withdrawal histories for growth-only accounts.

Brokerage value growth is explicitly assumed unrealized. Ordinary cash interest/dividends are entered separately as other income, and the value-growth assumption excludes those cash payouts. Qualified dividends, realized sales, or a different account-return tax model require additional coverage; they must not be silently included in an untaxed total-return assumption. Retirement-account internal growth is kept separate from annual contribution tax effects.

### Properties, loans, and rental units

A property stores its role, purchase date, purchase price, down payment, opening market value, baseline annual appreciation, and optional calendar-year appreciation overrides. A primary home with an ADU has one combined property market value. The rental building's tax basis is not a second market-value asset.

Standalone debt records include an ID, name, opening balance, fixed APR, fixed monthly payment, and first scheduled payment month. A property link is optional. Settle interest and the scheduled payment at month end; use the same monthly convention and payoff cap as property loans. The declared monthly APR convention is a forecast assumption, rather than a reconstruction of daily credit-card interest or variable-rate contract terms.

Each linked fixed-rate loan additionally records original principal, origination/acquisition dates, term, first-payment date, collateral, and use of proceeds. Purchase price minus down payment initializes original principal for an ordinary purchase loan. Loan terms determine its payment schedule and initialize its monthly payment.

An existing loan can use a known balance and payment as of the forecast start, rather than relying on the historical scheduled estimate. Estimated values are labeled. The loan appears once in the household liability totals. Escrow is not included in the principal-and-interest payment; property tax and insurance payments are separate expenses.

A rental unit identifies its parent property, expected rent receipts, rent growth, rent-income start/end dates, ready-and-available-for-rent date, direct expenses, shared-cost allocation, active-participation status, adjusted building basis excluding land, depreciation history, and opening federal/CA passive-loss state. Lease income can start after the unit is available; its depreciation follows availability rather than tenant arrival. AMT-specific history is required where it differs.

For an ADU, default shared allocation is ADU living area divided by total primary-home-plus-ADU living area. Direct costs are assigned wholly to their relevant use. Explicit expense/loan allocations override the default when appropriate. Collateral and proceeds use must justify interest allocations; floor area alone cannot establish every loan's rental deduction.

Existing rental tax history must be supplied or explicitly confirmed as known zero. Market value, appreciation, down payment, and outstanding mortgage balance do not establish depreciable building basis.

## 5. Calculation conventions

### Time and income

Calculate complete calendar years, with monthly results underneath. All dates are ISO calendar dates; calculations must not depend on host timezone or daylight-saving transitions. Start/end ranges are inclusive. Specific income changes take effect on their entered dates. Divide a month's annual-salary/12 amount among its effective salary periods using actual calendar days; a change applies from the start of its date. Prorate expected monthly rent receipts by their active calendar days using the same convention.

The first automatic raise is on the selected annual raise date strictly after the salary's effective start. A dated change on that date replaces the automatic raise. Later automatic raises use the latest salary. Two explicit changes for the same income/date are a validation error; row order does not decide the result.

Default ordinary-income, expense, and rent growth is a discrete January 1 increase strictly after that stream's start date. Monthly/annual ordinary income and expense payments recur from their entered start month/day; an absent day clamps to the month's final day. An annual February 29 raise/payment occurs February 28 in a non-leap year. Expenses are scheduled payments rather than automatically prorated wages. These timing assumptions appear with the relevant input.

Annual/monthly amount conversion and date proration use decimal precision before cash-flow settlement. For each stream, a month's settled cents equal its rounded cumulative unrounded amount through that month minus the cents already settled in that calendar year. Reset the cumulative settlement counter at January 1. This deterministic remainder allocation distributes an unchanged annual salary exactly to its entered annual cents while preserving the rounded total of dated changes.

### Growth and loan interest

For an effective annual investment or property return `r`, use monthly growth `(1 + r)^(1/12) - 1`. Property overrides select that calendar year's rate. Contribution deposits occur at month end and first participate in growth the following month.

Store financial inputs and settled cash movements as integer cents; use decimal arithmetic with at least 34 significant digits for intermediate growth/proration. Settle cents with nearest-cent rounding, ties away from zero. Apply official tax-form whole-dollar/table rounding separately where required. Preserve fractional growth precision internally. Report monthly growth as the reconciled change in reported balances after contributions, so monthly reporting and annual ending balances agree exactly.

User-entered rates have 0.01 percentage-point precision. Allow zero and negative growth greater than -100%; loan APR must be nonnegative. Rates above 1,000% are outside the supported input range. Every stored or reported monetary amount must be a safe integer with absolute value at most `99_999_999_999_999` cents; validate aggregate/projected amounts as well as individual inputs. Reject invalid rates, non-finite results, and overflow instead of displaying wrapped or approximate totals. A $10,000 opening balance at a 7% effective annual return with no contributions must report $10,700 after 12 months.

Loan APR is a nominal annual rate: monthly interest is opening principal times APR/12, settled to cents. Split payments into interest and principal, cap the final payment at principal plus interest, and stop payments after payoff. A below-interest payment grows the debt and raises an explicit issue. Home appreciation does not change mortgage principal.

### Annual tax and monthly cash flow

Process years chronologically to carry rental tax state forward. The dependency order is:

1. Resolve gross income, requested contributions, loan schedules, property costs, depreciation, and expense allocations.
2. Resolve payroll 401(k) deferrals and compensation limits.
3. Apply rental at-risk/passive-loss limitations using the prescribed modified-income definitions, including required IRA-deduction addbacks.
4. Resolve IRA modified income, contribution eligibility, deductible versus nondeductible amounts, and aggregate annual limits. Do not use final taxable income as a substitute for these modified-income definitions.
5. Assess final federal/California income and employee payroll taxes from those facts, then produce monthly cash and balance results.

IRA eligibility is a tax-dependent contribution result. The coordinator must not finalize IRA deposits before the rental/modified-income calculations that determine their eligibility.

Annual income taxes are planning liabilities allocated to monthly tax reserves in proportion to positive household gross cash income; use equal months if that year's liability has no positive cash-income weights. Use cumulative weighted allocation and the same settlement remainder rule so the monthly reserves sum exactly to annual liability. Employee payroll taxes use per-owner cumulative wage calculations so caps and cent rounding reconcile annually. Show the allocation policy clearly. This is not a simulation of the user's payroll withholding certificates or refund dates.

The default prospective payment assumption is that the calculated California income tax and SDI are paid during that calendar year. An annual actual-tax-payment override can replace that assumption for federal deduction purposes. State tax assessed and state tax paid are separate tax facts. Property tax deductions use eligible taxes paid; escrow deposits are not treated as paid property taxes.

Deduct contributions from cash once and add the same amount to their account once. Deduct property operating costs and complete debt payments once. Growth changes asset value; depreciation is a tax calculation rather than a second cash expense.

Residual money remains in the cash reserve; there is no automatic investment allocation, asset sale, withdrawal, or new debt. A negative reserve represents the funding gap in the entered plan. Subsequent results are conditional on covering that gap; they cannot be labeled funded. Net worth includes the signed reserve exactly once, alongside accounts/properties minus loans and other debts.

Annual flows are sums of monthly flows. Annual closing balances are December closing balances. Ratios are calculated from their aggregate numerators and denominators, rather than summed monthly percentages.

## 6. Tax accuracy contract

### Rules and provenance

Tax constants live in versioned jurisdiction/year rule packs, with publication year, applicable tax year, effective dates, primary-source URLs, review date, and verified/provisional/projected status. Calculators contain rule application rather than scattered year-specific constants.

The initial rule baseline is tax year 2026. Complete 2025 publications provide historical fixture references; 2026 published amounts and enacted changes take precedence for the applicable year. Verify calculation and rounding methods against the applicable official worksheets, tax tables, and rate schedules.

FTB's October 2026 publication supplies 2026 brackets and standard deductions but states that complete indexed amounts will be available in late December. Any remaining amount must be verified from its applicable statutory indexing rule or retained as provisional. A provisional result cannot receive a fully verified tax label.

For later forecast years, apply already enacted changes and an explicit future indexed-threshold growth assumption, defaulting to 0% until changed. Apply indexing only to legally indexable amounts with the applicable rounding convention. Keep fixed thresholds fixed. Future-year assumptions are labeled projected and retain their baseline source year; they are not descriptions of enacted future law.

### Household and contribution taxes

Calculate federal income tax, California income tax, Social Security, Medicare, Additional Medicare, and California SDI separately. Aggregate all salary sources for each owner before applying per-person payroll limits. Federal/California income tax uses the joint filing unit.

Traditional 401(k) deferrals reduce eligible federal/CA income-tax wages, while Social Security and Medicare retain their proper wage bases. Roth funding is after-tax. IRA deductions and Roth IRA eligibility use the applicable modified-income definitions and each owner's workplace coverage. Combined traditional/Roth contribution limits apply per owner, not per account. Where catch-up rules require employer prior-year wages and plan availability, those inputs are required before applying catch-up benefits.

Include the ordinary California filer exemption credits and their phaseouts, applicable age-related standard deductions, and enacted age-related deductions for the modeled adults. Coverage checks identify other claimable credits or income categories outside the specified contract; the result must disclose that boundary rather than claim a complete household liability.

All long-range results are contribution-and-growth scenarios. Withdrawals, including legally required distributions, are omitted by the explicit first-version scope. Coverage metadata must identify distribution-dependent years as incomplete for total household liability; the app must not imply that a modeled zero withdrawal overrides distribution requirements. This is a result-coverage boundary, not a required-distribution or withdrawal feature.

### Housing and deduction choice

Compute federal and California allowable personal mortgage interest separately, using loan qualification, acquisition dates, applicable aggregate debt limits, and the prescribed average-balance method. Remove rental portions first. Do not use the original loan principal indefinitely as the deduction-limit denominator.

For ordinary qualified acquisition debt, apply the correct pre/post-December-15-2017 federal treatment and California's distinct limits. Special grandfathered debt, refinancing, cash-out, or mixed proceeds require sufficient qualifying history; otherwise the affected deduction result is unavailable until supported. The ordinary loan cash-flow schedule can still be inspected separately.

Apply federal SALT limits, their modified-income phaseout, and enacted future changes. For MFJ in 2026, the published/enacted cap is $40,400, phaseout threshold $505,000, 30% reduction of excess modified income, and $10,000 floor. The separate 2026 top-bracket itemized deduction restriction uses 2/37; it must not be confused with the SALT phaseout.

California independently excludes state income tax/SDI from its personal deduction path, applies its own mortgage and high-income itemized limits, and does not reuse the federal SALT cap. Qualified mortgage-insurance premiums and their applicable eligibility/phaseout are separate from homeowners insurance.

Compare legal federal and California standard/itemized combinations using resulting tax, including applicable federal/California AMT and California high-income surtax. Each combination uses its correct California tax-payment assumption in the federal SALT calculation. Choose the lowest combined resulting income tax; deterministic ties prefer standard treatment. Show each jurisdiction's selected method, standard amount, allowed itemized amount, disallowed amounts, and tax effect.

### Rental and ADU taxes

Maintain separate rental cash flow and taxable profit:

- Cash flow: rent minus operating cash expenses and the full related mortgage payment.
- Taxable profit: rent minus allowable operating expenses, eligible interest, and depreciation; principal is excluded from tax deductions.

Classify repairs, capital basis, personal costs, direct rental costs, and shared costs explicitly. Ordinary residential depreciation uses the applicable straight-line recovery period and mid-month convention from the ready-and-available date. Land is excluded. A conversion from personal use requires the correct adjusted-basis-versus-conversion-market-value comparison. Basis and prior depreciation are independent of projected market appreciation.

Apply at-risk restrictions before passive-loss restrictions, then the applicable household-level passive-loss allowance and phaseout. Retain suspended losses per property and jurisdiction, allocating released losses consistently. Existing at-risk/AMT history must be known when it affects a claimed loss. Unsupported financing/history must not produce an invented wage offset.

Include NIIT when passive rental profit and joint modified income require it. Keep federal and California rental books separate where basis, depreciation, or loss history differ. Treat rental QBI eligibility as an explicit tax qualification: apply its deduction/limits when established; unresolved qualification produces a coverage issue rather than an assumed zero or automatic deduction. Other business/entity rules remain outside scope.

The ADU's rental portion must never also receive a personal itemized deduction. Whole-property rentals do not pass their expenses through the personal mortgage/SALT deduction path.

## 7. Browser workflow, reporting, and errors

Use one plain workspace with sections for Household, Income, Expenses and Debts, Investments, Properties, and Projection. Favor labeled native inputs, editable rows, and expandable record detail. Keyboard use and readable tables are functional requirements; visual polish is later work.

Income changes and property appreciation overrides are inline rows with Add/Edit/Remove controls. A user can enter several dates without a generic event wizard. Related tax/rental fields appear with the relevant property or account. Labels distinguish current/starting balances, annual salaries, monthly payments, APR, effective annual returns, cash expenses, and tax basis.

The projection table shows income, taxes by component, expenses, debt payments, contributions, remaining cash/funding gap, investment growth, property values, loans, equity, and net worth. Expand a year for monthly details and open its tax explanation to inspect deduction choices, rental allocations, contribution limits, and source status.

Keep draft edits separate from the last valid saved plan. Each record has a Save action; its nested raise/appreciation rows are saved together, allowing several changes to be entered in one edit. Save and recalculate only validated records. An invalid field preserves its draft and identifies the record/field. Previously calculated results remain labeled with the saved input revision so they cannot appear to reflect an invalid edit.

Return structured issues with a code, affected record/year/field, severity, explanation, and resolution. Distinguish invalid input, required data, unsupported tax case, provisional rules, capped contribution, below-interest payment, and funding gap. Missing data must not be converted into zero. Expected issues do not crash unrelated input editing.

Each dependent result has an availability state: `available`, `needs-data`, or `unsupported-case`. Rule provenance (`verified`, `provisional`, `projected`) and scenario coverage are separate metadata. An unavailable tax/deduction input propagates to its dependent tax components and after-tax reserve/net-worth totals, which have no numeric value until resolved. Independent income, loan, property, or account schedules can remain available. Unknown loss history propagates to affected later years. Provisional/projected rules can produce numeric scenarios only when their stated assumptions are defined; they cannot receive a fully verified status.

Persist a versioned JSON plan in browser storage. Export a portable JSON backup. Restore parses and validates the whole document before replacing the saved plan; invalid or unsupported documents leave it intact. Storage failures show an unsaved state and preserve an exportable in-memory plan. No credentials, server, cloud sync, or hosted project are needed for this local foundation.

## 8. Verification and acceptance

Build the calculation components before the browser interface. Use synthetic fixtures; do not embed the user's financial records. Expected tax values must be checked against independent primary-source worksheets/calculations, not generated by the implementation's own rule tables.

### Required mathematical fixtures

- Zero contributions, positive/zero/negative returns, month-end contributions, and independent closed-form growth checks.
- Exactly $10,700 after one year for the specified $10,000/7% example.
- Exact annual salary distribution, leap years, midmonth changes, multiple raises, same-date automatic override, duplicate-date rejection, and ended income.
- Zero-rate loans, independently calculated fixed-rate amortization, known opening-balance override, cent-rounded final payoff, and negative amortization.
- Per-property yearly appreciation overrides, single counting of home-plus-ADU value, and unchanged debt principal when market value changes.
- Contributions moving equal cents from reserve to account; expenses counted once; signed cash/funding gap and net-worth reconciliation.
- Exact annual/monthly reconciliation, deterministic results, and input immutability.

### Required tax fixtures

- Official bracket/table boundaries and tax-form rounding for each included rule year/jurisdiction.
- Multiple wage sources for one person versus two people; payroll caps, SDI by year, and Medicare thresholds.
- Traditional/Roth 401(k) income-versus-payroll treatment; aggregated limits, catch-up conditions, IRA/spousal compensation, IRA deduction and Roth eligibility phaseouts.
- Standard/itemized choices that differ by jurisdiction; personal mortgage qualification and average-balance limits; SALT phaseout versus the separate top-bracket limit; high-income California deduction limits; AMT and surtax.
- Eligible tax payments versus assessed liability/escrow and separate mortgage versus homeowners insurance treatment.
- Direct/shared ADU costs, rental interest removed from personal deductions, basis excluding land, mid-month depreciation, and known opening history.
- At-risk/passive losses before/inside/after the special allowance phaseout, loss carryforward/release across years/properties, jurisdiction differences, NIIT, and qualified rental QBI.
- Missing history, unsupported conditions, and provisional rules producing their declared result statuses.

Reference fixtures must record their source, applicable year, inputs, worksheet steps, expected result, and permitted rounding tolerance. Version updates require their fixtures to be rerun and provenance reviewed.

### Required browser/storage checks

Enter two salaries with several dated raises; add the specified account contribution types and a home/ADU; inspect matching annual/monthly/tax results. Reload and confirm persistence. Verify backup/restore round trips, rejected invalid restore, invalid draft handling, and visible save failures. Test these meaningful flows after the engine fixtures pass.

## 9. Build milestones and preservation

1. **Verified tax/property foundation:** validated data contracts, loan/expense/depreciation calculations, contribution rules, annual tax comparison, tax state, sources, and independent reference fixtures.
2. **Unified projection:** dated income, monthly account/property growth, contribution transfers, annual tax reserves, cash gaps, balance reconciliation, and annual/monthly output.
3. **Plain browser app:** input rows, understandable results, error states, local persistence, and backups, using the verified engine.

These are implementation milestones for this spec, not permission to start coding. The next artifact is an implementation plan after the user reviews this written spec. Execution begins only after that plan is reviewed and its execution method selected.

Keep the existing application and the user's uncommitted edits intact while preparing the replacement. Use an isolated implementation workspace when implementation is authorized. Carry forward useful invariants and checked examples; independently verify any reused formulas or rule data. Remove the legacy application only as part of the agreed replacement/integration work. No push is authorized by this design approval.

## 10. Primary-source reference register

References were reviewed during design on 2026-10-11. Publication year and applicability must also be recorded in each implementation fixture/rule pack.

- [IRS 2026 federal brackets and deductions](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill)
- [IRS 2026 planning and enacted changes, Publication 505](https://www.irs.gov/publications/p505)
- [IRS Schedule A instructions](https://www.irs.gov/instructions/i1040sca)
- [IRS mortgage interest, Publication 936](https://www.irs.gov/publications/p936)
- [2025 enacted law, including future SALT and itemized-deduction provisions](https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf)
- [SSA annual wage bases](https://www.ssa.gov/oact/cola/cbb.html)
- [IRS Additional Medicare](https://www.irs.gov/taxtopics/tc560)
- [California EDD rates and SDI](https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/)
- [FTB October 2026 indexing publication, currently at Tax News](https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/)
- [FTB Schedule CA deduction instructions](https://www.ftb.ca.gov/forms/2025/2025-540-ca-instructions.html)
- [FTB federal conformity register](https://www.ftb.ca.gov/about-ftb/data-reports-plans/Summary-of-Federal-Income-Tax-Changes/index.html)
- [FTB 2026 estimated-tax instructions and high-income surtax](https://www.ftb.ca.gov/forms/2026/2026-540-es-instructions.html)
- [IRS residential rentals, Publication 527](https://www.irs.gov/publications/p527)
- [IRS basis, Publication 551](https://www.irs.gov/publications/p551)
- [IRS passive/at-risk activities, Publication 925](https://www.irs.gov/publications/p925)
- [IRS NIIT](https://www.irs.gov/taxtopics/tc559)
- [IRS federal AMT instructions](https://www.irs.gov/instructions/i6251)
- [IRS rental QBI eligibility guidance](https://www.irs.gov/newsroom/qualified-business-income-deduction)
- [FTB rental income](https://www.ftb.ca.gov/file/personal/income-types/rental.html)
- [FTB 2025 passive-loss instructions](https://www.ftb.ca.gov/forms/2025/2025-3801-instructions.html)
- [FTB depreciation adjustments](https://www.ftb.ca.gov/forms/2025/2025-3885a-instructions.html)
- [IRS 401(k) contribution/payroll treatment](https://www.irs.gov/taxtopics/tc424)
- [IRS 2026 retirement limits and IRA phaseouts](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)
- [IRS catch-up contributions](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-catch-up-contributions)
- [IRS IRA contributions, Publication 590-A](https://www.irs.gov/publications/p590a)
- [FTB pension/retirement contribution guidance](https://www.ftb.ca.gov/forms/2025/2025-1005-publication.pdf)
