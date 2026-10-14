# LifeLook ADU construction, valuation, and rental cash flow

Date: 2026-10-13

Status: Approved for implementation planning.

## Intent and approved scope

Let a household plan a future ADU build on a primary home it already owns and understand the resulting construction funding, rental income, taxes, property equity, and household net worth. The user approved California rules, construction costs and dedicated fixed-rate financing, rental operations, independent property valuation, and a build-versus-no-build comparison. They emphasized correct depreciation and the additional square footage's contribution to property value.

Add **Build an ADU** within the existing Properties editor. Support one new, ordinary long-term, fair-market rental ADU per eligible primary home. A property with a planned project cannot also contain an existing ADU or another rental unit in this first version. Different eligible properties may each have a project; the selected project's comparison leaves other projects applied. Existing property and rental records retain their current behavior when no project is present.

The four central quantities are separate: **cash construction cost**, **added market value**, **added property-tax assessed value**, and **depreciable building basis**. Neither square footage nor borrowing makes these amounts interchangeable. The existing home and ADU remain one market-value asset; the ADU has separate rental tax books.

The recommended approach is a property-linked project integrated with the current engine and scenario workspace. A standalone worksheet would reduce integration work but would not resolve household deductions and funding interactions. A general construction/refinancing event engine would support more contracts at a substantially greater scope. This design adds the lifecycle needed by the approved ADU feature without introducing general property purchase, sale, or refinance events.

## Lifecycle and stored inputs

Add an optional `aduProject` to `Property`. Keep embedded plan schema version 1 and the workspace envelope unchanged. Older plans without the optional field retain their exact financial results and optional-field absence through export and restore.

The project contains a globally unique ID, name, associated `rentalId`, construction-start date, completion date, staged cash costs, completion valuation, optional financing, prospective shared-expense overrides, property-tax assumptions/payments, and the basis and funding qualifications described below. Its linked new rental remains a `RentalUnit` in `plan.rentals`; identify its ownership through `aduProject.rentalId`, rather than introducing competing project links. The existing property's opening value excludes the future ADU.

Use the existing eventual `primary-with-adu` property role for a planned ADU. Resolve its effective use by date: the original home remains personal before the new rental becomes available. Permit future rental availability only when the unit belongs to a validated project. A property can contain at most one project and its one linked new rental. A loan specific to the build belongs to that project's financing contract, not to an existing property loan with a fictitious January opening balance.

Keep these dates distinct and validate their order:

1. Construction starts on or after January 1 of the forecast start year.
2. Completion is on or after construction start.
3. The ADU is ready and available for rent on or after completion.
4. The first lease/rent receipt begins on or after rental availability.

Planning/design payments may precede construction start, but cannot precede forecast start. Draws and planned construction payments cannot follow completion in this first version; later improvements require their own future supported recovery schedule. Dates beyond the displayed horizon are valid: explain which project effects lie outside the forecast instead of inventing completion within it.

Opening construction already in progress, conversion of an existing personal-use garage/building, demolition of existing valuable structures, ADU personal use, short-term rentals, substantial tenant services, property sale/recapture calculations, refinancing the existing mortgage, variable-rate HELOCs, and unpaid interest added to debt principal are outside this lifecycle. Preserve the current unsupported boundaries for those cases.

## Square footage and market valuation

For project properties, the primary home and ADU living areas are explicitly entered in **square feet**. Existing primary-home living area does not change. Show the additional ADU area separately and, after completion, show their sum as **Combined home and ADU living area**. Do not label that sum the main dwelling's appraisal gross living area.

The selected valuation mode is one of:

```ts
type AduCompletionValuation =
  | { kind: 'adu-value-per-square-foot'; valuePerSquareFootCents: Cents }
  | { kind: 'value-added'; valueAddedCents: Cents };
```

In the square-foot mode:

```text
addedMarketValueCents = settleCents(ADU living area sq ft × assumed added value cents per sq ft)
```

Settle the multiplication once using decimal arithmetic. Allow a zero contribution; require a finite positive living area and a nonnegative entered rate/value. The rate is an assumption about the ADU's incremental market contribution at completion. It is not construction cost per square foot, nor an automatically inferred appreciation rate.

