# Retirement Snapshot Redesign

## Purpose

Replace the existing retirement forecast with a clean point-in-time answer to one question: what would the household's finances look like if everyone retired in a selected month?

The tab will show two concise scenarios:

1. Keep all homes.
2. Sell all homes at retirement.

This is a fresh design. The existing retirement runway, budgets, scheduled income, withdrawal ordering, readiness verdict, tax-ledger detail, charts, and annual projections will not drive the new experience.

## Scope

The Retirement tab has two user-controlled inputs:

- Retirement month in `YYYY-MM` form.
- A shared withdrawal rate, defaulting to 3%.

The retirement month applies to the entire household. Retirement begins at the first instant of that month. Individual retirement dates and scenario comparison are deferred.

The tab always evaluates the active Plan scenario. It does not include a separate scenario selector and does not mutate the Plan scenario by adding a retirement event.

This version reports annual pre-tax income. It does not estimate post-tax retirement income, spending power, portfolio longevity, safe-withdrawal success, or retirement expenses.

## Architecture

Introduce a dedicated `calculateRetirementSnapshot` domain calculator. It receives a normalized point-in-time balance sheet, household and tax information, active Plan assumptions, retirement month, and withdrawal rate. It returns the results and calculation details for both scenarios.

The calculator must not depend on React or repository persistence. The view will not reproduce financial formulas. This boundary keeps the cutoff, vesting, property-sale, tax, and income rules independently testable.

`RetirementView` will be responsible only for:

- editing the retirement month and withdrawal rate;
- autosaving those inputs;
- invoking the calculator with the active Plan scenario;
- rendering the two scenario stories and their calculation disclosures;
- presenting unavailable and projection-error states.

The existing retirement-specific forecast stack will be removed wherever it is no longer referenced. This includes the retirement outlook, runway simulation, retirement-only annual tax forecast, retirement budgets and income schedules, withdrawal sequencing, readiness result, balance chart, and yearly result table. Shared Plan projection and tax primitives remain and should be reused.

## Retirement-Month Handoff

Retirement in a selected month begins before any activity in that month. The balance sheet therefore comes from the end of the preceding month.

The calculator will derive a retirement-aware projection from the active Plan scenario:

- All household employment income stops before the retirement month.
- Employment income and taxable compensation earned before retirement remain included.
- Non-employment activity remains governed by the active Plan as needed to settle the pre-retirement snapshot.
- Only RSUs vested by the cutoff are included. Future vesting is excluded because employment has ended.
- Other assets retain their projected cutoff values. This version does not add finer liquidity classifications for vehicles, collectibles, or private-company interests.

Plan currently calculates monthly balances and allocates estimated annual tax across income-producing months. The retirement-aware run must recalculate the retirement calendar year using only income earned before retirement. The prior-month ending balance must therefore reflect the tax burden associated with pre-retirement wages and vested compensation, without retaining taxes attributable to employment income that will no longer occur.

## Common Balance Sheet

At the retirement cutoff:

```text
net worth = account balances + vested/owned asset values - liability balances
```

Unvested RSUs and other compensation that would vest after retirement are excluded.

For each home:

```text
home equity = projected home value - attached mortgage balance
```

Non-mortgage liabilities, including credit cards and personal loans, remain part of the balance sheet and reduce the withdrawal base in both scenarios.

## Scenario 1: Keep Homes

The keep-homes scenario does not treat home equity as withdrawal capital.

```text
non-home net worth = net worth - total home equity

withdrawal income = max(0, non-home net worth) * withdrawal rate

gross annual rental revenue = active projected monthly home and ADU rent
                              at the retirement snapshot * 12

annual pre-tax income = withdrawal income + gross annual rental revenue
```

Gross rental revenue is intentional. It does not deduct vacancy, mortgage payments, maintenance, insurance, property tax, HOA fees, income tax, or other expenses. The interface must label it as gross rental income.

## Scenario 2: Sell All Homes

The liquidation scenario automatically sells every home at the retirement cutoff. It does not liquidate stocks, vested RSUs, retirement accounts, or other non-home assets. Those assets remain valued at their cutoff balances. Retirement accounts remain at face value rather than being reduced by an assumed immediate distribution tax or early-withdrawal penalty.

For each home:

```text
net home proceeds = projected sale price
                  - selling costs
                  - attached mortgage payoff
                  - incremental sale tax
```

For the household:

```text
liquid net worth = non-home net worth + total net home proceeds

annual pre-tax income = max(0, liquid net worth) * withdrawal rate
```

No rental income remains after all homes are sold.

### Sale-tax treatment

All homes are treated as sold in the retirement month. The tax calculation must evaluate the sales together because household income and gains can interact across brackets and thresholds.

The sale calculation includes:

- employment and other taxable income earned before retirement;
- gains from all homes sold in the retirement month;
- selling costs when determining sale proceeds and taxable gain;
- available primary-residence gain exclusions;
- taxable rental gains and applicable depreciation recapture;
- the household's existing filing and tax inputs.

