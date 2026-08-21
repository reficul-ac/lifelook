# Retirement Scenario Projections

## Purpose

Extend the Retirement tab from a point-in-time comparison into a compact multi-year retirement analysis without duplicating Plan assumptions or cluttering the primary experience.

The tab will continue comparing two scenarios:

1. Keep all homes.
2. Sell all homes at retirement.

The two overview cards become scenario selectors. The selected card controls a single annual projection table below the summary. Home-sale assumptions are completed inside the Sell all homes card, but remain part of the underlying home or planned-property record so Plan and Retirement share one source of truth.

## Scope

Retirement-specific settings are:

- household retirement month;
- fixed annual withdrawal rate;
- retirement horizon in years, defaulting to 30 and accepting 1 through 60;
- one taxable investment account that receives sale proceeds and annual surplus and funds initial shortfalls;
- an optional account withdrawal-order override;
- the selected overview scenario.

The retirement horizon is independent of the active Plan's display horizon. The projection extends active Plan assumptions as far as the retirement horizon requires. Recurring entries and assumptions continue only according to their configured start and end dates; the retirement projection does not invent activity after an explicit end date.

All retirement settings persist across navigation. When exactly one eligible taxable investment account exists, it is selected automatically. When several exist, the user selects one. When none exist, the projection is unavailable and directs the user to create an appropriate account.

The projection includes the full existing housing-cost model: mortgage principal and interest, property tax, insurance, HOA dues, and maintenance. It does not introduce Monte Carlo analysis, required minimum distributions, Social Security claiming optimization, Roth conversions, or other retirement strategies.

## Architecture

Evolve the current retirement snapshot domain into one retirement projection boundary with two layers.

### Retirement setup

The setup layer:

- creates the retirement-date balance sheet from the active Plan;
- stops household employment before the retirement month while retaining income already earned;
- values accounts, homes, other assets, and liabilities at the retirement cutoff;
- excludes compensation that does not vest before retirement;
- normalizes current and planned homes into a shared property representation;
- resolves home-sale facts from their authoritative Plan or asset records;
- derives primary-residence exclusion eligibility when the stored history proves it;
- returns a concise confirmation requirement when eligibility cannot be derived;
- constructs the default age-aware account withdrawal order.

### Annual simulation

The annual layer receives the normalized setup and calculates both `keep-homes` and `sell-all-homes` result series. Both overview headlines and the annual table must come from these results. React must not reproduce financial formulas.

The implementation should reuse the existing Plan projection, tax, home-sale, property, mortgage, and account primitives. Shared primitives may be improved where necessary to support a longer retirement horizon or account-specific withdrawals, but unrelated Plan behavior must not change.

## Data Ownership

Home-sale information has one source of truth.

- Current-home edits update the underlying asset record.
- Planned-home edits update the corresponding property event in the active Plan scenario.
- Retirement does not persist private copies of basis, appreciation, selling costs, acquisition dates, depreciation, or exclusion answers.

The Sell card prefills every fact it can obtain from the current Plan and balance sheet. Derived values are visibly identified. Only missing or genuinely uncertain facts require user input.

Primary-residence gain-exclusion eligibility is derived from purchase date, sale date, primary-residence status, and known rental or occupancy transitions when those facts are sufficient. When the record cannot establish eligibility, Retirement asks one concise question and stores the answer in the authoritative home-sale assumptions.

## Interface

### Header controls

Keep the header compact. It contains:

- retirement month;
- withdrawal rate;
- years in retirement;
- shared taxable destination account;
- active Plan context;
- a collapsed Withdrawal order control.

The withdrawal-order control shows the automatic order by default and supports a compact reorder override. It must explain why an account is deferred or carries a possible tax or penalty consequence.

### Scenario overview cards

The Keep homes and Sell all homes overview cards are large accessible selectors. Clicking anywhere on a card selects it. The selected card has a clear outline and selected indicator and exposes an `aria-pressed` state.

Both cards continue showing their headline figures so the scenarios remain immediately comparable. Selecting a card changes only the table below; it does not hide the other overview.

### Sell-home details

The Sell card contains a compact Sale details area listing each home, its exact projected sale value, and its readiness status. Complete homes require no interaction. Missing or confirmable facts appear inline beside the affected home.

