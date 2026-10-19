# ADU construction funded from a brokerage account

Status: implemented locally following the user's instruction to proceed directly without an implementation plan. Verification is recorded in the development session.

## Intended outcome

The simple ADU form lets the household choose a saved taxable brokerage account to pay construction costs. The forecast estimates the investment sale needed to cover both construction and the additional household tax caused by that sale. It carries the reduced account value and remaining cost basis into later months, so future investment growth and net worth reflect the money spent.

The user selected total account cost basis and proportional sales of long-term holdings instead of individual tax lots. Preserve the short ADU form and its existing planning estimates. The user also requires the ADU's added property value to receive the original property's appreciation rate after completion.

## Current behavior and alternatives

The current ADU cash option spends unrestricted household cash. Dedicated loan proceeds already cover specifically attributed construction costs. Brokerage accounts currently support deposits and unrealized growth, without withdrawals, brokerage basis, or preferential federal capital-gains calculations.

Use the annual household tax calculation to estimate incremental sale tax. A flat combined tax percentage would be easier but would miss bracket crossings, NIIT and deduction interactions. Individual tax lots would offer more control but add inputs beyond the approved simple estimate. Neither alternative is part of this design.

## Simple form and saved inputs

Keep the current cash/loan selector and its conditional loan fields. Add **Pay construction cash from**, offering **Household cash** and saved taxable brokerage accounts by name. With a partial construction loan, the selected account funds only construction costs not covered by attributed loan proceeds. Without a loan it funds the whole construction amount. An absent selection retains existing household-cash behavior. Ongoing operating expenses, loan payments and later property-tax bills retain their existing household-cash funding; this selection covers construction and its sale-related tax reserve.

Show the selected account's opening balance and cost basis, with an **Edit account cost basis** action opening its existing investment editor. Add **Investment cost basis at forecast start ($)** to taxable brokerage account editing. Explain this as the amount paid for the investments still held on January 1 of the forecast start year, rather than their market value. Save it once on the account, so multiple projects share the same basis. Selecting an account does not overwrite its other inputs or pending account draft.

Cost basis may remain unknown. This aggregate brokerage funding model uses an explicit, visible zero-basis planning assumption until the user supplies it. The assumption applies consistently to the shared account ledger whether its projects use simple or detailed ADU rental-tax inputs; the existing ADU tax-mode switch does not change the brokerage funding method. Keep the saved answer unknown and the main funding projection numeric; do not silently save confirmed zero basis. Known zero remains distinct from unknown. The selected long-term/proportional-holdings assumption is visible beside the funding estimate.

Add optional stored inputs without changing the existing schema version or workspace envelope:

- `Account.openingTaxableBasis?: History<Cents>`, valid only for a taxable brokerage account. Omission means unknown. Basis is nonnegative and may exceed market value.
- `AduProject.ownerFunding?: {kind: 'household-cash'} | {kind: 'taxable-brokerage'; accountId: string}`. Omission means household cash.

Validate account references and type. Changing or deleting a referenced account must show the dependency rather than silently choose a different source. Save, scenario switching, export and reload use the existing applied-input rules. Account basis remains after removing an ADU because it belongs to the account.

## Investment ledger

Track market value and basis separately for each selected account across the full projection. Opening basis comes from the saved account or the labeled assumption. Contributions increase both market value and basis; unrealized appreciation changes market value only.

In a sale month, apply existing monthly growth, then the construction sale, then month-end contributions. A same-month planned deposit cannot finance an earlier sale. This follows the existing convention that deposits start growing the following month. Multiple construction events use a stable order by payment date, then property/project/stage ID, and share one account ledger.

For a sale of `S` cents from a pre-sale market value `V` and basis `B`:

```text
basis consumed = rounded(B × S / V), capped at remaining basis
realized gain or loss = S − basis consumed
closing market value = V − S
closing basis = B − basis consumed
```