Attached mortgages reduce cash proceeds but do not reduce taxable gain.

The amount deducted from home proceeds is the incremental liability caused by the sales:

```text
incremental sale tax = tax liability with simultaneous home sales
                     - retirement-year tax liability without home sales
```

Using incremental liability prevents ordinary pre-retirement income tax from being charged twice. The snapshot itself already reflects the tax burden on income earned before retirement.

## Required Data and Unavailable Results

Total net worth and the keep-homes scenario remain available whenever the cutoff balance sheet can be calculated.

Liquid net worth and its income estimate are unavailable if any home lacks information required for a defensible sale estimate. Required information includes, as applicable:

- acquisition date and tax basis;
- projected sale value;
- selling-cost assumption;
- attached mortgage linkage and balance;
- primary-residence ownership/use data needed for an exclusion;
- rental-use and depreciation information needed for recapture.

The calculator returns structured missing-data issues associated with the affected home and field. It must not silently substitute zero tax or fabricate a partial liquid-net-worth estimate.

## User Experience

The approved information hierarchy is a two-story layout.

### Header

A compact header contains:

- retirement month;
- withdrawal rate;
- concise context that the active Plan is being evaluated.

### Keep-homes story

The first card pairs:

- net worth at retirement;
- estimated annual pre-tax income if homes are kept.

Its collapsed `View calculation` disclosure shows:

- non-home net worth;
- withdrawal rate and withdrawal income;
- annualized gross rental revenue;
- resulting annual pre-tax income.

### Sell-homes story

The second card pairs:

- liquid net worth after selling all homes;
- estimated annual pre-tax income from liquid net worth.

Its collapsed `View calculation` disclosure shows:

- gross home equity;
- selling costs;
- estimated incremental sale tax;
- net home proceeds;
- resulting liquid net worth.

When liquidation cannot be calculated, both headline results in this card show `Unavailable`. The disclosure lists the exact missing inputs for each affected home in actionable language.

### Presentation constraints

The headline figures are the visual focus. The tab will not include a readiness verdict, long instructional paragraphs, subtabs, charts, retirement budget editor, scheduled-income editor, withdrawal-order editor, or annual forecast table.

The implementation will reuse LifeLook's visual language and add focused responsive styles. The two stories may sit side by side when space permits and must stack cleanly in smaller windows. Labels and short help text must make these limitations explicit:

- Income values are pre-tax.
- Rental income is gross revenue.
- Retirement accounts remain at face value in liquid net worth.
- Only homes are sold in the liquidation scenario.

Projection failures produce a compact page-level error and must not leave stale financial figures visible.

## Persistence and Migration

The persisted retirement record will contain only:

- household identifier;
- retirement month;
- withdrawal rate;
- repository revision metadata.

New records default to January of the next calendar year and a 3% withdrawal rate.

For an existing retirement record:

- convert its saved retirement year to January of that year;
- preserve its saved withdrawal rate;
- discard all other legacy retirement settings.

Migration must be deterministic and idempotent. Old fields should not continue through the new domain or UI under compatibility aliases.

## Testing

### Domain tests

Cover:

- retirement starting on the first day of the selected month;
- use of the preceding month-end balance sheet;
- retirement in January, including the prior December handoff;
- stopping employment income for the entire household;
- preserving income earned before retirement;
- excluding RSUs that vest at or after retirement;
- recalculating the retirement-year tax burden without future wages;
- account, asset, liability, home-equity, and non-home-net-worth reconciliation;
- non-mortgage debt reducing withdrawal capital;
- gross rental revenue annualized from the snapshot month;
- zero withdrawal income for a negative withdrawal base;
- simultaneous sale of multiple homes;
- selling costs and mortgage payoffs;
- primary-residence gain exclusions;
- rental gain and depreciation recapture;
- incremental sale tax without double-counting pre-retirement tax;
- structured unavailable results for each required missing-data category.

### View and persistence tests

Cover:

- retirement-month and withdrawal-rate controls;
- the 3% default;
- automatic use of the active Plan scenario;
- autosave and conflict/error behavior;
- migration of legacy year and withdrawal rate;
- both scenario-story cards;
- collapsed calculation disclosures;
- unavailable liquidation state and actionable missing fields;
- compact projection-error state;
- accessible names and disclosure semantics.

### Integration verification

- Update affected end-to-end retirement expectations.
- Verify the application builds and the complete automated test suite passes.
- Confirm removed retirement UI and domain modules have no remaining imports or persistence dependencies.
- Confirm the redesign does not change the stored active Plan scenario.

## Explicitly Deferred

- Different retirement dates for household members.
- Retirement scenario comparison inside the tab.
- Post-tax retirement income.
- Total spending power and retirement expenses.
- Portfolio depletion, longevity, or success probability.
- RMD and withdrawal-order modeling.
- Choosing which homes to sell.
- Immediate liquidation tax for non-home assets or retirement accounts.
- Vacancy and property expense modeling in gross rental revenue.
