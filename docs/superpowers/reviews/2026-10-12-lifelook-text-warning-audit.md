# LifeLook text and warning audit

Date: 2026-10-12

LifeLook should show amounts, result status, and the next important action at a glance. Repeated explanations belong in optional details. The largest problem is the shared unavailable-amount renderer: it prints complete warning paragraphs in every affected cell and repeats earlier years' causes in cumulative balances. Keep `Needs data`, `Unsupported`, cash-gap conditions, incomplete household tax, and persistence failures visible; make their explanations accessible through hover, keyboard, and tap.

This audit covers every current browser form and reporting view, the application shell, shared field and issue renderers, and their linked warning producers. It consolidates three independent reviews and browser checks. It proposes presentation changes; application code, calculations, and the historical rebuild records are unchanged. Source references below use current repository paths, rather than the historical `foundation/` paths.

## Measured repetition

In a fresh browser context at a 1440 by 1000 viewport, the default plan starts in 2027 and spans 30 years. Monthly and tax explanations were closed for these measurements.

| Measurement | Current result |
| --- | --- |
| Amount columns plus Period | 30 |
| First annual table width / available panel width | 2783 / 811 pixels |
| First annual row | 36 warning paragraphs; 1310 pixels tall |
| Last annual row | 384 warning paragraphs; 37502 pixels tall |
| Paragraphs in the initial report | 7812 |
| Copies of the identical tax-coverage explanation | 3150 |
| Copies of its identical next-step paragraph | 3150 |

The synthetic `two-salaries-home-adu` fixture exposes eight property details sections, all expanded, with 112 input/select fields. A new empty property has only its appreciation section, also expanded. These counts describe the supplied scenarios, rather than every possible plan.

The screenshot has four connected causes:

1. `src/engine/tax/comparison.ts:73` creates one warning for each of three unanswered coverage questions: additional income, additional credits, and qualified dividends or capital gains. The explanations are identical, but the affected fields differ.
2. `src/browser/views/issues.ts:9` prints the status and two paragraphs for each issue. Its whole-object deduplication preserves distinct fields and years.
3. `src/engine/projection.ts:38` combines dependent issues. At lines 224–225, cash reserve carries earlier unresolved issues forward and net worth inherits them. The first year has three distinct causes per affected balance; the thirtieth has 90. Earlier years remain relevant, but do not need 90 copies of the same prose.
4. `src/browser/styles.css:1` gives inputs roughly 40% of the desktop layout. The remaining panel contains 30-column tables with automatic sizing, wrapped cell prose, paragraph margins, and no compact amount/status treatment. Horizontal scrolling contains the table but does not prevent giant rows.

For this default scenario, warning paragraphs across six affected annual amounts total `sum(24 + 12k)` for years `k = 1…30`, or 6300. The measured repetition matches the dependency trace. Changing only the wording or table widths will leave most of that repetition intact.

## What stays visible

| Content | Visible treatment | Optional detail |
| --- | --- | --- |
| Available amount | Currency or percentage | Definition or calculation breakdown where useful |
| Missing or unsupported amount | `Needs data` or `Unsupported`, with a details control | Exact causes, affected inputs, years, and next steps |
| Incomplete modeled calculations / household tax | Separate compact status indicators | Why each is incomplete; independent results that remain usable |
| Provisional or projected rules | Applicable rule status | Sources, versions, assumptions, and calculation steps |
| Cash gap or growing debt | Short triggered warning near affected results | Funding assumptions, affected periods, and loan mechanics |
| Invalid input, failed save, stale draft, unreadable backup | Specific problem and corrective action beside the task | Secondary diagnostics and technical paths |
| Changes only in memory | Persistent warning and backup action | Storage troubleshooting |
| Field meaning that changes what is entered | Short nearby instruction, including units and dates | Definitions and specialist background |
| Generic methodology and repeated boilerplate | One optional help entry | Full explanation, once |

An unavailable amount must never become `$0.00`, a bare dash, or an unlabeled icon. A confirmed zero remains a numeric zero. A missing result and an unsupported case remain distinguishable. Collapsing details must preserve the ability to find and fix every affected input.

## Projection and tax inventory

