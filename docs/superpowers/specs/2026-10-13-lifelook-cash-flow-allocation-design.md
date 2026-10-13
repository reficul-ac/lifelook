# LifeLook cash flow allocation

LifeLook will let a household distribute annual cash flow with an editable pie chart, account rows, percentage sliders, and a percentage remaining readout. A saved policy applies throughout the forecast. Retirement accounts can instead target their annual maximum, and one selected excess account receives unassigned money. Money that the excess account cannot accept stays in cash reserves with a small explanatory note in the annual table.

## Allocation behavior

Each year has one original cash flow total: cash salaries, other cash income and rent, plus RSU withholding that funds taxes, minus modeled taxes, expenses and full debt payments, before investment transfers. This matches the existing annual financial overview. Retained RSU shares, asset appreciation and opening account or reserve balances do not create cash available for this policy.

Every percentage uses this same annual total. A 50% stock allocation and a 50% cash allocation on $100,000 produce $50,000 each. A later row never calculates its percentage from a shrinking remainder. Cash flow can change when tax relevant allocations change; within the resolved year, the pie, forecast, percentage targets and contribution calculations use the same total including final contribution related tax effects.

The annual order is:

1. Count eligible deposits from existing fixed monthly and salary percentage contribution rules.
2. Fund percentage targets, including any explicit Cash / savings target, in visible priority order.
3. Fund annual maximum targets from the remaining cash and remaining legal capacity, in visible priority order.
4. Offer the remaining cash to the selected excess destination.
5. Retain anything that destination cannot accept in cash reserves.

An account percentage is a target for its total annual deposits, including existing contribution rules. The new deposit is the nonnegative difference between the target and eligible existing deposits into that account. Annual maximum funding similarly tops up available capacity after existing deposits. Existing rules keep their saved amounts, dates and eligibility behavior; saving a policy never deletes or changes them. Accounts with existing deposits but no policy row still consume cash and legal capacity and appear in the account totals.

If existing deposits exceed an account's percentage target, preserve those deposits, make no percentage top up, and explain why its actual share exceeds its target. If limited funds prevent another percentage target from being met, preserve the configured percentage and report its actual funded amount and shortfall. This can occur in future years as existing fixed obligations become a larger share of cash flow. Percentage targets receive available funds before any annual maximum target.

For example, if percentages consume 80% and a maximum target requires 30%, the maximum receives at most the remaining 20% and displays Partially funded. A percentage or maximum prevented by an account limit leaves cash available for the excess destination. Do not add prevented amounts to the remainder a second time.

## Future years and excess funding

Store percentage and maximum rules rather than year one dollar amounts or the calculated percentage of a maximum. Resolve cash flow, statutory or projected rule values, age, compensation and eligibility separately for every forecast year. Selecting a year changes the preview, not the scope of the saved policy.

The following illustration assumes an eligible $7,000 IRA limit in both years; it is an example of allocation arithmetic, not a claim about the applicable statutory limit.

| Annual cash flow | IRA maximum | Other account target at 93% | Excess |
| --- | --- | --- | --- |
| $100,000 | $7,000 or 7% | $93,000 | $0 |
| $200,000 | $7,000 or 3.5% | $186,000 | $7,000 or 3.5% |

The excess destination can be a supported investment account or Cash / savings. It can also be an account already receiving percentage, maximum or existing contributions. All funding components share its legal limits and aggregate into one account deposit total. There is one excess destination and one final cash fallback, with no additional destination chain.

When $6,000 remains and the selected account can accept $2,000, deposit $2,000 and retain $4,000 in cash. An already maxed account accepts zero. Retained cash has a reason identifying the destination and the restriction, such as an annual shared limit, Roth income eligibility, sponsoring wage timing or missing eligibility information. Choosing cash deliberately does not generate a failure note.

An explicit Cash / savings percentage is reserved before maximum and excess funding. It is an allocation of money retained in the existing household reserve, not a transfer into a new account. The excess sweep cannot invest this deliberately reserved cash. Cash balances and net worth count reserved cash, ordinary excess cash and refused excess cash exactly once.

## Saved policy and validation

Keep document schema version 1 and the existing browser storage key. Add optional `PlanDocument.cashFlowAllocation`. Absence means the existing projection behavior and result shape; an empty policy with cash as its excess destination is a deliberate cash retention policy. Old backups do not acquire an active policy on load.