Require `0 <= S <= V`; a nonzero sale requires positive market value. A zero sale consumes zero basis, including when market value is zero but historical basis is positive. A full liquidation of a positive-value account consumes all remaining basis exactly. An empty account supplies zero cash and shows a funding shortfall. A zero owner-funded cost, including a fully loan-funded stage, generates no sale. Use decimal arithmetic and integer-cent settlements. Never encode sales as negative contributions: the existing growth helper deliberately rejects negative deposits. Add explicit withdrawal and basis movements to monthly/annual account reporting.

This is an aggregate planning assumption about the sold investments, not a broker tax-lot selection or an election of an average-basis reporting method. Recent contributions are treated under the selected long-term planning assumption; actual holding periods can differ.

## Capital-gains tax integration

Keep gross proceeds, returned basis and taxable gain distinct. Gross proceeds are a transfer from investments to cash; only the taxable gain enters income-tax facts. Capital gains are not wages or compensation for IRA contribution limits.

Add generated ADU-sale gain facts to the existing annual household calculation, retaining deduction selection and modeled interactions with IRA eligibility, rental-loss limits, QBI, AMT, SALT and NIIT. Federal regular and AMT calculations must distinguish preferential long-term gains from ordinary income and use the appropriate rate stacking/worksheet limits. California includes the gain in its ordinary income calculation. Do not simply add an ordinary-taxable recurring income record.

Use the published 2026 married-joint capital-gains thresholds and the existing rule projection/provenance framework for future years. Preserve the current unsupported boundary for unrelated qualified dividends, special-rate gains, short-term sales, preexisting capital-loss carryforwards and discretionary sales outside this ADU funding flow. Generated supported sales alone must not trip that boundary.

For this first planning model, report realized losses but assume no deduction, offset or carryforward benefit from them: annual taxable generated gains equal `sum(max(0, event realized gain))`. A loss event does not offset another generated gain. Apply this explicit no-loss-benefit assumption consistently across the generated sales. This keeps a declined account calculable without claiming unsupported capital-loss tax savings. Tax estimates and their coverage labels must disclose the assumption. The account's remaining basis is still reduced by the actual proportional basis consumed.

Sources to retain in the rule/source register and independent fixtures:

