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

Household, Income, Expenses and Debts, Investments, and Properties contain labeled native controls. Each record has its own Save action; dated raises, appreciation overrides and related tax history are saved together. Blank required history is unknown, so explicitly confirmed zero and unknown are distinct.

A valid Save updates the in-memory input revision, recalculates, and attempts local persistence. Invalid drafts retain their text while the projection remains tied to the last saved input revision. Removing a referenced salary, account, property or loan requires resolving the references first.

Save validates effective shared and loan allocations and calculates the candidate projection before replacing saved state. A property draft includes its linked rental and expense records. If another Save changes one of those records, the older draft is retained and its Save is rejected. Use the record's **Discard edits and reload saved values** action, then reapply changes to the newer saved inputs. Unrelated drafts and saves remain independent.

Plans retain JSON schema version 1 and browser storage key `lifelook.foundation.plan.v1`. Browser storage belongs to the current origin: development on port 1421 and preview on port 4174 have separate saved plans. Use export and restore to move a plan between origins. Download a backup to retain the current in-memory inputs and revision. Backups contain inputs rather than calculated results; results are recalculated with this package's rule version. Restore validates the entire document before replacement. Malformed JSON, unsupported schema versions and invalid references leave the current plan intact. Corrupt stored documents remain recoverable instead of being silently overwritten.

The former desktop application's SQLite profiles and `.lifelook` backups are not imported by this JSON format. Removing its source code does not delete existing device data or backups. Keep those files separately; enter a new plan or restore a compatible browser JSON backup.

Storage read/write and quota failures are visible. A failed write leaves the valid in-memory plan available as Unsaved and exportable; downloading its backup does not require a successful local-storage write. A valid restore that cannot persist likewise retains an exportable in-memory plan.

## Read the projection

Annual rows sum flows and use December balances. Show months expands individual settled movements; account, property and loan detail shows opening amounts, deposits/payments, growth and closing amounts. Tax explanation shows legal federal/California deduction comparisons, actual selected methods, assessed versus paid California tax, separate AMT/NIIT/surtax components, contribution limits, rental allocations and carried loss state.

Income-tax liabilities are reserved over months using positive gross cash-income weights. Employee payroll follows cumulative wages. Contributions are legally eligible planned deposits, including when cash is insufficient; prevented contributions stay in cash. The engine does not automatically invest surplus, add borrowing, sell assets or invent retirement withdrawals. Once a cash gap occurs, later balances remain conditional on funding it. Asset growth changes value without creating spendable cash.

An available zero is displayed as money. Missing or unsupported dependent amounts display a reason and next step without a numeric placeholder. Independent income, loan, property or account schedules remain visible. Ratios use aggregate annual income; zero-income ratios are undefined while the underlying dollar amounts remain available.

Rule provenance and household coverage are separate. Verified, provisional and projected rule labels identify the actual sources and assumptions. A modeled contribution/growth scenario can remain available while distribution-dependent total household liability is incomplete. Material unmodeled income or credits, unknown relevant histories and monetary overflow prevent affected totals from being treated as complete.

## Tax coverage and source updates

The baseline is 2026, with full-year California residency and married filing jointly. Covered inputs include wages, explicitly characterized ordinary taxable cash income, ordinary long-term residential rentals, employee payroll, workplace contributions, traditional/Roth IRA funding, personal acquisition mortgage deductions, and the modeled ordinary-tax, AMT, NIIT and rental-QBI paths. Qualification, owner limits, origin-year losses, federal/California basis and AMT books remain explicit. Existing or newly relevant minimum-tax-credit circumstances establish an unsupported future-credit boundary.

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
