import type { CashYear } from '../cash/income';
import type { Cents } from '../model/plan';
import type { Issue, RuleProvenance } from '../model/results';
import { Decimal, settleCents, settleSeries } from '../money';
import type { YearRules } from '../rules/types';
import { usedRuleProvenance, type WorkplaceYear } from './workplace';

export interface PayrollAmounts {
  readonly socialSecurityCents: Cents;
  readonly medicareCents: Cents;
  readonly additionalMedicareCents: Cents;
  readonly sdiCents: Cents;
  readonly totalCents: Cents;
}
export interface PayrollMonth extends PayrollAmounts { readonly year: number; readonly month: number }
export interface OwnerPayroll {
  readonly ownerId: string;
  readonly wageCents: Cents;
  readonly monthlyWageCents: readonly Cents[];
  readonly months: readonly PayrollMonth[];
  readonly annual: PayrollAmounts;
}
export interface PayrollYear {
  readonly year: number;
  readonly months: readonly PayrollMonth[];
  readonly annual: PayrollAmounts;
  readonly owners: readonly OwnerPayroll[];
  readonly provenance: readonly RuleProvenance[];
  readonly issues: readonly Issue[];
}
const sum = (values: readonly Cents[]): Cents => settleCents(values.reduce((a, b) => a.plus(b), new Decimal(0)));
const components = ['socialSecurityCents', 'medicareCents', 'additionalMedicareCents', 'sdiCents', 'totalCents'] as const;
function total(values: readonly PayrollAmounts[]): PayrollAmounts { return Object.fromEntries(components.map(key => [key, sum(values.map(v => v[key]))])) as unknown as PayrollAmounts; }
function wageTax(wages: readonly Cents[], rateBps: number, capCents: Cents | null): readonly Cents[] {
  let cumulative = new Decimal(0), prior = new Decimal(0);
  return wages.map(wage => {
    cumulative = cumulative.plus(wage);
    const base = capCents === null ? cumulative : Decimal.min(cumulative, capCents);
    const liability = new Decimal(settleCents(base.mul(rateBps).div(10000)));
    const due = settleCents(liability.minus(prior)); prior = liability; return due;
  });
}

/** Employee liability: owner SS caps and a joint MFJ Medicare threshold. */
export function calculatePayroll(cash: CashYear, workplace: WorkplaceYear, rules: YearRules): PayrollYear {
  const ownerWages = [...workplace.filers].sort((a, b) => a.id.localeCompare(b.id)).map(filer => ({ ownerId: filer.id, monthly: Array.from({ length: 12 }, (_, i) => sum(cash.wages.filter(w => w.ownerId === filer.id).map(w => w.monthlyCents[i] ?? 0))) }));
  const joint = Array.from({ length: 12 }, (_, i) => sum(ownerWages.map(owner => owner.monthly[i] ?? 0)));
  let jointCumulative = new Decimal(0), previousExtra = new Decimal(0);
  const extra = joint.map(wage => {
    jointCumulative = jointCumulative.plus(wage);
    const due = new Decimal(settleCents(Decimal.max(0, jointCumulative.minus(rules.payroll.additionalMedicareThresholdCents)).mul(rules.payroll.additionalMedicareRateBps).div(10000)));
    const result = settleCents(due.minus(previousExtra)); previousExtra = due; return result;
  });
  const ownerExtra: Cents[][] = ownerWages.map(() => []);
  for (let i = 0; i < 12; i++) {
    const parts = settleSeries(ownerWages.map(owner => joint[i] ? new Decimal(extra[i] ?? 0).mul(owner.monthly[i] ?? 0).div(joint[i]!) : new Decimal(0)));
    parts.forEach((value, ownerIndex) => { ownerExtra[ownerIndex]![i] = value; });
  }
  const owners: OwnerPayroll[] = ownerWages.map((owner, ownerIndex) => {
    const ss = wageTax(owner.monthly, rules.payroll.socialSecurityRateBps, rules.payroll.socialSecurityWageBaseCents);
    const medicare = wageTax(owner.monthly, rules.payroll.medicareRateBps, null);
    const sdi = wageTax(owner.monthly, rules.payroll.sdiRateBps, rules.payroll.sdiWageBaseCents);
    const months: PayrollMonth[] = Array.from({ length: 12 }, (_, i) => ({ year: cash.year, month: i + 1, socialSecurityCents: ss[i]!, medicareCents: medicare[i]!, additionalMedicareCents: ownerExtra[ownerIndex]![i]!, sdiCents: sdi[i]!, totalCents: sum([ss[i]!, medicare[i]!, ownerExtra[ownerIndex]![i]!, sdi[i]!]) }));
    return { ownerId: owner.ownerId, wageCents: sum(owner.monthly), monthlyWageCents: owner.monthly, months, annual: total(months) };
  });
  const months = Array.from({ length: 12 }, (_, i) => ({ year: cash.year, month: i + 1, ...total(owners.map(owner => owner.months[i]!)) }));
  return { year: cash.year, months, annual: total(months), owners, provenance: usedRuleProvenance(rules, Object.keys(rules.provenance).filter(path => path.startsWith('payroll.')).sort()), issues: [] };
}