An Edit details disclosure exposes acquisition date, basis, selling costs, accumulated depreciation, exclusion eligibility, and other required sale assumptions. Values sourced from Plan are labeled accordingly. Saving edits updates the authoritative current-home asset or planned-property event.

### Annual projection table

One table appears below the overview and follows the selected scenario. Its primary columns are:

- year and household age;
- starting portfolio;
- pre-tax withdrawal;
- estimated taxes;
- after-tax income;
- Plan and housing expenses;
- surplus or shortfall;
- ending taxable destination-account balance;
- ending total net worth.

Compact row details identify other income, rental income, home costs, account withdrawal sources, penalties, home-sale proceeds, and sale taxes without permanently widening the table. The Sell scenario's first year identifies sale proceeds and sale tax. The Keep scenario identifies rental income within pre-tax cash flow.

On narrow screens, the table remains horizontally scrollable with the year column kept understandable. Controls and cards stack without introducing subtabs.

## Projection Rules

### Retirement cutoff

Retirement begins before activity in the selected retirement month. The opening balance sheet is the end of the preceding month. Household employment income and future employment vesting stop at retirement. Non-employment activity continues according to the active Plan.

### Annual sequence

Each retirement year uses the shared projection engine's monthly timing and aggregates the result annually. Conceptually, it performs these operations:

1. Begin with account, asset, and liability balances.
2. Apply configured investment returns, asset appreciation, recurring non-employment activity, rental income, and housing costs.
3. Calculate the fixed withdrawal target from the saved withdrawal rate and that year's starting eligible portfolio.
4. Source the withdrawal through the effective account order.
5. Estimate taxes and early-distribution penalties from the actual account types and owners used.
6. Compare total after-tax income with Plan and housing expenses.
7. Deposit surplus into the selected taxable investment account or draw a shortfall from it.
8. If that account cannot cover a shortfall, continue through the effective withdrawal order and warn about forced or penalty-bearing withdrawals.
9. Apply mortgage principal payments to mortgage balances and calculate ending account balances and net worth.

The annual withdrawal target is recalculated from each year's starting eligible portfolio. It is not a dollar amount fixed from the first year. Pre-tax income disclosures include the fixed portfolio withdrawal and applicable non-employment or rental income; the table keeps the portfolio-withdrawal column separately identifiable.

A portfolio withdrawal is a transfer from invested balances into spendable cash, not new household wealth. Net worth changes only through returns, appreciation, income from outside the balance sheet, taxes, expenses, debt amortization, sales, and other modeled activity.

### Withdrawal order

The default order is age-aware and account-specific. For this version, it favors taxable funds while an account owner is younger than 59½, generally defers pre-tax retirement accounts until age 59½, and preserves Roth assets last. It does not model special statutory exceptions to the general early-distribution penalty. The ordering and age rules must be centralized in a pure domain function and disclosed in the UI.

The user may override account priority. The override changes sourcing order but does not suppress applicable income tax or early-distribution penalties. Account ownership must be respected when evaluating age-based treatment.

### Keep all homes

Homes continue to appreciate using their existing assumptions. Known rent and ADU revenue continue according to Plan dates and growth. Mortgage principal and interest, property tax, insurance, HOA dues, and maintenance are included in annual expenses. Principal payments reduce the associated mortgage balance.

Home equity remains part of net worth but is not eligible withdrawal capital.

### Sell all homes

Every home is sold in the retirement month at its exact projected valuation; no additional sale-price haircut or premium is introduced.

For each home:

```text
net home proceeds = projected sale value
                  - selling costs
                  - attached mortgage payoff
                  - allocated incremental sale tax
```

All home sales in the month are evaluated together for tax purposes. Available primary-residence exclusions, taxable rental gains, depreciation recapture, filing status, pre-retirement income, and applicable federal and California rules feed the incremental sale-tax calculation.

Aggregate net proceeds are deposited into the selected taxable investment account. Home appreciation, rental income, mortgage payments, and all other home expenses stop after sale. Sold homes and paid mortgages no longer appear in subsequent net worth.

## Taxes and Account Balances

The projection estimates taxes from the actual sources used in each year rather than applying one effective rate to all withdrawals.