Show the existing whole property's opening value divided by the existing home's living area as a reference labelled **Current whole-property value per sq ft, including land**. It never silently supplies the ADU rate. An explicit **Use this rate as an assumption** action may copy the rounded reference into the editable rate field. State that this is a simplified valuation assumption, and allow the user to replace it with a rate supported by comparable sales or an entered appraised value increase. A blank rate is unresolved input, not a regional default. When copying the reference, the copied rate is the authoritative rounded input; do not use a hidden unrounded reference in the multiplication.

Display three distinct ratios: construction cash cost per added sq ft, assumed ADU market contribution per added sq ft, and combined property market value per combined living-area sq ft, including land. A missing primary-home measurement leaves the combined ratio and default shared allocation unavailable; it does not invalidate independent direct-value math. Project-linked properties may omit that measurement while incomplete; project ADU area itself is required and positive. Extend validation conditionally for project properties, preserving mandatory areas for the existing nonproject ADU contract. Explicit supported allocation shares may resolve expenses without the primary-home measurement. Changing area recomputes area-based valuation and prospective shared expense allocation; it does not rewrite historical home area, construction cost, basis, or direct loan-proceeds tracing.

Fannie Mae requires market-supported adjustments rather than arbitrary square-foot rules and generally reports ADU area separately. This supports an explicit planning assumption rather than a claim that any added area must fetch the original home's average price per square foot. [Comparable-sale adjustments](https://guide-selling.fanniemae.com/sel/b4-1.3-09/adjustments-comparable-sales), [ADU appraisal treatment](https://guide-selling.fanniemae.com/sel/b4-1.3-05/improvements-section-appraisal-report).

### Value movements and appreciation

Use the existing monthly property appreciation convention. In the completion month, grow the opening property value first, then add the completion contribution at month end. The contribution begins appreciating the following month, using the property's existing annual rate/overrides. There is no daily property appreciation calculation.

```text
closingValue = openingValue + appreciationGrowth + completionValueAdded
propertyEquity = closingValue − all linked closing loan/debt balances
householdNetWorth = cash + investments + propertyValues − liabilities
```

Carry exact decimal growth internally and use consistent settled movement differences so displayed cents reconcile. Add a separate result movement for completion value; do not classify it as appreciation, rent, earned income, or a second asset. Completion value is added once. Construction spending does not create an additional automatic value addition, and tax depreciation never subtracts from modeled market value.

The first version recognizes ADU market contribution at completion. Before then, the existing-home value remains available, but **unvalued construction in progress** makes total property market value, equity, and household net worth incomplete once construction starts. Do not report spent cost as market value or silently value unfinished work at zero. Show the known existing-home value and project spending separately. A project crossing January 1 can still have an entered property-tax construction-in-progress assessment; that assessment is not a substitute for market valuation. At completion the contribution resolves this valuation boundary independently of tax completeness. This conservative scope avoids an invented construction appraisal curve.

## Construction costs and cash funding

Store staged one-time costs within the project, each with a unique ID, label, payment date, amount in cents, and classification: eligible building construction/design/permits, nondepreciable land, financing fees, or another component requiring separate treatment. Stage payments post in their entered calendar month, without annual spreading. A contingency is a budget assumption; include it in cash/basis only through actual modeled payment stages. Prevent simultaneous automatic contingency expansion and manually entered contingency payments.

Show the planned total, cumulative paid cost, future commitments, and construction cost per added square foot. Prevent duplication through generic capital expenses: each project's staged costs have one authoritative cash stream and one capitalization path. Existing linked operating expense records are separate from construction cost records.

Loan proceeds increase cash and debt equally. They do not enter gross income, tax-reserve income weights, rental revenue, income ratios, or the percentage cash-flow-allocation denominator as income. Loan repayments debit cash once; principal reduces debt and is not an income-tax deduction. Show cash spending, financing receipts, interest, principal repayments, and the residual owner cash needed separately.

After-tax cash flow before investments includes construction outflows and debt payments but excludes borrowing receipts. Cash reserve reconciliation separately includes financing inflows and investment transfers. Report peak additional funding need using minimum unrestricted cash, excluding proceeds earmarked for future project payments; positive total cash must not conceal an owner funding gap. Preserve existing funding-gap and conditional-result behavior. The monthly forecast does not prove intramonth liquidity or imply a cash shortfall has been externally funded.