The policy contains a globally unique `id`, an ordered `entries` array and an `overflow` object. Each entry contains a globally unique `id`, a nonnegative integer `priority`, a `destination`, and an `amount`. Amount is either `{ kind: 'percent', percentBps }` or `{ kind: 'max-annual' }`. Percentages use integer basis points from 0 through 10,000. The sum of configured percentage targets cannot exceed 10,000; maximum rows are calculated shares and do not participate in that structural sum.

A destination is `{ kind: 'cash' }` or `{ kind: 'account', accountId, sponsoringSalaryId? }`. The overflow object has its own globally unique `id` and a destination so derived requests and reasons have stable identities. Permit at most one entry per account and one explicit cash entry. The overflow destination may repeat an entry's account. Within a policy, repeated references to a 401(k) account must use the same sponsoring salary.

Account references must identify saved accounts other than RSUs. Maximum mode is limited to traditional or Roth 401(k) and traditional or Roth IRA accounts. Cash and taxable brokerage support percentage or excess funding, without a retirement maximum toggle. A 401(k) destination requires an existing sponsoring salary belonging to the account owner, including when it is used only for excess funding. Other destination types reject an irrelevant sponsoring salary.

Validate policy, entry and overflow identities against all other record IDs. Report precise nested field paths. Block removal of referenced accounts or salaries, and block changing a referenced account to RSU until the policy references are resolved. No automatic retargeting, account creation or removal of existing contribution rules accompanies validation or restore.

## Contribution limits

Use the existing retirement rule packs and contribution eligibility functions as the authoritative legal calculations. Traditional and Roth 401(k) deposits share the owner's elective deferral and applicable catch up limits. Sponsoring employer compensation, plan availability and required Roth catch up treatment remain relevant. Traditional and Roth IRA deposits share owner limits and compensation budgets; Roth income eligibility and traditional deductibility remain separate.

Annual capacity must account for all eligible existing, percentage and maximum deposits before offering excess deposits. A low priority number alone cannot establish this ordering because the current tax resolvers process month before priority. An excess request in January must not consume capacity reserved for a primary request in a later month. Funding stages therefore reserve owner regular and catch up limits, joint IRA compensation after traditional workplace reductions, Roth eligibility, and sponsoring monthly compensation, then pass a reconciled monthly request schedule through the existing legal resolvers. A lower stage must not reduce eligible funding reserved for an earlier stage, including existing deposits. Reduce or reschedule the lower stage first when its tax, compensation or shared limit effects would displace earlier funding; do not accept a result merely because the legal resolver capped the earlier requests. For example, traditional 401(k) excess cannot consume compensation reserved for a primary IRA deposit. Recompute all reservations as targets and tax facts change during the annual solve.

Calendar year limits reset each year. Future indexed values follow the saved tax policy and retain the existing projected provenance; they are not advertised as published future law. This feature does not introduce employer matching, backdoor Roth conversions, account withdrawals, new account types or changes to the existing tax coverage boundary.

The baseline pack's 2026 regular limits are $24,500 for employee elective deferrals and $7,500 for IRAs. Age and plan facts can change allowed funding. The IRS also specifies Roth IRA income phaseouts, and confirms that traditional and Roth IRAs share a combined contribution limit. Use the rules at runtime rather than embedding these numbers in controls. References checked October 13, 2026: [IRS 2026 retirement limits](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500), [IRS Roth IRA rules](https://www.irs.gov/retirement-plans/roth-iras), and the repository source register at `sources/register.md`.

## Annual calculation and monthly funding

Introduce a focused allocation module under `src/engine/cash/`. It accepts the saved policy, resolved cash streams and rules, existing requests, opening tax state, relevant loan and property facts, and the household tax resolver. It returns the final household calculation, monthly allocation requests and a reconciled annual allocation report. Browser, storage and clock access remain outside the engine.

Represent account funding as derived contribution requests with stable policy entry or overflow identities. A validated internal plan adapter supplies the account, owner and sponsoring salary links expected by existing tax functions. Internal adapter rules are not saved or exported and are not generated again by the legacy request scheduler. Remove the policy from an adapter document before validating synthetic rules so its source IDs are not registered twice. Translate derived issues back to policy field paths for review navigation.

