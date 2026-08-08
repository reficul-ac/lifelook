# LifeLook v1 — Product and Engineering Vision

LifeLook is a polished, local-first Linux desktop app that makes long-term personal finance understandable without spreadsheet expertise or surrendering private financial data. It combines transaction tracking, annual budgeting, net-worth monitoring, and long-range scenario planning in one coherent model. It ships as an x86_64 AppImage and requires no account, cloud service, telemetry, or network connection.

## Guiding principles

- **Private by construction.** Financial data lives in a local SQLite database. The operating system protects it; LifeLook does not claim application-level encryption.
- **Annual first, monthly underneath.** Decisions are presented at a useful yearly scale, with deterministic monthly calculations and expandable detail.
- **Explain the number.** Actual values, user assumptions, and calculated projections are visibly distinct. Tax estimates expose their rule year, effective and marginal rates, assumptions, and limitations.
- **Progressive disclosure.** Common inputs stay clear and optional detail lives under “More options.” One Add menu covers income, expenses, accounts, assets, debts, and scenario events.
- **Scenarios, not special-purpose calculators.** Buying a home, renting, changing jobs, or paying down debt are ordinary scenario inputs and remain comparable.

## What the workbook taught us

The source workbook showed the value of joining cash flow, assets, debts, taxes, and distant goals rather than treating them as isolated calculators. It also exposed spreadsheet limitations that LifeLook intentionally avoids: hidden cell dependencies, duplicated rent-versus-own logic, fragile row insertion, ambiguous units, annual calculations that miss mid-year changes, accidental formula edits, and personal data embedded in a portable file. The workbook remains an external inspiration artifact; it is not bundled or authoritative. Only sanitized, workbook-derived fixtures may enter this repository.

## Product experience

Guided onboarding collects household members, filing status, California residency, income, recurring expenses, accounts, assets, debts, and starting balances. The primary areas are Overview, Activity, Plan, Net Worth, and Settings. The restrained, Apple-inspired visual system uses generous spacing, neutral surfaces, subtle depth and motion, system typography, light and dark themes, accessible contrast, keyboard navigation, and reduced-motion support.

Overview summarizes current position and trajectory. Activity stores manual and CSV-imported transactions but defaults to category summaries. Plan compares annual cash flow and scenario outcomes. Net Worth joins accounts, assets, and liabilities. Settings manages categories, assumptions, appearance, backups, and restore.

## v1 capabilities

### Tracking and import

LifeLook supports income, expenses, and transfers; transfers never affect income or spending totals. Users can customize categories, create recurring entries, reconcile accounts, filter activity, and compare monthly or annual actuals with plan. A CSV mapping wizard provides preview, validation, reusable mappings, category suggestions, duplicate detection, cancellation, and all-or-nothing transactional import.

### Forecasts and scenarios

A pure deterministic engine calculates immutable monthly results and aggregates them into annual views. It models dated income changes, recurring expenses, inflation, savings contributions, investment returns, asset appreciation, mortgages, liabilities, and surplus-allocation waterfalls. Users keep a baseline and independently editable named scenarios, comparing cash flow, taxes, savings rate, liquid worth, net worth, debt payoff, and allocation. Forecasts extend to 40 years. The UI warns about unusually aggressive assumptions, insufficient cash, depleted accounts, and other important edge conditions. Rent-versus-own and mortgage analysis use the same scenario primitives.

### Taxes

Versioned rule packs cover planning-grade 2025 and 2026 federal, payroll, and California taxes for Single, Married Filing Jointly, Married Filing Separately, and Head of Household where applicable. Calculations include progressive brackets, standard deductions, Social Security, Medicare, additional Medicare tax, California brackets, and supported pre-tax contributions. Later thresholds inflate by a configurable assumption and results are labeled projections. Rule packs update only through signed releases based on official IRS and California FTB publications.

Credits, itemized deductions, capital-gains treatment, self-employment tax, and return preparation are excluded. Estimates are planning tools, not tax advice.

## Architecture and domain model