| Source and surface | Current excess or ambiguity | Proposed treatment |
| --- | --- | --- |
| `src/browser/views/issues.ts:9` — amounts everywhere | Every unavailable annual/monthly/table/ratio amount prints full explanations and resolutions. | Keep one compact status control. Put exact reasons/actions in shared details. This single change reaches all amount surfaces. |
| `src/engine/tax/comparison.ts:77` — coverage blockers | Three field-specific issues use identical contract language; repeated in all dependent amounts and years. | `Tax coverage unconfirmed · 3 checks · Review Household`. List the actual unanswered questions and affected years in details. For a reported unsupported circumstance, identify that circumstance rather than asking the user to confirm absence. |
| `src/browser/views/issues.ts:20` — coverage | Two full paragraphs repeat at projection, year, and tax levels. | Separate compact indicators: `Modeled calculations incomplete` and `Household tax incomplete`. In tax expansion, reuse the applicable year context. |
| `src/browser/views/issues.ts:23`; `src/engine/tax/comparison.ts:144` — rule status | Separate rule-status paragraphs plus another generic uncertainty warning; its action asks households to rerun fixtures. | Keep applicable status visible. Consolidate explanation under `Sources and assumptions`. Remove developer fixture instructions from ordinary UI copy. Global mixed statuses need clear scope; a verified component does not verify the whole forecast. |
| `src/browser/views/issues.ts:26` — source details | Long URLs, version strings, baseline/year lists, assumptions. | Keep this existing optional disclosure. Use descriptive source-link titles and place technical versions inside it. Preserve provenance. |
| `src/browser/views/projection.ts:44` — revision | Projection repeats the revision already shown in the header. | One compact projection reference, such as `Inputs v1`. Explain drafts separately. Avoid calling validated in-memory inputs locally saved when persistence failed. |
| `src/browser/views/projection.ts:44` — tax-reserve paragraph | Positive gross-income weighting and cumulative payroll appear before every forecast. | Put under `How calculated`. Include the equal-month allocation when positive gross income is zero; payroll remains a separate method. |
| `src/browser/views/projection.ts:44` — asset-growth paragraph | General warning before results, regardless of which assets exist. | Short help beside growth: `Asset growth changes value, not spendable cash.` Keep this distinction discoverable. |
| `src/browser/views/projection.ts:44` — contribution/funding paragraph | Three general sentences about planned contributions, conditional balances, borrowing, sales, and withdrawals. | Move mechanics under `Forecast assumptions`. When a gap exists, visibly show `Conditional: cash gap` and explain that planned deposits still require funding. |
| `src/browser/views/projection.ts:53` — yearly funding | Funding status and conditionality occupy separate paragraphs. | Compact year indicators: `Funding unknown`, `No modeled cash gap`, `Conditional: cash gap`. Unknown funding and prior-gap conditionality can coexist. |
| `src/browser/views/projection.ts:5` — table labels and width | 29 amount columns plus Period; ambiguous `Principal`, `Accounts`, `Loans`, and abbreviated `SDI`. | Retain financial values. Clarify `Principal paid`, `Account balance`, `Loan balance`; explain California disability insurance in short help. Keep amounts/statuses compact and give columns sensible widths. Column grouping is a separate, optional layout decision. |
| `src/browser/views/projection.ts:57`; `src/engine/reporting.ts:70` — ratios | Known zero income produces four `Needs data` messages with repeated actions. | For the specific zero-income reason, show `N/A · no income`, with one explanation that ratios require nonzero income. Unknown underlying amounts still use missing/unsupported status. |
| `src/browser/views/projection.ts:47` — contribution schedules | Successful request counts add little; failed schedules print full paragraphs and open the whole section. | Keep schedules optional. Show a concise visible count/action for unavailable schedules, with exact rule/year details inside. |
| `src/browser/views/projection.ts:27` — asset and loan details | Repeated long summaries, raw IDs, and empty `No asset or loan records` sections, including each month. | Keep populated reconciliation tables; omit empty sections. Use record names, with IDs secondary. Shorten summary to `Asset and loan balances · [period]`. |
| `src/browser/views/tax-explanation.ts:32` — selected status and methods | Repeated coverage/provenance and long issue panels; deduction methods are separate paragraphs. | Compact tax status and `Deductions: Federal standard · California standard`. Preserve applicable completeness and rule status. |
| `src/browser/views/tax-explanation.ts:38` — tax amounts | One long list mixes core totals and specialist intermediate inputs. | Show selected deductions, disallowed deductions, and separate ordinary tax/AMT/NIIT/surtax components. Put intermediate income/exemption/restriction inputs in named expandable subsections. |
| `src/browser/views/tax-explanation.ts:43`; `:45` — California totals | Total California income tax and California tax assessed repeat the same amount. | Show assessed liability once. Keep `California tax paid` and SDI paid separate because payment facts affect deductions. Label entered actuals versus prospective assumptions. |
| `src/browser/views/tax-explanation.ts:47` — calculation prose | Formula paragraphs repeat nearby values; engine copy can expose raw cents and worksheet/internal names. | Optional `Calculation steps`, with currency formatting and plain terminology. Preserve rule effects and minimum-tax-credit boundaries. |
| `src/browser/views/tax-explanation.ts:49` — four deduction comparisons | Repeated payment assumptions and full unavailable-cell warnings. | Keep comparison optional and use shared status details. When selected household tax is blocked but candidates are numeric, visibly state `Candidate taxes cover modeled inputs only; household tax incomplete`. Candidates are computed before the coverage gate in `comparison.ts:98–120`. |
| `src/browser/views/tax-explanation.ts:52` — modified incomes | Five specialist income measures presented together without definitions. | Optional `Income used for tax limits`, with short definitions. Keep distinct SALT, NIIT, IRA, and passive-loss measures. |
| `src/browser/views/tax-explanation.ts:16` — contributions | Monthly reasons/actions repeat for each contribution; general IRA methodology adds more paragraphs. | Keep requested/eligible/prevented/deductible amounts. Group identical reasons by rule and month range, such as `IRA limit reached · Jul–Dec`. Methodology goes under `Contribution rules`. Eligibility does not imply cash affordability. |
| `src/browser/views/tax-explanation.ts:10`; `:18` — IRA basis | Generic opening/carried-history paragraph at each unknown amount. | `Needs basis history · Review Investments`, with the exact opening or carried issue in details. |
| `src/browser/views/tax-explanation.ts:21` — rentals | Cash, taxable books, and closing loss tables repeat unavailable messages across four books. | Keep optional reconciliation tables with shared reasons. Federal/California and regular/AMT books remain independent. Cash flow and taxable profit remain distinct. |
| `src/browser/views/tax-explanation.ts:28` — QBI carry | Repeated prose for missing or confirmed-zero loss history. | `No carried QBI losses (confirmed)` or `Missing QBI loss history`; retain origin years and amounts in a compact list. |
| `src/browser/views/issues.ts:40`; `tax-explanation.ts:33,46,54,55`; `projection.ts:64` — issue panels | Multiple overlapping lists, repeated headings and empty panels; raw record IDs and field paths. | One grouped list per relevant scope, with concise severity/record/year/action. Remove empty lists and duplicate copies. Keep full paths/codes in optional diagnostics. |

