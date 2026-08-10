import { estimateTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
import type { AnnualProjection, FinancialSnapshot, MonthlyProjection, RecurringEntry, Scenario } from "./types";

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const grow = (cents: number, bps: number, months: number) => Math.round(cents * Math.pow(1 + bps / 10_000, months / 12));
const isoDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Invalid date: ${value}`);
  return date;
};
const addMonths = (date: Date, count: number) => {
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
  return result;
};
function occurrences(entry: RecurringEntry, month: string) {
  const start = isoDate(entry.startDate), end = entry.endDate ? isoDate(entry.endDate) : undefined;
  if (end && end < start) throw new RangeError("Recurring end date must be on or after its start date");
  const first = new Date(`${month}-01T00:00:00Z`), after = addMonths(first, 1);
  let count = 0, cursor = start;
  const frequency = entry.frequency ?? "monthly";
  if (frequency === "weekly" || frequency === "biweekly") {
    const days = frequency === "weekly" ? 7 : 14;
    if (cursor < first) cursor = new Date(cursor.valueOf() + Math.max(0, Math.ceil((first.valueOf() - cursor.valueOf()) / (days * 86400000))) * days * 86400000);
    while (cursor < after && (!end || cursor <= end)) { if (cursor >= first) count++; cursor = new Date(cursor.valueOf() + days * 86400000); }
  } else {
    const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
    let n = Math.max(0, Math.floor(((first.getUTCFullYear() - start.getUTCFullYear()) * 12 + first.getUTCMonth() - start.getUTCMonth()) / step) - 1);
    cursor = addMonths(start, n * step);
    while (cursor < after && (!end || cursor <= end)) { if (cursor >= first) count++; n++; cursor = addMonths(start, n * step); }
  }
  return count;
}

export const ProjectionEngine = {
  calculate(snapshot: FinancialSnapshot, scenario: Scenario): readonly AnnualProjection[] {
    if (scenario.horizon.months < 1 || scenario.horizon.months > 480) throw new RangeError("Projection horizon must be between 1 and 480 months");
    const start = new Date(`${scenario.horizon.start.slice(0, 7)}-01T00:00:00Z`);
    const accounts = new Map(snapshot.accounts.map(a => [a.id, { ...a, balance: a.balanceCents }]));
    const assets = new Map(snapshot.assets.map(a => [a.id, { ...a, value: a.valueCents }]));
    const debts = new Map(snapshot.liabilities.map(l => [l.id, { ...l, balance: l.balanceCents, payment: l.minimumPaymentCents }]));
    // Stored JSON array order is not part of the calculation contract.
    const events = [...scenario.events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const months: MonthlyProjection[] = [];
    let cumulativeDeficit = 0;
    for (let index = 0; index < scenario.horizon.months; index++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)), key = monthKey(date);
      const warnings: string[] = [];
      for (const account of accounts.values()) account.balance = grow(account.balance, account.annualReturnBps, 1);
      for (const asset of assets.values()) asset.value = grow(asset.value, asset.annualGrowthBps, 1);
      let income = 0, expense = 0;
      for (const entry of snapshot.recurring) {
        const count = occurrences(entry, key);
        if (!count) continue;
        const changes = events.filter(e => (e.type === "recurring-change" || e.type === "income-change") && e.entryId === entry.id && e.date.slice(0, 7) <= key);
        const base = changes.length ? (changes.at(-1)! as { amountCents: number }).amountCents : entry.amountCents;
        const value = grow(base, entry.annualGrowthBps ?? (entry.kind === "expense" ? scenario.assumptions.inflationBps : 0), index) * count;
        if (entry.kind === "income") income += value; else expense += value;
      }
      const currentEvents = events.filter(e => e.date.slice(0, 7) === key);
      const account = (id: string) => { const value = accounts.get(id); if (!value) throw new RangeError(`Unknown account: ${id}`); return value; };
      const debt = (id: string) => { const value = debts.get(id); if (!value) throw new RangeError(`Unknown liability: ${id}`); return value; };
      for (const event of currentEvents) {
        if (event.type === "one-time-income") income += event.amountCents;
        else if (event.type === "one-time-expense") expense += event.amountCents;
        else if (event.type === "account-contribution") account(event.accountId).balance += event.amountCents;
        else if (event.type === "account-transfer") { account(event.fromAccountId).balance -= event.amountCents; account(event.toAccountId).balance += event.amountCents; }
        else if (event.type === "asset-purchase") {
          account(event.fundingAccountId).balance -= event.downPaymentCents + event.costsCents;
          assets.set(event.assetId, { id: event.assetId, name: event.name, valueCents: event.valueCents, value: event.valueCents, annualGrowthBps: event.annualGrowthBps });
          if (event.financing) debts.set(event.financing.liabilityId, { id: event.financing.liabilityId, name: event.financing.name, balanceCents: event.financing.principalCents, balance: event.financing.principalCents, annualRateBps: event.financing.annualRateBps, minimumPaymentCents: event.financing.minimumPaymentCents, payment: event.financing.minimumPaymentCents });
        } else if (event.type === "debt-origination") {
          account(event.accountId).balance += event.principalCents;
          debts.set(event.liabilityId, { id: event.liabilityId, name: event.name, balanceCents: event.principalCents, balance: event.principalCents, annualRateBps: event.annualRateBps, minimumPaymentCents: event.minimumPaymentCents, payment: event.minimumPaymentCents });
        } else if (event.type === "debt-payoff") { const d = debt(event.liabilityId), paid = Math.min(d.balance, event.amountCents ?? d.balance); account(event.accountId).balance -= paid; d.balance -= paid;
        } else if (event.type === "asset-sale") {
          if (!assets.has(event.assetId)) throw new RangeError(`Unknown asset: ${event.assetId}`);
          assets.delete(event.assetId); let payoff = 0;
          if (event.payoff && event.payoff.mode !== "none") { const d = debt(event.payoff.liabilityId); payoff = Math.min(d.balance, event.payoff.mode === "full" ? d.balance : event.payoff.amountCents ?? 0); d.balance -= payoff; }
          account(event.destinationAccountId).balance += event.proceedsCents - event.costsCents - payoff;
        }
      }
      for (const item of debts.values()) { if (item.balance <= 0) continue; const due = item.balance + Math.round(item.balance * item.annualRateBps / 120_000); const paid = Math.min(item.payment, due); expense += paid; item.balance = due - paid; }
      const rules = snapshot.taxProfile.taxYear === 2025 ? TAX_RULES_2025 : TAX_RULES_2026;
      const tax = Math.round(estimateTax(income * 12, snapshot.taxProfile.filingStatus, rules, 0, date.getUTCFullYear() > start.getUTCFullYear() + 1).totalCents / 12);
      const surplus = income - expense - tax;
      let unfunded = 0;
      if (surplus > 0) {
        let remaining = surplus;
        const ordered = [...scenario.allocations].sort((a, b) => a.priority - b.priority);
        if (ordered.length && ordered.at(-1)!.percentBps !== 10_000) throw new RangeError("The final allocation rule must be a 100% catch-all");
        for (const rule of ordered) { const target = account(rule.accountId); let amount = Math.round(remaining * rule.percentBps / 10_000); if (rule.targetBalanceCents !== undefined) amount = Math.min(amount, Math.max(0, rule.targetBalanceCents - target.balance)); target.balance += amount; remaining -= amount; }
        if (remaining > 0) { const fallback = snapshot.accounts.find(a => a.liquid); if (fallback) account(fallback.id).balance += remaining; }
      } else if (surplus < 0) { unfunded = -surplus; cumulativeDeficit += unfunded; warnings.push(`Unfunded deficit of ${unfunded} cents`); }
      const liquid = [...accounts.values()].filter(a => a.liquid).reduce((s, a) => s + a.balance, 0) - cumulativeDeficit;
      const accountTotal = [...accounts.values()].reduce((s, a) => s + a.balance, 0), assetTotal = [...assets.values()].reduce((s, a) => s + a.value, 0), debtTotal = [...debts.values()].reduce((s, d) => s + d.balance, 0);
      months.push({ month: key, incomeCents: income, expenseCents: expense, taxCents: tax, surplusCents: surplus, liquidWorthCents: liquid, netWorthCents: accountTotal + assetTotal - debtTotal - cumulativeDeficit, debtCents: debtTotal, unfundedDeficitCents: unfunded, warnings });
    }
    const grouped = new Map<number, MonthlyProjection[]>();
    for (const month of months) { const year = Number(month.month.slice(0, 4)); grouped.set(year, [...(grouped.get(year) ?? []), month]); }
    return [...grouped].map(([year, items]) => ({ year, incomeCents: sum(items, "incomeCents"), expenseCents: sum(items, "expenseCents"), taxCents: sum(items, "taxCents"), surplusCents: sum(items, "surplusCents"), liquidWorthCents: items.at(-1)!.liquidWorthCents, endingNetWorthCents: items.at(-1)!.netWorthCents, debtCents: items.at(-1)!.debtCents, unfundedDeficitCents: sum(items, "unfundedDeficitCents"), warnings: items.flatMap(x => x.warnings), months: items }));
  }
} as const;

function sum(items: MonthlyProjection[], key: "incomeCents" | "expenseCents" | "taxCents" | "surplusCents" | "unfundedDeficitCents") { return items.reduce((total, item) => total + item[key], 0); }