For investment allocation, subtract only the owner-funded part of staged construction costs from income available for investing. Add back the traced loan-funded portion of that month's paid construction costs to the reported cash-flow budget, without adding unused draws or presenting proceeds as income. Expose this bridge as **Cash available from income for investment allocation**; it equals reported after-tax cash flow before investments plus traced financed construction spending. Interest and repayments still reduce that budget. Monthly funding ceilings use unrestricted household cash, excluding unspent project-earmarked proceeds. Thus a wage-funded contribution need not be deferred by a simultaneous fully financed construction payment, but idle borrowed money cannot fund investment targets. With no project, the existing allocation denominator and funding ceilings are unchanged.

Owner capital contributed to the activity and later owner support of a rental cash deficit must have explicit project attribution. A construction outlay financed by a traced project draw is not also an owner capital injection. An owner contribution into the activity is attribution of a household cash payment, not an additional household debit. A confirmed rental support assumption covers the exact monthly cash deficit after ordinary operating costs, cash interest, and principal payments; it excludes noncash depreciation and costs already attributed to construction funding. An unresolved support answer retains the affected at-risk boundary. A negative household cash reserve continues to mark these movements conditional on obtaining funding.

## Dedicated fixed-rate financing

Support cash-only funding or one dedicated fixed-rate loan per project. The contract has a unique ID/name, nominal APR, dated draw months and amounts, interest-only construction period, first amortizing payment month, term in months, collateral/proceeds tracing, and financing-at-risk qualification. All draws occur by completion and before amortization starts; total draws cannot exceed declared staged project costs. An existing mortgage remains unchanged.

Each draw allocates its amount to one or more staged cost IDs, with allocated cents summing exactly to the draw. The draw month cannot follow any financed payment's month, and cumulative financed shares cannot exceed that stage's cost. Unspent proceeds are earmarked for those future payments: they remain in total household cash but are excluded from unrestricted cash and investment funding. Every draw must be fully applied by completion. Reject draw-to-earlier-payment reimbursement, owner distributions, cross-project funding, and excess/unused-at-completion proceeds in this version. This avoids counting reimbursed owner capital and its replacement borrowing simultaneously. Show owner capital as the cost's unfinanced remainder at its payment date, plus separately qualified support/interest movements.

Draw timing uses an explicit **beginning-of-month** convention, displayed beside the loan inputs. Store draws as `YYYY-MM`; compute interest on opening principal plus that month's draws at APR/12. Interest is paid at month end throughout the construction period. A loan with no draws has zero balance, interest, and payments. No interest accrues before the first draw.

At amortization start, compute the existing fixed-payment formula from the outstanding drawn principal, entered APR, and term. Reuse payment/payoff math, but use a new draw-aware schedule with separate draw, cash-interest, payment, principal, and closing-balance movements. Conserve cents and cap ordinary payments at the amount due. On the final contractual payment month, pay the remaining principal plus that month's interest, adjusting the last payment for rounding rather than adding another month or forgiving cents. At 0% APR, a $100 principal over three months pays $33.33, $33.33, and $33.34. Extra principal payments and loan replacement are outside this contract.