## Form inventory

| Source and surface | Current excess or ambiguity | Proposed treatment |
| --- | --- | --- |
| `src/browser/fields.ts:49` — history controls | Same question repeated as legend, history label, answer/value label. Boolean facts require Known then Yes/No. | One boolean `Unknown / Yes / No` control. Money/date history retains explicit unknown state and a meaningful value label. Never default unanswered facts to No or zero. |
| `src/browser/fields.ts:64`; all five forms — repeated prefixes | Filer/Salary/Contribution/Property expense and row indexes repeat in almost every label. | Short visible labels within named groups; keep contextual accessible names. Straightforward Name/Owner/Amount/date fields need no tooltip. |
| `src/browser/fields.ts:68` — headings | Household repeats as section and card heading. | One meaningful heading. |
| `src/browser/fields.ts:73` — Save labels | `Save … record`. | `Save salary`, `Save expense`, `Save account`, etc. |
| `src/browser/fields.ts:74`; `properties.ts:174` — discard | Long discard/reload button label. | `Discard edits`, with the loss/reload consequence clear before activation. Destructive meaning must not rely on hover. |
| `src/browser/forms/household.ts:7–8` — limits and opening cash | Wordy horizon bound and cash definition. | Keep nearby `1–40 years` and `Cash outside investment accounts on Jan 1.` Units/date/scope matter. |
| `src/browser/forms/household.ts:13–21` — workplace and catch-up | Repeated filer labels, employer IDs, yearly coverage, catch-up histories and SSN terminology. | Named `Coverage by year` and `Catch-up eligibility` groups. Keep employer linkage and missing-fact summaries visible; put specialist definitions in details. No SSN needs to be collected. |
| `src/browser/forms/household.ts:24` — six coverage questions | Six repeated Known/answer structures for other income, credits, gains, distributions, and federal/CA AMT credits. | Group as `Other tax circumstances`, with six individual three-state answers. Keep each substantive question; avoid a blanket completeness checkbox. |
| `src/browser/forms/household.ts:26–29` — assumptions and paid tax | Long projected-indexing hint; repetitive actual-payment labels. | `Tax assumptions`; `State taxes paid`. Keep `Annual increase assumed for tax thresholds after 2026` nearby; methodology optional. Paid tax remains distinct from liability. |
| `src/browser/forms/income.ts:14,17,34` — timing | Long end-date/last-day/recurrence explanations. | Keep concise: `Includes this date. Blank means no end.`, `Shorter months use their last day.`, `Payments repeat on this date each month or year.` Apply end-date guidance consistently. |
| `src/browser/forms/income.ts:43,47` — tax treatment | NIIT acronym, technical classification, and long unsupported-income hint. | Plain tax-treatment choices; short NIIT definition optional. Keep `Qualified dividends and realized capital gains are unsupported` visible beside the relevant input. |
| `src/browser/forms/expenses-debts.ts:10,30,33` — timing and loan mechanics | Proration/APR convention prose and mortgage double-entry instruction. | Keep payment-date semantics and `Add each mortgage once, under its property.` Put monthly interest convention under `How interest is calculated`. APR units remain visible. |
| `src/browser/forms/expenses-debts.ts:14,17,22–26`; `properties.ts:70,109,131–138` — names/categories/shares | Raw rental IDs and enum codes; numerator/denominator jargon; qualification questions. | Human rental/category labels. Use `Rental share`, `Rental portion / Total portions`, with `1 of 4 = 25%`. Retain qualification facts; longer definitions optional. Fractions remain fractions. |
| `src/browser/forms/investments.ts:11` — returns | Long unrealized-growth/deposit-timing hint. | Keep `Deposits grow from the following month`; optional explanation of effective returns and unrealized growth. |
| `src/browser/forms/investments.ts:12` — IRA basis | Unknown/zero and basis-versus-balance in one hint. | Label `After-tax IRA basis at forecast start ($)`, with `Different from account balance; enter 0 only if confirmed.` Fuller mechanics optional. |
| `src/browser/forms/investments.ts:16,19,26` — contribution mechanics | Shared-limit priority, stable record-order jargon, amount mode, sponsoring-employer language. | Keep `Lower numbers receive available contribution limits first` and employer linkage. Use `Monthly amount / % of gross salary`. Tie ordering and catch-up mechanics go in details. |
| `src/browser/forms/properties.ts:10` — expanded sections | Every created details section opens by default: overrides, loans, rentals, four tax books, QBI. | Collapse advanced/history sections, with visible status/count such as `Federal AMT history · Missing`. Keep needed basic editing accessible; open or link the affected section for validation problems. |
| `src/browser/forms/properties.ts:22,62` — unknown/known/zero options | Long repeated option descriptions. Mortgage opening Unknown can use an estimate; whole-book Known zero confirms every amount/loss. | Separate `Use schedule estimate / Enter known value` from ordinary `Unknown / Known`. For tax books: `Unknown / Enter amounts / All amounts and losses are zero`. Keep the scope of zero explicit. |
| `src/browser/forms/properties.ts:57–68` — four tax books | Summary plus inner legend repeat; many amount/loss labels repeated four times. | One title per independent book under `Opening rental tax history`. Use `Losses by year`; put AMT/at-risk/passive definitions in details. Do not copy one book into another to reduce entry. |
| `src/browser/forms/properties.ts:82,105,123` — nested headings | Loan, rental and QBI summaries repeat as legends. | One heading per section. |
| `src/browser/forms/properties.ts:87,89,96` — purchase loan instructions | Payment components, saved amounts, estimates and overrides explained in paragraphs. | Keep `Exclude property tax and insurance`, estimated/entered indicators, and `Estimated monthly principal & interest: $…`. Initialization does not confirm history or eligibility. Move mechanics into details; remove “remain editable.” |
| `src/browser/forms/properties.ts:90–101` — proceeds and qualification | Raw enum options, long initialization label and specialist history terms. | Friendly proceeds labels; `Calculate purchase loan`. Group tax questions under `Loan tax qualification`. Keep individual acquisition/proceeds/at-risk facts; definitions optional. |
| `src/browser/forms/properties.ts:93` — initialization errors | Every explanation/resolution concatenated. | Specific error/action beside the field, with structured details. Avoid appending another paragraph after repeated attempts. |
| `src/browser/forms/properties.ts:107` — availability and basis | One paragraph mixes allowed dates, later rent, land exclusion and value/basis distinction. | Put `Available by forecast start; rent may begin later` beside dates. Put `Building basis excludes land and differs from market value` beside basis. Both stay visible. |
| `src/browser/forms/properties.ts:111–118` — rental facts | Many specialist qualification, conversion and loan-allocation labels. | Named rental-qualification groups and concise labels. Explain terms optionally. Preserve negative-question meaning, historical-versus-future conversion distinction, land exclusion, and interest eligibility independent of area share. |
| `src/browser/forms/properties.ts:123–126` — QBI | QBI/UBIA/vintage jargon and repeated no-loss option text. | Explain qualified business income and `Unadjusted qualified property basis (UBIA)` once; use `QBI losses by year`. Keep `No rows means confirmed no prior losses` beside the known-history editor. |
| `src/browser/forms/properties.ts:142,149–150` — value and allocation | Long market-value labels; default share and independent overrides explained repeatedly; generic failure copy. | Keep combined home+ADU valuation/date explicit. Show `Default rental share: …`; explain overrides optionally. Link actual invalid fields when allocation cannot be calculated; invalid areas are not always the only cause. |
| `src/browser/forms/properties.ts:152` — scope | Full future-event exclusion paragraph repeats in each property. | One visible Properties scope notice. Retain that only existing properties/rentals are supported and future purchases, conversions, refinance, construction and sales are unsupported. |
| `src/browser/forms/properties.ts:176` — local issues | Raw paths plus full paragraphs duplicate global issues. | Human field name and short action beside the field; shared full details. |