Taxes and allocation amounts depend on each other. Resolve them together with a deterministic annual solver rather than treating the first tax estimate as final. Start with an existing contributions only scenario, then regenerate percentage, maximum and excess schedules, resolve legal eligibility and taxes, and recompute annual cash flow. All trial passes use the same opening tax state and immutable input facts. They must not deposit funds, change account balances or advance rental, IRA basis or other tax carry state. Carry only the accepted final closing state into the next year.

Bound the solver to 128 passes and detect repeated nonstable states. Acceptance requires identical cent amounts and monthly schedules on a verification pass, agreement between the denominator and final cash flow, legal eligibility of every new funded request, and the funding invariants below. If a state cycles or the bound is exhausted, return an explicit unsupported allocation calculation for affected dependent results. Never present an unconverged estimate as a complete forecast. Independent schedules remain visible, and dependent tax carry state follows the existing interrupted state behavior.

Use Decimal and the existing cumulative settlement helpers for annual targets and monthly schedules. Form unrounded percentage targets and settle them together in stable priority and identity order using cumulative rounding. Report those settled cent amounts without independently rounding them again, and bound allocated cents by the available budget. Two 50% targets on one cent must not each receive one cent. The displayed percentage is derived from actual account funding divided by the accepted original total; rounding displayed percentages never changes requests or cash. Show requested percentages separately when a cap, existing deposit or cash shortfall changes the actual share.

New funding must not spend opening reserves, borrow against later income or create a monthly gap. Preserve legacy rules' existing intentional gap behavior. Given the trial's monthly cash after final modeled taxes, expenses, debts and existing eligible deposits, let `S[m]` be cumulative cash from January through month `m`, and `C` be actual funded explicit Cash / savings. At each month `m`, cumulative new deposits cannot exceed `max(0, min(min(S[k] for k from m through December), S[December] - C))`. This preserves cash needed for known later deficits and prevents investing deliberately reserved cash. Percentage and maximum schedules retain stage priority under this funding envelope. `C` can be below its requested target when existing obligations leave insufficient funds; report that shortfall. Workplace deposits additionally fit remaining sponsoring monthly compensation. Money arriving after a salary ends cannot be contributed to that payroll period retroactively.

If existing funding alone exceeds positive annual cash flow, classify the year as an allocation funding conflict. Make no new top ups or excess deposits, retain the existing signed forecast gap, and show a conflict in place of a misleading normalized pie. If the annual total is zero or negative, request no new funding; show no positive allocation budget and no numeric percentage ratio with a zero denominator.

For an available positive total without a legacy funding conflict, require these equalities:

- Account totals equal eligible existing deposits plus accepted percentage, maximum and excess deposits, with every deposit posted once.
- The original annual total equals all account deposits plus the increase in retained cash from that year's cash flow.
- Retained cash equals actual funded explicit cash allocation plus deliberately selected excess cash plus refused excess cash.
- Monthly funding sums to the reported annual account amounts and preserves both legal limits and the funding envelope.

Maximum targets that cannot be reached because of cash show Partially funded. Known zero eligibility is a numeric zero with its legal reason. Unresolved primary eligibility or taxes make dependent allocation amounts unavailable. If only excess destination eligibility is unresolved while primary funding and taxes are complete, omit its unverified derived requests from the accepted household calculation, retain the known remainder in cash and show an eligibility information note. Record the attempted destination and missing information in allocation metadata instead of passing an unknown deposit into the final tax calculation. Do not imply that a legal cap was reached when its status is unknown.

## Allocation reports

Add optional allocation reports to projections only when a policy exists. Each year reports the original total; per account requested target, existing funding, new percentage funding, maximum funding and excess funding; actual funded shares; cash intentionally reserved; excess offered, accepted and retained; and typed reasons for shortfalls or cash fallback. Monetary dependent fields use the existing `Available` representation. Results keep source policy identities and affected year or month for precise issue review.

Aggregate components into one account slice and one Cash / savings slice. Explain funding components in the legend or account details. The cash slice includes deliberate saving and fallback, with their dollar breakdown available. Pie angles use reconciled dollar amounts, so rounding labels cannot leave gaps or duplicate slices. Zero, incomplete and funding conflict years show a clear text state instead of invented wedges.