- [IRS Publication 550](https://www.irs.gov/publications/p550): investment basis, holding periods and gain/loss characterization.
- [IRS Revenue Procedure 2025-32, section 4.03](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf): 2026 married-joint zero-rate threshold $98,900 and 15% threshold $613,700.
- [IRS Form 6251 instructions](https://www.irs.gov/instructions/i6251): capital-gains calculation under AMT.
- [IRS Topic 559](https://www.irs.gov/taxtopics/tc559): NIIT includes eligible stock gains; its 3.8% rate and married-joint $250,000 MAGI threshold are already represented by the engine.
- [California FTB capital gains and losses](https://www.ftb.ca.gov/file/personal/income-types/capital-gains-and-losses.html): California taxes capital gains at ordinary rates.

## Sale amount and tax reserve

For the owner-funded construction payment `C`, solve for a sale `S` satisfying:

```text
S − incremental household income tax caused by the sales >= C
```

The tax-covering portion of the sale also realizes gains. Recalculate household tax as the candidate sale changes. Use the same year's facts, opening tax state, funding cash schedule and allocation policy for baseline and trial calculations. The tax baseline retains construction, rent and the cash transfers but excludes the generated sale gains from tax facts. It is a zero-gain tax counterfactual, not the no-build projection or a cash-starved scenario with the transfers deleted. Reevaluate income-dependent contribution eligibility in each tax case.

Coordinate all stages in a tax year and all projects sharing an account. Attribute the annual incremental tax back to events in stable chronological order using differences between cumulative sale scenarios; retain signed tax differences so the final annual reconciliation is exact. Do not compute each stage independently against an unchanged account or tax bracket.

Each trial starts from identical immutable opening balances, basis and tax history. Coordinate sale amounts with existing cash allocation and contribution eligibility, then verify the accepted amounts with a complete final household/account calculation. Seek the smallest sufficient cent-settled sale within available funds; selling the whole account when a smaller amount suffices is not acceptable. Use deterministic iteration limits and explicit reconciliation checks. Do not assume strict monotonicity across tax rounding and contribution thresholds. Verify the final covering candidate and its lower-cent boundary with the authoritative calculation. Accept a covering result using the inequality rather than requiring an exact fixed point; retain any rounding surplus as household cash. Do not publish a trial as a funded result when its final tax or available account balance differs.

Reserve incremental sale tax from the proceeds in the sale month. This is a planning reserve, not an assumption about brokerage withholding or actual estimated-tax dates. Allocate baseline household income tax with the existing timing policy; replace its sale-related increment with this explicit timing, so tax is charged once and is not spread into months before the sale.

If the account cannot cover construction plus the estimated tax, sell no more than its available value, show the cash actually supplied and the remaining funding shortfall, and retain numeric conditional projections. Do not invent borrowing, spend future contributions, make the account negative, or automatically switch to another account. A solver failure must produce a specific funding-calculation explanation rather than the generic save failure.

## Cash flow, allocation and comparison

Post sale proceeds as an investment-to-cash transfer. Keep earned income and the original income-before-investment cash-flow definition separate from this transfer. Count construction spending once and household income tax once.

The account-funded construction payment and associated tax reserve consume the sale transfer. They must not also reduce the ordinary income pool available for investing, and the gross proceeds must not be offered to the allocation policy as a new recurring surplus. Offset only expenses actually supplied by the transfer; never add back the entire intended construction payment when the account supplies less. A cash-budget invariant is `allocation budget = existing before-investment cash flow + financed cost paid + gross sale proceeds - residual sale cash`. Residual is any covering-sale surplus after construction and its signed incremental tax; it stays in household cash. An insufficient sale has no residual, so the remaining construction or tax deficit still reduces the investment budget. Loan-attributed cost remains covered by the existing loan contract. Any funding shortfall retains the existing conditional-on-gap behavior.

Extend funding reports with gross investments sold, basis consumed, estimated gain/loss, incremental tax reserved, net cash for construction, remaining account balance/basis and any shortfall. Show these in the ADU summary and account details. Annual flows reconcile with monthly postings.

The selected-project no-build comparison removes only that project's sales and construction activity. It independently recalculates all remaining projects, account growth, taxes and allocation. It must show both the retained investments in the no-build case and the appreciated property value in the build case. Owner commitment/payback continues to count construction and sale-related tax as owner cost; the transfer itself does not create a zero-cost ADU.

## Property value and appreciation invariant

The completion valuation is separate from construction cost, financing and tax basis. Add it exactly once to the original property's value after the completion month's existing-home growth. Carry the combined value into following months and use the same property appreciation rate, including annual overrides. Do not add the construction cost or sale proceeds again to property value.

For example, a $212,000 completion value adds $212,000 to property equity at completion before any debt effect. With a 3% effective annual appreciation rate and no override, that added component becomes $218,360 after twelve subsequent growth months. The original home continues to appreciate on its own existing balance.

Verify this existing behavior with focused regression tests, including a future annual override. A change is necessary only if those checks expose a gap.

## Verification contract

Use synthetic account/household data and independent expected arithmetic. Do not copy the user's exported household into fixtures.

Cover zero gain, known gain, unknown-basis labeling, loss-sale no-benefit behavior, exact full liquidation, federal bracket crossings, NIIT thresholds, AMT and QBI treatment, tax on the extra tax-cover sale, staged/year-boundary payments, contributions and growth, partial loan funding, two projects sharing an account, insufficient funds and immutable trial state.

Reconcile opening assets plus growth and deposits minus sale with closing assets; opening basis plus deposits minus consumed basis with closing basis; and sale proceeds minus reserved tax with construction cash supplied. Assert taxes, cost and transfers are counted once in household cash/net worth and in the no-build comparison.

Browser checks select a saved brokerage from the simple ADU form, enter account basis through the account editor, save, inspect the funding estimate and future balances, switch scenarios, export and reload. Existing projects without account funding retain their exact results. Run relevant engine/browser tests, full unit tests, TypeScript/build checks and the affected browser workflows before claiming completion.