Required numeric blanks, historical Unknown, and estimated mortgage opening values are different. Current `fields.ts:10` and `state.ts:39–46` call some blank numeric values unknown even though Save rejects them. Use `Enter a value; use 0 only if confirmed` for required amounts, explicit Unknown for histories, and a labeled estimate choice where the engine estimates.

## Warning families and error copy

Every dynamic warning reaches one of the amount, issue-list, field, or backup surfaces above. Use the shared presentation for these families while retaining their distinct causes.

| Sources | Keep visible | Optional detail or repetition to remove |
| --- | --- | --- |
| `src/browser/fields.ts:10–14`; `state.ts:39–46`; `src/engine/validation.ts:18–59` | Field-specific required/format/range error in dollars, percentages, dates, or other UI units. | JSON types, integer-cents/basis-point jargon, generic repeated “correct and save” instructions. |
| `src/engine/validation.ts:213–216,258,271–274,303–308` | Concrete date restriction: end after start, availability by forecast start, rent after availability. | ISO terminology and generic validation prose. |
| `src/engine/validation.ts:252–253,260,288,292,320–329,348–350` | Specific allocation, ownership, down-payment, loss reconciliation, or reference correction. | Full schema paths and accounting background. |
| `src/engine/coverage.ts:16,32,46`; `tax/workplace.ts:70–82` | Name the missing fact and affected result; link to its input. | Generic unknown-history paragraphs repeated across fields/years. Never suggest zero for a birth date or qualification. |
| `src/engine/coverage.ts:27`; `projection.ts:171` | Distribution-dependent years have incomplete household tax; distributions are omitted. | Longer planning boundary, grouped by filer and affected years. Numeric modeled growth does not establish complete liability. |
| `src/engine/coverage.ts:44,51,59`; `property/depreciation.ts:32–54` | Name the actual unsupported income, qualification, mortgage or depreciation case. | Contract language and specialist history details. Entering zero cannot bypass unsupported eligibility. |
| `src/engine/model/tax-state.ts:22`; `property/facts.ts:208–209` | Identify the missing opening Federal/California/AMT rental book. | List required balances, depreciation, losses and origin history in the relevant expandable section. |
| `src/engine/tax/rental-losses.ts:75,92–108` | Specific blocker: financing qualification, original participation history, repayment funding, or recapture boundary. | Detailed at-risk/loss calculations. Avoid merging unlike issues into a vague missing-data warning. |
| `src/engine/tax/ira.ts:53,62–63,89,105`; `tax/workplace.ts:58,100` | Age/coverage conflicts, earlier unresolved eligibility, capped/prevented contributions, and where prevented cash remains. | Repeated monthly wording and general limit methodology. |
| `src/engine/tax/federal.ts:50–60,111–112,130,145` | Specific missing QBI/AMT-credit/SSN/wage/basis fact or unsupported credit circumstance. | Specialist definitions and loss-origin schedules. |
| `src/engine/property/loans.ts:177–178,199–200` | Estimated opening balance; `Payment is below interest; debt will grow`. | Schedule mechanics and repeated loan-history instructions. |
| `src/engine/property/input-defaults.ts:14,20–29`; `reporting.ts:36` | Specific invalid term/range or overflow plus corrective action. | Internal monetary representation and generic supported-range wording. |
| `src/browser/state.ts:62,74,76` | Save failure, retained draft/projection, stale saved values, and a clear next action. | IDs and linkage diagnostics. Discard/reload must communicate loss of edits. |
| `src/browser/storage.ts:26,36,54` | Backup/read/save failure, retention or memory-only state, and recovery action. | Secondary troubleshooting. Persistence warnings must remain visible until resolved. |

