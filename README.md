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

## Enter, save and recover a plan

Household, Income, Expenses and Debts, Investments, and Properties contain labeled native controls. Each record has its own Save action; dated raises, appreciation overrides and related tax history are saved together. Boolean histories use **Unknown / Yes / No**. Other histories retain an explicit Unknown choice; required numeric blanks are errors. Confirmed zero and unknown remain distinct. Advanced property and rental histories start closed with status summaries; failed saves reveal the affected field. Mortgage opening balances can use a labeled schedule estimate or an entered known value.

A valid Save updates the in-memory input revision, recalculates, and attempts local persistence. Invalid drafts retain their text while the projection remains tied to the last saved input revision. Removing a referenced salary, account, property or loan requires resolving the references first.

Save validates effective shared and loan allocations and calculates the candidate projection before replacing saved state. A property draft includes its linked rental and expense records. If another Save changes one of those records, the older draft is retained and its Save is rejected. Use the record's **Discard edits** action, then reapply changes to the newer saved inputs. Unrelated drafts and saves remain independent.

Plans retain JSON schema version 1 and browser storage key `lifelook.foundation.plan.v1`. Browser storage belongs to the current origin: development on port 1421 and preview on port 4174 have separate saved plans. Use export and restore to move a plan between origins. Download a backup to retain the current in-memory inputs and revision. Backups contain applied inputs and exclude record drafts and calculated results; results are recalculated with this package's rule version. An accepted restore replaces all inputs and discards record drafts. Restore validates the entire document before replacement. Malformed JSON, unsupported schema versions and invalid references leave the current plan intact. Corrupt stored documents remain recoverable instead of being silently overwritten.

The former desktop application's SQLite profiles and `.lifelook` backups are not imported by this JSON format. Removing its source code does not delete existing device data or backups. Keep those files separately; enter a new plan or restore a compatible browser JSON backup.

Storage read/write and quota failures are visible. A failed write leaves the valid in-memory plan available as Unsaved and exportable; downloading its backup does not require a successful local-storage write. A valid restore that cannot persist likewise retains an exportable in-memory plan. Recovery warnings and export actions stay visible through edits, adds, discards and rejected Saves until a successful storage write resolves them. Ordinary editing does not announce a save; operation outcomes have a separate status announcement.

## Read the projection

Annual rows sum flows and use December balances. Show months expands individual settled movements; account, property and loan detail shows opening amounts, deposits/payments, growth and closing amounts. Tax explanation shows legal federal/California deduction comparisons, actual selected methods, assessed versus paid California tax, separate AMT/NIIT/surtax components, contribution limits, rental allocations and carried loss state.

Income-tax liabilities are reserved over months using positive gross cash-income weights, or equal monthly amounts when positive income is zero. Employee payroll follows cumulative wages. Contributions are legally eligible planned deposits, including when cash is insufficient; prevented contributions stay in cash. Without a cash flow allocation policy, surplus remains in cash. The engine does not add borrowing, sell assets or invent retirement withdrawals. Once a cash gap occurs, later balances remain conditional on funding it. Asset growth changes value without creating spendable cash.

An available zero is displayed as money. Missing or unsupported dependent amounts display **Needs data** or **Unsupported** without a numeric placeholder. Hover or keyboard focus shows a short preview; click, Enter/Space or tap opens full causes, affected periods and review actions. Escape or Close dismisses details. Repeated causes are grouped while retaining each field, record and earlier year. Independent income, loan, property or account schedules remain visible. Ratios use aggregate annual income; known zero-income ratios show **N/A · no income** while the underlying dollar amounts remain available.

Rule provenance and household coverage are separate. Verified, provisional and projected component labels identify the actual sources and assumptions. Modeled completeness, household tax completeness and funding status remain separate. Numeric deduction candidates are labeled as modeled inputs when household tax is incomplete. **How calculated**, **Forecast assumptions**, sources, tax calculation steps, comparisons, contributions and independent rental books are available in optional sections. A modeled contribution/growth scenario can remain available while distribution-dependent total household liability is incomplete. Material unmodeled income or credits, unknown relevant histories and monetary overflow prevent affected totals from being treated as complete.

For a qualified acquisition mortgage with complete proceeds history, scheduled opening balances and payments can support forecast mortgage deductions, taxes and cash flow. The loan editor and tax explanations retain the estimate notice; entering confirmed opening amounts refines the forecast. Missing qualification history or annual balance evidence still blocks the affected deductions.

The annual financial overview shows year-end net worth, total income including RSU compensation, cash income excluding retained stock, post-tax cash income, expenses and cash flow before investment contributions. Post-tax income credits RSU withholding against modeled taxes, and expenses include full mortgage and debt payments. Interactive plots show net worth and the income/expense comparison, with a year picker, keyboard navigation and series toggles. Missing amounts remain unavailable in the table and leave gaps in plots.

## Cash flow allocation

In **Investments**, use **Cash flow allocation** to set total account targets with an exact percentage or its slider. Every percentage uses the same year's cash flow after modeled taxes, expenses and debt payments, before investment transfers. Opening cash reserves, retained RSUs and asset growth are outside that budget. Eligible existing deposits count toward each account's target; their saved amounts and dates stay intact, and allocation funding fills only the remaining target.

New investment funding is spread across monthly installments rather than deposited at year end. Full-year funding uses the annual amount divided by twelve, with cumulative cent rounding that preserves the annual total. Deposits enter at month end and grow from the following month. Monthly cash availability, sponsoring wages and legal eligibility can require a different schedule; annual funding priorities and existing deposit dates remain protected. Traditional 401(k) contributions reduce modeled federal and California income tax, and allocations recalculate against the resulting cash flow. Roth contributions retain their after-tax treatment.

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