- Taxable-account sales use available cost basis to estimate realized gains.
- Pre-tax retirement distributions are ordinary income and receive any applicable early-distribution penalty.
- Roth distributions use stored contribution basis, account age, and owner age where supported by existing data.
- Rental and other non-employment income retain their existing Plan tax treatment.
- Home sales use the incremental home-sale tax calculation so ordinary retirement-year tax is not charged twice.

If a tax treatment cannot be supported by available data, the engine returns a structured issue and avoids presenting a falsely precise after-tax result.

## Results and Warnings

Each annual row returns balances, cash-flow components, tax components, withdrawal sources, property details, and structured warnings. Important warnings include:

- missing or deleted taxable destination account;
- missing home-sale or tax input;
- forced early retirement-account withdrawal and estimated penalty;
- depleted account or portfolio;
- spending that cannot be funded;
- a recurring income or expense stream ending;
- a calculation failure tied to a specific year.

Keep-home results remain available when Sell data is incomplete. The Sell card lists issues per home. If the user selects an unavailable Sell scenario, the table shows an explanatory unavailable state and never displays a partial or stale series.

Projection errors clear stale financial figures. Persistence conflicts retain the user's draft and provide the existing retry behavior.

## Persistence

Extend the retirement settings record with:

- `horizonYears`;
- `taxableDestinationAccountId`;
- `withdrawalAccountOrder`;
- `selectedScenario`.

Existing retirement records migrate deterministically to:

- 30 years;
- the sole eligible taxable investment account when exactly one exists, otherwise no selection;
- automatic withdrawal order represented by an empty override;
- `keep-homes` selected.

Migration must remain idempotent. A removed destination account produces a visible unresolved setting rather than silently selecting among multiple alternatives.

## Testing

### Domain tests

Cover:

- retirement-month cutoff and prior-month handoff;
- 1-, 30-, and 60-year horizons independent of Plan display horizon;
- employment ending while valid non-employment activity continues;
- annual withdrawal target recalculation;
- owner-age transitions and penalty-free eligibility;
- automatic and overridden account order;
- taxable basis, pre-tax, Roth, and early-distribution tax treatment;
- surplus deposits and taxable-account growth;
- shortfall draws, fallback withdrawals, and unfunded spending;
- exact projected home sale values;
- simultaneous sales, selling costs, mortgage payoff, exclusions, depreciation recapture, and incremental tax;
- sale proceeds entering the selected taxable account;
- continued appreciation, rental income, full housing costs, and mortgage amortization when homes are kept;
- ending account, debt, and net-worth reconciliation;
- explicit activity end dates during an extended retirement horizon;
- structured missing-data and per-year warning results.

### Component and persistence tests

Cover:

- compact settings controls and 30-year default;
- automatic sole-account selection and multiple/no-account states;
- persisted selected scenario and visible card outline;
- keyboard and screen-reader card selection;
- table switching without changing overview values;
- automatic withdrawal order and compact override editing;
- conditional per-home sale fields;
- inferred eligibility and required confirmation;
- current-home and planned-property edits updating the shared source;
- Sell unavailable state without affecting Keep results;
- responsive table behavior;
- autosave, revision conflict, deletion, and retry behavior;
- regression coverage for existing Plan and retirement snapshot calculations.

## Acceptance Criteria

The feature is complete when:

1. The two overview cards are directly selectable and the selection persists.
2. A single annual table displays the selected scenario for 1 through 60 retirement years.
3. The table reconciles pre-tax withdrawal, estimated taxes, after-tax income, all Plan and housing expenses, surplus or shortfall, destination-account balance, and total net worth.
4. Surplus and home-sale proceeds enter the selected existing taxable investment account; shortfalls draw from it before falling through the withdrawal order.
5. The default withdrawal order changes appropriately with owner age and can be overridden compactly.
6. Sell-home inputs appear inside the Sell card, reuse existing information, and update the shared Plan or asset source.
7. Home sales use exact projected values and stop all subsequent home income, expenses, assets, and debts.
8. Kept homes retain appreciation, rent, full housing expenses, and correct mortgage amortization.
9. Missing information produces actionable, scoped unavailable states rather than fabricated results.
10. Both overview and table values come from the same pure retirement projection boundary.