## Shell and recovery inventory

| Source and surface | Current excess or gap | Proposed treatment |
| --- | --- | --- |
| `src/browser/main.ts:22` — tagline | Generic sentence duplicates the app's evident purpose. | Shorten or omit. Keep LifeLook title. |
| `src/browser/main.ts:39` — status | Saved/Unsaved plus revision plus a full draft sentence on every edit; projection repeats revision. | Compact persistence and draft indicators. Show `Draft edits not applied` with optional explanation. Announce meaningful save outcomes rather than long text on every keystroke. |
| `src/browser/main.ts:24–25` — backups/export | Existing closed details already keeps infrequent controls optional. | Preserve it; use concise export outcome. Clearly explain that backups contain validated plan inputs and exclude record drafts (`state.ts:99`). |
| `src/browser/main.ts:29–30` — restore outcomes | Failed restore reasons flatten into one long status; memory-only warning is inside backup details. | Visible concise outcome/action near import; structured reasons optional. Memory-only persistence warning remains in the header too. |
| `src/browser/main.ts:27–29`; `state.ts:100` — replacement | Selecting a valid backup replaces the plan and clears drafts without explanation of that consequence. | Briefly explain replacement and draft loss before choosing a file. This missing action consequence should not become hover-only help. |
| `src/browser/main.ts:49–53` — startup recovery | Original invalid bytes are downloadable, but recovery explanation/actions are buried. | Concise visible recovery notice distinguishing the new in-memory plan from unreadable stored data. Keep original bytes recoverable. Missing storage on first use needs no warning. |
| `src/browser/main.ts:37,40` — workspace issues | Transaction errors appear after the entire projection; an empty second issue panel remains. | Put task failures near the initiating form/action and remove empty shell panels. |
| `src/browser/state.ts:80–81,97` — warning lifetime | Editing, discarding or adding clears all state issues, including persistence failure. | Keep persistence/recovery warnings independent of transient field errors. Browser reproduction: storage-write explanation count fell from 1 to 0 after an edit while status stayed Unsaved. |
| `src/browser/styles.css:1` — backup affordance | Header text is near-white; global details background is white, so the backup summary has poor visibility. | Give disclosure summaries readable foreground/background colors. Optional help must be discoverable. |
| `src/browser/styles.css:1` — severity | Issue severity classes exist but have no corresponding styles. | Compact severity treatment with visible text, rather than color alone. |
| `src/browser/main.ts:33`; `entry.ts`; `index.html` | Navigation is concise; no separate verbose welcome/onboarding screen exists. | Keep navigation. No additional help popups are needed for these simple labels. |