Provide an annual contribution allocation table alongside the forecast, showing account amounts, actual shares and cash retained. A small info marker beside cash retained for a failed excess deposit uses the existing disclosure controller. Hover or keyboard focus shows a short cause; click, Enter, Space or tap opens the amount, destination, affected year and review action. Note text distinguishes confirmed legal caps, compensation timing and missing information. Ordinary cash saving has no failure marker.

## Editor and persistence

Place the editor above existing contribution forms in Investments. Include Add allocation, destination selection, labeled range sliders and exact percentage inputs, annual dollar previews, Remove, and a retirement only Max out for the year checkbox. Maximum rows show an automatic dollar amount and share in place of an editable percentage. Visible priority controls order maximum rows and percentage funding independently of the amount input. Account rows show existing planned deposits included in their target.

The year selector initially displays the forecast start year and can preview any forecast year. Changing it never saves a per year override. Show the percentage and dollars left after primary allocations, followed by where the excess will go; automatic excess routing does not hide the amount that required routing. The Excess allocation account control defaults to Cash / savings and offers supported saved accounts. A 401(k) selection reveals its sponsoring salary control.

The chart, legend and annual preview update from a policy draft without publishing it to the saved forecast. Use a small local refresh path for draft changes so slider dragging and typing preserve focus and cursor state; do not rebuild unrelated record forms on each input. Coalesce successive preview calculations and prevent an older queued result from replacing a newer preview. Invalid drafts show inline errors and clearly distinguish a stale last valid preview from current draft results.

Apply allocation validates the whole policy in a candidate plan, calculates it, increments the revision once, publishes the saved inputs and projection together, and attempts one storage write. A structural or unexpected calculation failure retains the previous applied plan and the full draft. A valid plan with explicitly unavailable forecast results can be applied using the existing availability model. Discard allocation edits restores applied values. Other record drafts survive either action.

The allocation draft snapshots its applied policy, while previews always read the latest applied account, salary, contribution, household and property inputs. An unrelated save refreshes the preview but does not invalidate an unchanged policy draft. If another operation changes the applied policy, reject the older draft as stale. Revalidate all destination links and account types against current saved inputs on Apply. Restore replaces the plan and discards allocation drafts along with existing record drafts.

Backups contain only applied policy inputs, never draft text, calculated yearly shares, reports or adapter requests. Invalid restored policies retain the current plan and original recoverable bytes. Storage failures keep valid applied inputs exportable and show the existing unsaved warning. Old backups without a policy load and calculate as before. Give native controls, the SVG chart and its legend accessible names, readable text values and keyboard support without introducing a chart dependency.

## Verification

Use independent synthetic cash and legal capacity fixtures for allocation arithmetic, plus existing sourced rule fixtures for actual retirement limits. Cover the user's two year example, equal percentage targets sharing the same denominator, annual rule changes, cash flow growth and decline, and maximum shares changing without editing the policy.

Engine checks must cover legacy target top ups and excess legacy funding; explicit cash protected from sweeping; percentage priority before partially funded maximums; multiple maximum priorities; shared traditional and Roth limits; age and catch up facts; IRA phaseouts and compensation; an excess destination repeated as a primary destination; zero and partial excess capacity; late cash after employment ends; negative months and opening reserve protection; nonpositive annual cash; overflow eligibility information; and all cent and reserve conservation equalities. A primary deposit scheduled later in the year must retain its capacity against an earlier possible excess deposit.

Check traditional percentage, maximum and excess contributions against independently stated tax arithmetic to prove that the final cash total includes their tax effects. Assert that trial passes do not advance tax state or duplicate account deposits. Exercise convergence, cycles and the iteration bound without expecting unavailable values to equal zero. No policy plans must retain existing output and funding behavior.

Browser checks cover sliders and exact inputs, add and remove, checkbox mode changes, year preview, actual versus requested shares, excess selection and sponsorship, accessible chart and note behavior, atomic Apply and Discard, unrelated drafts, stale policy edits, reference deletion rejection, persistence failures and old or new backup restore. Acceptance tests apply a policy, inspect at least two forecast years, verify excess and cash fallback notes, export and restore, and confirm account and reserve balances.

After implementation, run type checking, engine and browser suites, the production build and relevant Playwright flows. Finish with `npm run check` and engine tests under America/Los_Angeles as required by the existing repository workflow.