The application uses Tauri 2, React, TypeScript, Vite, Rust, and SQLite. A pure TypeScript domain package owns calculations, decimal-safe integer-cent arithmetic, explicit basis-point rates, and immutable interfaces. `ProjectionEngine.calculate(snapshot, scenario)` is the projection boundary. Narrow Rust commands own privileged file selection, SQLite access, backups, and restore.

Normalized SQLite data uses integer cents, explicit decimal rates, ISO dates, foreign keys, and versioned migrations applied transactionally. Interrupted imports remain isolated in batches and cannot damage existing data. Restore validates database integrity and schema before replacing data; migration failures preserve the prior database.

Core types are `Household`, `Person`, `TaxProfile`, `AppSettings`, `Account`, `Transaction`, `Category`, `RecurringEntry`, `ImportProfile`, `ImportBatch`, `Asset`, `Liability`, `MortgageTerms`, `Scenario`, `ScenarioEvent`, `GrowthAssumption`, `AllocationRule`, `ProjectionHorizon`, `MonthlyProjection`, `AnnualProjection`, `TaxRulePack`, and `TaxEstimate`.

## Privacy, backup, and failure model

There are no accounts, analytics, advertisements, telemetry, cloud dependencies, or required network calls. Manual backups copy a consistent local database. Exports and backups are explicitly not encrypted; users must store them safely. Corrupt backups and invalid CSV rows produce actionable errors without changing current data. Imports and migrations use transactions. Restore is staged and validated before replacement.

## Deferred beyond v1

Bank synchronization, cloud accounts, collaboration, mobile apps, tax filing, Monte Carlo simulation, live market prices, multiple currencies, and states beyond the California extension point are deferred. v1 supports USD and US individuals or households.

## Acceptance criteria

- Onboarding reaches a persisted Overview without a network connection.
- Transfers are excluded from income and spending; reconciliation and actual-versus-plan totals remain consistent.
- CSV variants, malformed records, duplicates, partial imports, cancellation, and rollback behave predictably.
- Scenario clones remain isolated; monthly values sum exactly to annual values; actual-to-projected transitions are explicit.
- Compound growth, inflation, allocation waterfalls, mortgage amortization, mid-year events, savings rates, and rounding invariants have unit coverage.
- Tax fixtures cover official examples and bracket boundaries and disclose their rule version and limits.
- Forty-year forecasts handle zero, negative, and aggressive growth, insufficient cash flow, early debt payoff, and depletion.
- Database migration and backup round trips pass; corrupt sources cannot replace current data.
- Onboarding, progressive disclosure, keyboard use, themes, contrast, and reduced motion pass component/accessibility checks.
- The AppImage launches under a virtual display, persists from first launch, and exports successfully.
- `PLAN.md` preserves this vision and every README command is exercised by CI.

## Phased implementation checklist

- [x] 1. Repository and Tauri foundation
- [ ] 2. Local database and guided onboarding
- [ ] 3. Transactions and CSV import workflow
- [ ] 4. Budget and net-worth views
- [ ] 5. Projection and scenario engine
- [ ] 6. Tax engine and verified rule packs
- [ ] 7. AppImage packaging and release validation on Ubuntu 22.04

Checked means the phase is acceptance-complete, not merely scaffolded. The repository currently contains an interface and vertical foundation for phases 2–6; their remaining edge cases and validation keep them open.

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-08 | Use monthly deterministic calculations with annual presentation. | Preserves mid-year accuracy without overwhelming the primary interface. |
| 2026-08-08 | Store money as integer cents and rates as basis points. | Makes rounding explicit and avoids binary floating-point money errors. |
| 2026-08-08 | Keep the workbook external and use sanitized fixtures only. | Prevents private data leakage and avoids inheriting spreadsheet architecture. |
| 2026-08-08 | Treat home ownership as ordinary scenario events and assets/liabilities. | Prevents duplicated calculator logic and keeps comparisons consistent. |
| 2026-08-08 | Use OS permissions rather than claim in-app encryption. | Sets an honest v1 security boundary while enabling portable manual backups. |