Construction interest is always a paid cash outflow in this contract. Its tax treatment is separately confirmed for federal and California books. For every payment month/book, capitalized interest, currently deductible interest, confirmed nondeductible interest, and unresolved interest must reconcile to the scheduled cash interest. Capitalizing paid interest for tax does not add it to loan principal. Unknown treatment, investment-interest limits, unverified business-interest exceptions, or other unsupported qualifications leave affected taxes unavailable while cash and debt schedules remain available. Never assume every household is required to capitalize construction interest: the qualified small-business exception to section 263A explicitly includes interest. [26 CFR 1.263A-8](https://www.ecfr.gov/current/title-26/section-1.263A-8), [26 CFR 1.263A-1(j)](https://www.ecfr.gov/current/title-26/section-1.263A-1).

An interest-only loan phase is not a tax capitalization period. Require the supported production-period/tracing qualification and confirmed eligible interest amounts by payment month/book, bounded by the scheduled cash interest and never deducted and capitalized simultaneously. The interest production period generally starts with physical production and ends after placement in service and completion of expected production activities; planning alone does not establish its start. Do not infer eligibility from all interest paid before amortization or from borrowed cash held idle. Production suspensions and unconfirmed transition-month allocations retain a tax coverage boundary. Confirmed eligible amounts determine basis; the cash-interest schedule remains independently calculated. [26 CFR 1.263A-12](https://www.ecfr.gov/current/title-26/section-1.263A-12).

Traced project interest belongs to the rental activity to the extent qualified; do not also pass it through the personal mortgage deduction. Floor area alone cannot qualify the original mortgage or the project loan. Preserve existing acquisition-debt qualification and separate federal/California treatment.

## Depreciation, tax basis, and rental loss limits

### Basis and first use

Derive each new rental book's basis from confirmed eligible capitalized project costs, interest, and eligible production-period project taxes. A cash payment enters that ledger once and cannot also be a current deduction in the same book. Keep the federal, California, federal-AMT, and California-AMT books independent. Market uplift, assessed value, owner labor, loan principal, and earmarked cash reserves never become depreciable building basis. Land is excluded; financing fees and shorter-lived components require their own supported treatment rather than inclusion by default. Unsupported components do not silently disappear from tax calculations. [IRS Publication 551](https://www.irs.gov/publications/p551), [FTB depreciation instructions](https://www.ftb.ca.gov/forms/2025/2025-3885a-instructions.html).

The contract describes a genuinely new rental asset, so the editor constructs known-zero preforecast depreciation, prior losses, and prior rental QBI-loss vintages. This is a new-asset initialization, not coercion of unknown historical input. Do not expose preexisting-rental history fields for this project unit. Reject imported nonzero preforecast depreciation/loss histories inconsistent with the new-build contract.

From the first project funding or relevant tax event, maintain a pending-project capital ledger and four independent tax/risk/loss states. Supported current deductions before rental readiness pass through the applicable loss limitations and carry forward; do not bypass them merely because the building is not yet depreciable. Establish owner capital and qualifying borrowing at their actual movement dates. At rental availability, transfer supported accumulated building cost into recovery basis and begin depreciation once, preserving the existing project risk, losses, and QBI vintages. Prior project deductions are not reset to zero and capital is not added to amount at risk again on readiness. Before readiness, the capital ledger is not depreciable recovery basis.

Depreciation starts when the ADU is **ready and available for rent**, even if a tenant arrives later. In this scope the residential building uses straight-line recovery over 27.5 years/330 months with the mid-month convention. Read the applicable method from the existing sourced rule packs; unsupported future method changes propagate normally. The statutory method is supported by [26 USC 168(b), (c), and (d)](https://uscode.house.gov/us/usc/119-118/t26/s168/) and the placed-in-service distinction by [IRS Publication 527](https://www.irs.gov/publications/p527).

### Exact recovery math

For new project assets, compute cumulative recovery in half-month units, rather than repeatedly rounding a monthly rate or a full-year amount:

```text
B = eligible original recovery basis, integer cents
u = elapsed recovery half-month units, clamped to [0, 660]
cumulativeDepreciation(u) = settleCents(B × u / 660)
periodDepreciation = cumulativeDepreciation(periodEnd) − cumulativeDepreciation(periodStart)
adjustedBasis = B − cumulativeDepreciation(periodEnd)
```

The service month contributes one half-month unit, ordinary intervening months contribute two, and the last recovery month contributes one. For a January–December calendar year and service month M, first-year recovery is `(12.5 − M)` months. All days within the same service month receive the same convention. Annual depreciation is the sum of monthly recovery amounts and total recovery must equal basis exactly. Cap recovery at basis and return zero thereafter. Preserve the existing depreciation behavior for preexisting rentals and their independently verified fixtures; introduce the cumulative rule for project-created ordinary assets through an explicit lifecycle/method path.

Tax depreciation reduces adjusted basis, not market value, equity, or cash directly. A tax deduction can change modeled tax payments only after household deduction selection, passive/at-risk restrictions, NIIT, QBI, and other existing tax paths. Separate ordinary depreciation from any later sale-gain/recapture boundary, which remains outside this version.

### Loss restrictions and capital movements

Use the existing four-book loss limitation order: at-risk first, passive second, carried losses by origin year. New project funding must explicitly enter amount-at-risk movements: owner capital once, qualifying borrowed principal once, qualifying principal reductions, and supported operating-profit/loss changes. Draws plus their funded expenditures cannot count as two capital additions. Construction spending is a basis movement rather than a currently deductible rental loss.

Do not infer owner funding from wages, an unlinked household reserve, or an unresolved cash gap. Handle confirmed activity support separately from activity-funded principal repayments and preserve the negative-risk/recapture unsupported boundary. Maintain participation-at-origin and QBI qualification when carrying and releasing losses.

Show depreciation, taxable rental profit/loss, allowed current loss, and suspended at-risk/passive losses separately. Current rental losses do not automatically offset salary; the existing special allowance and MAGI phaseout apply. California and federal exceptions are not interchangeable. [IRS Publication 925](https://www.irs.gov/publications/p925), [FTB passive-loss instructions](https://www.ftb.ca.gov/forms/2025/2025-3801-instructions.html).

Future unit qualification and opening history must not invalidate years before the relevant project activity. Unresolved financing/basis treatment begins affecting taxes when that treatment is relevant, even if the rental is not yet available. Rental-use qualifications are required when a deduction/activity becomes relevant; pre-readiness current rental deductions cannot postpone their required qualifications until tenant arrival or depreciation. Preserve independent known cash/value/debt results when a particular tax book is unavailable.

## Rental operations and expense allocation

Reuse the linked rental's monthly rent, rent growth, lease dates, and qualification inputs. Add an optional expected vacancy percentage, zero when absent, as a planning reduction to scheduled rent; label it **Expected collected rent** rather than an actual tenant timetable. Apply it to the exact prorated monthly amounts before cumulative cent settlement. Security deposits and substantial tenant services are outside this ordinary rental scope.

Reuse linked recurring expense forms for insurance, management, utilities, maintenance, and other supported ordinary costs, with project ownership established by the linked rental. Direct ADU expenses stay wholly assigned to the activity; original home expenses remain personal before rental readiness. A project-owned prospective override identifies an original expense to share after availability and can provide an explicit share; it never overwrites that original expense's saved use/allocation. Default selected common operating-cost shares become `ADU area / (primary area + ADU area)` only from availability onward. Resolve allocations from monthly paid amounts, including partial first-month availability by calendar days, before summing the year's facts. Explicit confirmed allocation overrides retain their meaning. Capitalized project payments never flow through these operating allocations.

Earmarking savings for future repairs is not an expense or a current deduction. If the user chooses an expected maintenance budget as actual recurring modeled spending, identify it as an expense assumption and debit it once. Do not create both a reserve transfer and the same expense.

Report expected collected rent, ordinary operating expenses, incremental property tax paid, cash interest, principal repayment, operating cash flow, construction cash flow, and household tax changes as distinct amounts. The existing annual-tax reserve convention remains a planning allocation; monthly reserved tax is not proof of the timing of actual refunds, remittances, or deductions.

## California property-tax assessment and payments

Preserve the original home's assessment and ordinary tax expense path. The ADU creates a separate new-construction assessed-value increment; its amount is entered independently of market uplift and construction cost. An entered local marginal ad valorem rate and separate additional fixed charges determine incremental tax estimates, with an explicit assessed-value growth assumption capped at the applicable ordinary Proposition 13 maximum. Do not apply the marginal rate to the entire property's current market value.

At each January 1 during construction, accept an explicit construction-in-progress assessment. Missing relevant assessment data leaves that incremental tax estimate unavailable. Completed new construction can trigger supplemental assessment from the next calendar month; do not treat assessment as payment. [BOE new construction](https://www.boe.ca.gov/proptaxes/newconstructionproperty.htm), [BOE supplemental assessment](https://www.boe.ca.gov/proptaxes/supplemental-assessment/), [California property-tax overview](https://www.boe.ca.gov/proptaxes/pdf/pub29.pdf).

Store incremental bill/payment rows with a payment month, amount, and regular/supplemental/construction-in-progress classification. Show assessor-based annual estimates alongside the entered paid schedule; the entered payment schedule alone posts to cash and deduction facts. Before any tax model consumes payments, require confirmation that the entered incremental schedule is complete for the forecast year, including an explicit known-zero answer when appropriate. A missing schedule is unknown, not tax-free. An estimate cannot silently become an actual deductible payment. Provide a clearly labelled **Use estimate as planned payments** action that creates editable rows with a user-selected payment month; do not guess when the county will mail a supplemental bill.

Do not overlap the new incremental rows with an existing whole-property tax expense that already includes the ADU. The editor requires confirmation that the original tax expense covers the original property only. Treat direct ADU tax as a rental cost when eligible; preavailability and construction-period taxes require confirmed supported capitalization/deduction treatment. Ordinary original-property shared tax allocation follows the supported monthly rental-use allocation and personal SALT limits. Escrow deposits remain outside property-tax-paid facts.

This version does not promise an ADU-specific tax credit or grant. Unverified incentives do not reduce build cost or basis automatically. Existing unsupported-credit coverage continues to apply when such circumstances are reported.

## Build versus no-build comparison

Generate a pure, validated no-build counterpart from the active applied plan for the selected project. Remove only its project, dedicated financing, linked new rental, project-owned direct operating expenses/tax payments, prospective allocation overrides, completion value movement, and generated capital state. Restore that property's personal use; removing overrides exposes the original saved expense allocations. Preserve original home inputs, historical loans, unrelated expenses, all other properties/projects, household income, accounts, and allocation policy. Do not create, rename, or mutate a stored scenario merely to calculate this counterpart.

Reject historical-loan proceeds allocations or unrelated records that reference a future project rental. Every ordinary expense referencing that rental is project-owned and removed with it; original shared expenses reference their property/own original use, with prospective project overrides stored in the project. A project override can reference only an original expense of its property and cannot target another project's owned record. Original mortgages cannot gain a prospective rental-proceeds link merely from added floor area. Validate the counterpart after removal, and reject dangling references in imported plans and project removal before publishing anything. Removal must not rewrite historical mortgage qualification to make the counterpart valid.

Run build and no-build through the same engine/rules with independent carried tax state. With multiple projects, each project's comparison is conditional on the others remaining applied; individual tax differences are not asserted to add to an all-project total.

Compare years and months for construction cash spending, funding receipts, expected rent, debt service, cash flow after taxes before investment transfers, actual investment contributions, closing cash, property equity, and household net worth. Year-end balances are not sums of monthly balances. Difference fields retain the unavailable status and provenance of either operand; never treat missing/incomplete totals as zero.

When cash-flow allocation is enabled, the same policy can accept different retirement deposits in the two forecasts. Label the tax difference **Household tax change with your allocation policy**, and show the contribution difference beside it. It includes the project and any change in retirement funding; do not label the whole difference an isolated ADU deduction benefit. Show actual depreciation and allowed rental losses in the rental tax detail. A separate fixed-contribution attribution calculation is deferred; it would require freezing accepted monthly routes and validating legal eligibility in an additional carried-tax-state run.

Define `A[m]` as build minus no-build cash flow after household taxes, construction/operating expenses, and debt payments, before investment transfers. Define `D[m]` as the selected project's loan draws. Net owner cash committed through the completion month is `C = -sum(A[m] + D[m])` from forecast start through that month. This includes precompletion cash interest, principal, property tax, and modeled tax effects exactly once; matching financing reduces the commitment. All project draws must have been spent by completion.

Cash recovery starts in the month after completion and uses `sum(A[m])`; precompletion movements already in C are not counted again. Payback is the first month this cumulative recovery reaches positive C. Cash-on-cash return for a selected calendar year is that year's postcompletion incremental cash flow divided by C; a partial first operating year is labelled as partial and is not annualized silently. Later principal/interest payments remain cash costs. Exclude market appreciation, unrealized value additions, and loan receipts from recovery. Because tax change includes policy response, state that assumption beside these metrics. If positive C is not recovered within the horizon, show **Not reached within forecast**; if C is zero/negative, show **No positive owner capital to recover** and an unavailable return ratio. If completion or required cash/tax inputs lie outside the calculated horizon or are unresolved, these metrics remain unavailable. A value return and a cash return remain separate.

For zero appreciation, no tax, no other income/expense, and no loan repayment before completion:

| Independent worksheet | Cash change | Property equity change | Household net-worth change |
| --- | ---: | ---: | ---: |
| 800 sq ft × $275/sq ft; $300,000 all-cash build | −$300,000 | +$220,000 | −$80,000 |
| Same build; $200,000 borrowed and $100,000 owner cash | −$100,000 | +$20,000 | −$80,000 |
| Borrowing only, before spending | +$200,000 | −$200,000 | $0 |

The borrowing-only row uses known existing-home value and debt; construction must not have begun, so the unvalued-work-in-progress boundary does not apply. Draws themselves produce zero income. Changing financing changes property equity and cash composition, not the cost-minus-value net-worth result before interest and other effects.

## Browser workflow and compatibility

The property editor has a **Build an ADU** disclosure containing timeline, areas/valuation, staged budget, funding, rental assumptions, and tax assumptions. Show an editable calculation summary for `area × assumed rate = value addition`, building basis and first-year depreciation, total cost, drawn debt, and owner cash requirement. Clearly label estimates and unresolved inputs. Give advanced basis/interest/loss explanations optional disclosures rather than forcing implementation details into the main flow.

Save the property, project, linked rental, and owned expenses atomically using the existing property draft bundle. Validate the complete candidate plan and calculate the forecast before publication. Rejected saves retain entered text. Removing a project removes only its owned future records, never the original home or mortgage. Existing stale-draft detection must include nested project inputs and linked owned records.

Add a **Build versus no build** report for applied inputs. Preview calculations are bound to scenario ID, selected project ID, input revision, rule version, session/workspace generation, activation generation, and selection/request generation. Switching projects or switching away and back without an input change invalidates the old request's rendering authority; restoring/deleting also invalidates old replies. Cache semantic results by project and applied inputs/rules within the current session, and attach fresh UI ownership before rendering a cache hit. Identical financial record IDs across different scenarios remain valid. Keep the comparison in the active scenario's UI, not a cross-scenario editing workflow. Export applied project inputs only; exclude comparison results, preview state, and drafts. Reload recalculates the lifecycle and counterpart.

## Engine boundaries and implementation map

| Boundary | Responsibility |
| --- | --- |
| `model/plan.ts`, `validation.ts` | Add optional project, valuation, costs, financing and tax-payment contracts; validate ownership, IDs, basis classifications, date order, and conditional future-date support. |
| New project lifecycle module | Resolve owned records and month/year activity; expose one authoritative set of cost, funding, value, assessment/payment, and capital movements. |
| New project-loan scheduler; existing `property/loans.ts` helpers | Resolve draws and interest-only/amortizing balances without changing existing loans. |
| `cash/income.ts`, `projection.ts`, cash-flow allocation | Post exact project cash movements once; keep draws outside income; bridge traced financed construction costs into the earned allocation budget while excluding earmarked proceeds from unrestricted funding. |
| `growth.ts`, projection result/report types | Separate completion value from appreciation, area, debt, and incomplete construction valuation. |
| `model/tax-state.ts`, coverage, property facts/depreciation, rental loss resolution | Activate books when relevant, apply cumulative new-asset depreciation, monthly allocations, explicit capital/support movements and independent carried state. |
| New project comparison module | Construct the validated selected-project no-build plan and compute guarded differences without recursion or state mutation. |
| Property draft/forms, reporting, scenario view session | Atomic editing, clear math, optional explanations, lifecycle-safe comparison results, backups and issue targets. |

Keep functions pure and deterministic, with explicit integer cents at money boundaries. A comparison invokes ordinary projections without embedding another comparison in them. Cache only by applied inputs/rules/runtime owner; a rule or scenario replacement with reused revision numbers invalidates the cache. No new runtime dependencies are needed.

Unknown inputs affect the appropriate dependent results rather than silently becoming zeros. Monetary overflow produces the existing unavailable status with a record/field/year issue. Preserve unaffected income, cost, debt, and known existing-home schedules. When no project is present, every existing financial fixture retains its original result.

## Independent math worksheets and acceptance checks

Expected values must be transcribed from independent arithmetic/source worksheets, not generated by production calculators. New sourced rule/method snapshots need original bytes, retrieval date, hashes, and versioned provenance; distinguish forecast assumptions from verified tax rules. Existing provisional tax tables/California assumptions retain their labels.

1. **Area and value:** 800 sq ft × $275 contributes exactly $220,000. Zero rate is valid. Fractional square footage settles once. Switching to direct-value mode yields the same value with a different input source. Main-home area and opening value remain independent. Adopting a land-included reference is explicit. Unsupported range/overflow leaves dependent amounts unavailable.
2. **Value timing:** For June completion, January–May original-home value matches no-build. June adds the contribution once after original-home growth; July–December growth includes it. Combined living area changes once. Unfinished construction makes full value/equity/net worth incomplete, without hiding known costs or treating assessed value as market value.
3. **Funding and net worth:** Pin the three $300,000/$220,000 worksheets above, exact outlay months, principal-only neutrality, loan proceeds outside income, both allocation-enabled and ordinary cash posting, and peak funding gaps. Costs and borrowing are each posted once.
4. **Depreciation:** In the separate $330,000 building-basis fixture, readiness July 15, 2027 yields July $500 plus August–December $1,000/month: 2027 depreciation $5,500, closing adjusted basis $324,500. Years 2028–2054 each recover $12,000, January 2055 recovers the final $500, and later months recover zero. Total equals $330,000. July 1, 15, and 31 use the same mid-month schedule. September tenant arrival does not defer July readiness recovery.
5. **Cents and independence:** A $330,001 basis yields $5,500.02 in 2027 and $12,000.03 in 2028 under cumulative rounding; total over the complete schedule is exactly $330,001.00. A $330,000.01 basis retains its final cent. Changing completion PSF, appreciation, assessed value, or borrowed principal leaves recovery unchanged unless confirmed capitalizable paid costs/interest actually change.
6. **Draw loan:** Draw $120,000 in July 2027 at 0% APR; remain interest-only through December. 2027 interest/principal are zero and debt closes at $120,000. Amortize over 120 months from January 2028 at $1,000/month; 2028 principal is $12,000 and debt closes at $108,000; final payment is December 2037. Separately, a $75,000 June beginning-of-month draw at 6% gives $375 June interest, an additional $75,000 July draw gives $750 July interest, and June–December interest-only cash interest totals $4,875. Pin the $100/three-month residual worksheet, draw-to-cost cent conservation, unspent restricted cash, and rejection of a draw reimbursing an earlier owner payment.
7. **Tax activation and losses:** Preproject years retain available taxes even when future rental qualifications are unanswered. Pending project states begin with relevant capital/tax events, carry independently across construction years, and preserve qualified borrowing/owner contributions, participation vintages, passive/at-risk losses, and conditional owner support when recovery basis activates at readiness. Pin a supported pre-readiness deduction with a carried loss that survives readiness. A high-MAGI loss need not create current tax savings. Principal funded from owner support differs from activity-funded principal. No duplicated personal/rental interest deduction.
8. **Allocations and property taxes:** A partial rental-ready month splits shared paid expenses by active days, conserves every cent, and never reclassifies earlier months. Direct ADU assessments, January 1 progress assessments, regular/supplemental payments, confirmed zero/missing schedules, and existing-property expenses remain distinct. Missing or incompatible tax treatment affects the relevant books.
9. **Comparisons and returns:** No-build removes only the selected project and its prospective shared-expense overrides, preserving an original mortgage, original shared expense, and another project's records without dangling references. Both forecasts solve their own allocation policy and carried tax states. Show contribution/tax changes honestly; unavailable operands propagate. A $300,000 build with $200,000 draws, $1,000 precompletion interest, $600 tax paid, $500 principal paid, and a $200 modeled household tax reduction gives C = $101,900. Subsequent $1,000/month incremental cash flow recovers it in postcompletion month 102, with a full-year cash-on-cash numerator of $12,000. Payback excludes loan receipts and unrealized equity, and reports not reached/undefined correctly.
10. **Allocation and user workflow:** A wage-funded contribution remains feasible when that month's construction cost is wholly covered by an attributed draw; unused future-cost funding cannot increase income, the earned percentage budget, or unrestricted cash. Save/reject/discard and remove preserve original home/mortgage, pending invalid text, scenario isolation, and exact export/restore inputs. Switching project A to B, switching scenarios away and back without a revision change, and same-ID replacement discard obsolete preview/comparison replies. Cover a cross-year cash-funded build and a staged financed build in browser acceptance flows, then run the existing check suite and engine timezone regressions.

## Review and handoff

This specification records the approved feature scope and the additional math contracts requested by the user. Product implementation has not begun. The [implementation plan](../plans/2026-10-13-lifelook-adu-build.md) defines tasks, exact interfaces, independent fixtures, and the execution handoff. Implementation follows plan review and execution-method selection. Local commits are permitted. Before any `git push`, obtain explicit user confirmation for the exact repository, remote, and branch.
