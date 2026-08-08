# LifeLook

LifeLook makes long-term personal finance understandable without requiring spreadsheet expertise or surrendering private financial data. It is a local-first Linux desktop planner for activity, annual budgets, net worth, taxes, and long-range scenarios.

> **Pre-release:** LifeLook is under active development. Do not rely on it as your only financial record. Calculations may change, and tax estimates are not tax advice.

The full product and engineering intent lives in [PLAN.md](PLAN.md).

## Developer quick start

Prerequisites: Node.js 20+, npm 10+, Rust stable, and Ubuntu 22.04-compatible Tauri system libraries.

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm run dev
```

Run the complete web check or build the desktop AppImage:

```bash
npm run check
npm run tauri dev
npm run appimage
```

The AppImage is written under `src-tauri/target/release/bundle/appimage/`. This repository does not install Rust automatically; use [rustup](https://rustup.rs/) if `rustc` is unavailable.

## User quick start

1. Launch LifeLook and create your household. Choose filing status and California residency.
2. Add checking, savings, investments, property, and debts with their current balances.
3. Enter recent activity manually or import a CSV and confirm its column mapping.
4. Add annual income, recurring spending, savings targets, and growth assumptions in Plan.
5. Clone the baseline, name a scenario, add dated life events, and compare its trajectory.

## Feature guide

- **Overview** shows current cash flow, savings, taxes, and net-worth direction without burying the headline in transaction detail.
- **Activity** supports income, expenses, and balance-neutral transfers, with account/category filters, recurring entries, and reconciliation.
- **Plan** starts with years and expands into deterministic monthly calculations. Actuals fill elapsed periods while assumptions drive future projections.
- **Net Worth** brings liquid accounts, investments, assets, mortgages, and other liabilities into one balance sheet.
- **CSV import** maps arbitrary columns, previews and validates rows, remembers profiles, suggests categories, flags duplicates, and commits only confirmed rows in one transaction.
- **Tax estimates** apply versioned federal, payroll, and California planning rules. Explanations disclose the source year, effective and marginal rates, projected threshold growth, and exclusions.
- **Scenario comparison** keeps named alternatives independent and compares cash flow, taxes, savings, liquidity, net worth, debt payoff, and allocation.
- **Backup** creates an unencrypted snapshot of the local database. Store it somewhere protected.
- **Restore** validates integrity and schema before replacing current data. Back up current data first.

### Actuals, assumptions, and projections

**Actuals** are recorded events such as cleared transactions and current balances. **Assumptions** are choices you control—future income, inflation, returns, or a home purchase. **Projections** are calculated outputs produced from those assumptions. LifeLook labels each state distinctly; a projection is never presented as a promise.

## Privacy and data storage

LifeLook has no user account, telemetry, advertising, cloud sync, or required network service. The SQLite database lives in your operating system’s per-user application-data directory (`com.lifelook.desktop`). OS file permissions provide v1 protection. The database, CSV exports, and backups are **not encrypted by LifeLook**; disk encryption and careful backup storage are recommended.

LifeLook provides planning estimates, not tax, legal, accounting, or investment advice. It does not prepare returns and omits credits, itemized deductions, capital gains, and self-employment tax in v1.

## Troubleshooting

- **`rustc: command not found`:** install Rust stable with rustup, restart the shell, then run `rustc --version`.
- **WebKitGTK or JavaScriptCore not found:** install the Ubuntu packages in Developer quick start. On other distributions use Tauri’s equivalent system-dependency list.
- **AppImage will not launch:** make it executable with `chmod +x LifeLook_*.AppImage`. Some distributions also require FUSE 2; otherwise extract it with `./LifeLook_*.AppImage --appimage-extract` and run `squashfs-root/AppRun`.
- **Blank window:** run `npm run tauri dev` from a terminal and inspect WebKitGTK output; verify port 1420 is available.
- **Settings do not persist:** confirm the application-data directory is writable and that the filesystem has free space.

## Status

The repository contains the Tauri/React foundation, local SQLite migration and state commands, a pure typed projection/tax domain, an accessible responsive interface, and unit/component tests. Guided onboarding, production CSV import, complete mortgage/allocation math, official tax-fixture validation, restore UI, and release smoke testing remain pre-release work tracked in [PLAN.md](PLAN.md).
