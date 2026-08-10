import { estimateTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
import type { AnnualProjection, FinancialSnapshot, MonthlyProjection, Scenario } from "./types";

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const active = (start: string, end: string | undefined, month: string) => start.slice(0, 7) <= month && (!end || end.slice(0, 7) >= month);
const grow = (cents: number, bps: number, months: number) => Math.round(cents * Math.pow(1 + bps / 10_000, months / 12));

export const ProjectionEngine = {
  calculate(snapshot: FinancialSnapshot, scenario: Scenario): readonly AnnualProjection[] {
    if (scenario.horizon.months < 1 || scenario.horizon.months > 480) throw new RangeError("Projection horizon must be between 1 and 480 months");
    const start = new Date(`${scenario.horizon.start.slice(0, 7)}-01T00:00:00Z`);
    let liquid = snapshot.accounts.filter(a => a.liquid).reduce((sum, a) => sum + a.balanceCents, 0);
    let accountTotal = snapshot.accounts.reduce((sum, a) => sum + a.balanceCents, 0);
    let assetBalances = snapshot.assets.map(a => ({ value: a.valueCents, rate: a.annualGrowthBps }));
    let liabilityBalances = snapshot.liabilities.map(l => ({ balance: l.balanceCents, rate: l.annualRateBps, payment: l.minimumPaymentCents }));
    const months: MonthlyProjection[] = [];
    for (let index = 0; index < scenario.horizon.months; index++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      const key = monthKey(date);
      const years = date.getUTCFullYear() - start.getUTCFullYear();
      let income = 0, expense = 0;
      for (const entry of snapshot.recurring) if (active(entry.startDate, entry.endDate, key)) {
        let value = grow(entry.amountCents, entry.annualGrowthBps ?? (entry.kind === "expense" ? scenario.assumptions.inflationBps : 0), index);
        const changes = scenario.events.filter(e => e.type === "income-change" && e.entryId === entry.id && e.date.slice(0, 7) <= key);
        if (changes.length) value = (changes.at(-1) as { amountCents: number }).amountCents;
        if (entry.kind === "income") income += value; else expense += value;
      }
      for (const event of scenario.events.filter(e => e.date.slice(0, 7) === key)) {
        if (event.type === "one-time-income") income += event.amountCents;
        if (event.type === "one-time-expense") expense += event.amountCents;
      }
      liabilityBalances = liabilityBalances.map(liability => {
        if (liability.balance <= 0) return liability;
        const interest = Math.round(liability.balance * liability.rate / 120_000);
        const amountDue = liability.balance + interest;
        const payment = Math.min(liability.payment, amountDue);
        expense += payment;
        return { ...liability, balance: amountDue - payment };
      });
      const rules = snapshot.taxProfile.taxYear === 2025 ? TAX_RULES_2025 : TAX_RULES_2026;
      const annualTax = estimateTax(income * 12, snapshot.taxProfile.filingStatus, rules, 0, years > 1).totalCents;
      const tax = Math.round(annualTax / 12), surplus = income - expense - tax;
      liquid += surplus;
      accountTotal = Math.max(0, grow(accountTotal, snapshot.accounts.length ? snapshot.accounts.reduce((s,a) => s + a.annualReturnBps, 0) / snapshot.accounts.length : 0, 1) + surplus);
      assetBalances = assetBalances.map(asset => ({ ...asset, value: grow(asset.value, asset.rate, 1) }));
      const assetTotal = assetBalances.reduce((sum, asset) => sum + asset.value, 0);
      const debt = liabilityBalances.reduce((sum, liability) => sum + liability.balance, 0);
      months.push({ month: key, incomeCents: income, expenseCents: expense, taxCents: tax, surplusCents: surplus, liquidWorthCents: liquid, netWorthCents: accountTotal + assetTotal - debt, debtCents: debt });
    }
    const grouped = new Map<number, MonthlyProjection[]>();
    for (const month of months) { const year = Number(month.month.slice(0,4)); grouped.set(year, [...(grouped.get(year) ?? []), month]); }
    return [...grouped].map(([year, items]) => ({ year, incomeCents: sum(items,"incomeCents"), expenseCents: sum(items,"expenseCents"), taxCents: sum(items,"taxCents"), surplusCents: sum(items,"surplusCents"), endingNetWorthCents: items.at(-1)!.netWorthCents, months: items }));
  }
} as const;

function sum(items: MonthlyProjection[], key: "incomeCents" | "expenseCents" | "taxCents" | "surplusCents") { return items.reduce((total, item) => total + item[key], 0); }