## Optional explanations and grouped causes

Use three levels of disclosure:

1. **Short help:** one sentence for a term, unit, or nonessential mechanic. A small control beside the label/status shows the same explanation on hover and keyboard focus, with an activation path for touch.
2. **Reasons and actions:** clicking, tapping, or pressing Enter/Space on `Needs data` opens a persistent panel. Show concise causes, affected inputs and periods, and a route to the relevant form. An optional hover preview can summarize the first cause; actions belong in the activated panel.
3. **Detailed calculations:** existing or nested expandable sections for formulas, sources, comparisons and independent tax books. Long content should remain open while the user reads or edits it.

For hover/focus content, allow the pointer to move onto the popup, keep it present while being read, and provide dismissal without moving pointer/focus when it obscures content. Escape is a suitable mechanism. These requirements follow [W3C guidance for content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).

Do not put interactive links/buttons into a noninteractive tooltip. W3C's [tooltip guidance](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) describes focus remaining on the trigger and `aria-describedby`, while noting that the pattern is still work in progress. For the actionable details, use an accessible disclosure with expanded state and keyboard activation, as in the [W3C disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

Render floating content outside clipping table/scroll ancestors; keep it inside the viewport at narrow widths and zoom. An activated panel needs a visible close control and sensible focus return. Keep imported names/messages as text. Changing a saved plan must refresh or close details tied to the old results. Avoid putting every repeated paragraph into the screen reader description of every amount; the concise status identifies the control, and expanded details carry the full content.

