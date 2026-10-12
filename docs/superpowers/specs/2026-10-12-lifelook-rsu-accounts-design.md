# LifeLook RSU accounts and vesting

LifeLook will support employer RSU accounts containing independent initial and refresher grants. Each grant has its own award value, award share price, vesting start, term, frequency, cliff and sell-to-cover percentage. Delivered shares increase assets without creating spendable wage cash; taxable compensation feeds the existing federal, California and employee payroll calculations.

## Scope and tax treatment

The supported tax path is ordinary employee RSUs delivered at each vest, with full-year California residence and the existing married-joint tax model. Granting an RSU is distinct from delivering vested stock. Compensation is the delivered shares' fair market value; the award reference price determines units and is not an exercise price. Sell-to-cover is assumed to occur at that same price, with no transaction fee or capital gain. Its proceeds fund the modeled tax reserve, while final assessed liability uses combined salary and RSU wages. The percentage entered is a withholding assumption, not a tax rate.

Deferred settlement is an explicit alternative. Its time-vesting schedule remains visible, but dependent household taxes and cash are unsupported: income-tax and FICA timing can differ, and this implementation will not invent an IPO date or assume every tax waits until liquidity. Deferred grants with nonzero opening holdings require gross prior settlement history beyond this contract and are rejected. Options, 83(i) elections, residency allocation, later discretionary sales, capital gains and 409A penalties remain beyond this feature.

Sources reviewed October 12, 2026:

- [IRS RSU audit guide](https://www.irs.gov/pub/irs-pdf/p5992.pdf): vesting and settlement may differ; stock delivered in ordinary RSU settlement is compensation. This guide is explanatory, not a legal pronouncement.
- [IRS Publication 15](https://www.irs.gov/publications/p15): employee payroll and supplemental withholding; withholding differs from final liability.
- [IRS Publication 15-A](https://www.irs.gov/publications/p15a): deferred compensation payroll timing.
- [IRS Publication 551](https://www.irs.gov/publications/p551): compensation establishes stock basis.
- [FTB Publication 1004](https://www.ftb.ca.gov/forms/misc/1004.html): California equity compensation and residency scope.
- [EDD wages](https://edd.ca.gov/en/payroll_taxes/What_Are_Wages): covered employee noncash compensation.

## Stored contract

Keep schema version 1 and existing account fields for old backups. Add account type `rsu`, requiring `openingBalanceCents: 0`, unknown IRA basis and an `rsu` object. Other account types cannot carry RSU data. Generic contributions cannot target RSU accounts.

`RsuAccountDetails` contains `employerId`, `currentSharePriceCents` and `grants`. The price is the valuation assumed on January 1 of the forecast start year. Account `annualGrowthBps` grows this share price as an effective annual assumption, including before a future grant begins. Current valuation never changes the grant's awarded units.

`RsuGrant` contains globally unique `id`, `name`, `startDate`, `grantValueCents`, `grantSharePriceCents`, optional `awardedShares`, `vestingMonths`, `vestingFrequency` (`monthly`, `quarterly`, `annual`), `cliffMonths`, `withholdingBps`, `taxTreatment` (`settle-at-vest`, `deferred`), `openingHeldShares` and `openingBasis: History<Cents>`. Award value and grant price are positive integer cents. Awarded units default to their Decimal quotient; an actual awarded-share override can specify up to six decimal places. Opening held shares are actual net shares remaining immediately before forecast start, not a reconstructed withholding estimate, and cannot exceed scheduled vesting strictly before forecast start. Opening basis may remain explicitly unknown without preventing value forecasts.

## Schedule and valuation

Vesting starts after the first interval, with dates anchored to the original start day and clamped in short months. Frequencies correspond to 1, 3 and 12 months. Vesting is linear over the term; a cliff catches up all earned units on its date. A final partial interval completes the award, and cumulative Decimal quantities preserve the full grant. Grant-level fractional monetary remainders carry across forecast months, including year boundaries; emitted monthly cents reconcile to rounded cumulative compensation and withholding. Events before forecast start establish remaining unvested units but never generate current wages or duplicate the entered opening holding.

Share price at each event compounds by whole months plus the elapsed fraction of that event's month from forecast January 1. Month-end holding value uses the next month's opening price. Only delivered shares held after withholding enter net worth. Remaining unvested and deferred unsettled units are shown separately and excluded from available assets. Known basis grows by the value of retained delivered units. Changing prices creates unrealized growth, not cash.

## Engine interfaces

Create `src/engine/equity/rsu.ts` with `rsuVestingEvents(grant): readonly RsuVestingEvent[]` (`date`, `shares`), and `projectRsuAccounts(plan): RsuProjection` (`months`, `issues`). Each `RsuGrantMonth` has `accountId`, `grantId`, `year`, `month`, `openingValueCents`, `growthCents`, `vestedShares`, `withheldShares`, `heldShares`, `unvestedShares`, `unsettledShares`, `vestedValueCents`, `taxableIncomeCents`, `withholdingCents`, `closingValueCents`, `unvestedValueCents`, and `basis: History<Cents>`. Monetary values are cents; share values are Decimal-derived numbers. An unvested paper valuation overflow returns `unvestedValueCents: null` with `unvestedValueIssue`, preserving independent taxable flows and held balances. Lifetime rounding bookkeeping stays Decimal; monetary limits apply to reported monthly and annual amounts. Issues identify the parent account and an actionable input field.

The projection integrates RSU wages by owner/employer into a derived tax `CashYear`, keeping its cash streams and cash-income totals separate. Payroll caps apply to combined wages per owner. Gross reported income includes taxable RSUs; cash flow excludes noncash compensation and credits sell-to-cover funding against the tax reserve. Annual income-tax reserve weights include cash income and taxable RSU compensation, so a pure RSU household reserves tax in vesting months. This remains an assessed-liability planning reserve, not an actual payroll remittance/refund timetable.

Existing account projection balances include held RSUs. RSU vesting is not a cash contribution. Monthly and annual projections optionally include `rsu: Available<RsuPeriod>`; absent RSU accounts preserve the previous output shape. `RsuPeriod` contains `taxableIncomeCents`, `withholdingCents`, `unvestedValueCents`, `grants`, whose monetary values remain raw validated cents from the independent schedule. Annual periods sum flows and use December quantities, values and basis. Independent vesting schedules remain visible when tax coverage is unsupported.

## Browser and validation

Investments gains an RSU account option with nested grant rows and readable computed awarded units, final vest date and years left at forecast start. Expose the requested amount, prices, dates, monthly/quarterly/annual choice, growth and withholding fields, plus optional cliff and actual opening holdings. Each account saves all grants together through the existing draft and backup paths. Source and tax assumptions belong in optional explanatory details. Invalid nested values identify their exact grant input. Grant issues route to the account form. Changing an account with linked cash contributions to RSU fails until references are resolved.

Projection asset detail adds grant-specific vested, withheld, held, unvested and unsettled shares, taxable compensation, withholding funding, retained value and basis. RSU account flows use vesting terminology. Show annual and monthly detail, and distinguish paper unvested value from held assets.

## Verification

Test independent overlapping grants, prices and actual share overrides, cliffs, partial intervals, leap/month-end anchors, before-forecast vesting, annual end boundaries, negative/positive growth, 0/100% withholding, monetary overflow and deferred coverage. Compare an RSU scenario to equivalent cash wages for federal/California/payroll liability while independently asserting cash and asset conservation. Browser checks cover editing/saving multiple grants, precise invalid-field feedback, contribution rejection and backup compatibility. Complete `npm run check` and engine tests in America/Los_Angeles.