Group identical causes for presentation using code, affected record/field, compatible resolution, and retained year/month scope. Preserve exact underlying issues and their relationship to each amount. For the three coverage questions, one group can contain three named checks. For a cumulative reserve, combine repeated occurrences across years while retaining the entire affected span. Different records or corrections must remain individually discoverable even if their wording matches. Grouping is a UI operation; it must not make an unavailable result available.

Example for the screenshot:

| Period | Federal income tax | California income tax |
| --- | --- | --- |
| 2027 | Needs data ⓘ | Needs data ⓘ |

Hover/focus preview: `Confirm 3 household tax answers.`

Activated details: `Household tax coverage is unconfirmed`, followed by the three actual unanswered questions and `Review Household`. For carried balances, also show the affected year range. When the answer establishes an unsupported circumstance, identify it and explain the support boundary instead of offering a misleading confirmation fix.

## Recommended order and verification

Start with the shared unavailable-amount renderer and issue grouping. They account for the screenshot and improve annual/monthly amounts, ratios, asset/loan tables, and tax comparisons together. Keep completeness and rule/funding indicators compact, then consolidate duplicated issue lists and move generic methodology into optional help. Next collapse advanced property sections and simplify history labels without changing their meanings. Shorten remaining field hints and source/formula text after those structural changes.

Persistence warnings and import/discard consequences need separate attention because they require visible actions, not optional hover text. They are adjacent correctness findings from the warning audit; retain their scope when implementing them.

A later implementation should verify:

- Every unavailable cell retains its status and exposes its exact reasons/actions by keyboard and touch. Known zero and independent available amounts remain unchanged.
- Grouped causes retain affected records, fields, periods, severity and corrections, including all prior years relevant to reserve/net worth.
- Modeled completeness, household completeness, rule status, funding availability and cash-gap conditionality stay distinct and visible where applicable. Numeric deduction candidates retain the incomplete-household boundary.
- Unknown histories, confirmed zeros and scheduled estimates preserve their current calculation contracts. Four rental tax books remain independent.
- Form errors remain near the task, hidden invalid sections can be reached, and focus survives rerenders. Discard/import consequences remain clear.
- Simulated storage failure keeps the backup action and recovery warning available through later edits. Invalid restores retain the current plan, and original unreadable bytes remain recoverable.
- Hover/focus/tap details remain readable, dismissible and unclipped at desktop/mobile widths and zoom. Tables retain captions, header associations and useful horizontal scrolling.
- Initial and expanded forecasts contain no explanation paragraphs inside amount cells; opening optional content reveals the full information. Check the 30-year default and the populated property fixture.

Current assertions in `tests/browser/reporting.test.ts:48–54,88–105` and `tests/e2e/workspace.spec.ts` require some explanations to be permanently visible or present inside a cell. Update those assertions to open and verify the relevant disclosure, while preserving reasons, next steps, unavailable states, independent values, and conditional results. This audit does not require a calculation-rule change or a tax-law revalidation.
