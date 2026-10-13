import type { ContributionRequest } from '../cash/contribution-requests';
import type { Cents, Filer, History, ValidatedPlan } from '../model/plan';
import type { Available, Issue } from '../model/results';
import { Decimal, settleCents } from '../money';
import type { YearRules } from '../rules/types';
import type { ContributionRecord, IraOwnerYear, IraYear, PreIraFacts } from './facts';
import { combineAvailableCents, mapAvailableCents, rothIraMagi, sumCents, traditionalIraMagi } from './modified-income';
import type { RentalLossYear } from './rental-losses';
import type { WorkplaceYear } from './workplace';
export type { IraOwnerYear, IraYear } from './facts';

const available = (value: Cents): Available<Cents> => ({ status: 'available', value });
const explanations = [
  'IRA limits are shared per owner in month, priority and rule-ID order; unfunded requests remain in cash.',
  'Traditional and Roth MAGI restore IRA deductions and retain allowed rental losses; passive allowance MAGI excludes all passive income or loss.',
  'California conforms to these covered contribution and IRA deduction rules; opening historical basis is preserved separately.',
  'Roth worksheet 2-1 AGI is reconstructed without IRA deductions; modeled passive-loss MAGI already excludes them.',
];
function wholeDollarCents(value: Cents): Cents { return settleCents(new Decimal(settleCents(new Decimal(value).div(100))).mul(100)); }
/** The worksheets require next-$10 rounding and a $200 minimum inside the phaseout. */
function reducedBudget(base: Cents, magi: Cents, start: Cents, end: Cents): Cents {
  const income = wholeDollarCents(magi);
  if (income <= start) return base;
  if (income >= end) return 0;
  const remaining = new Decimal(base).mul(new Decimal(end).minus(income)).div(new Decimal(end).minus(start));
  return Math.min(base, Math.max(20000, settleCents(remaining.div(1000).ceil().mul(1000))));
}
function coverage(filer: Filer, year: number): History<boolean> { return filer.coverageByYear.find(row => row.year === year)?.workplaceCoverage ?? filer.workplaceCoverage; }
interface OwnerBudgets {
  readonly filer: Filer;
  readonly compensation: Available<Cents>;
  readonly limit: Available<Cents>;
  readonly deduction: Available<Cents>;
  readonly roth: Available<Cents>;
}

export function resolveIraContributions(plan: ValidatedPlan, facts: PreIraFacts, rental: RentalLossYear, requests: readonly ContributionRequest[], workplace: WorkplaceYear, rules: YearRules): IraYear {
  const year = facts.year;
  const traditionalMagiCents = traditionalIraMagi(facts, rental, rules);
  const rothMagiCents = rothIraMagi(facts, rental, rules);
  const problem = (recordId: string, code: string, field: string, explanation: string, resolution: string): Issue => ({ code, recordId, year, field, severity: 'warning', explanation, resolution });
  const required = (filer: Filer, code: string, field: string, explanation: string): Available<Cents> => ({ status: 'needs-data', issues: [problem(filer.id, code, field, explanation, 'Supply the explicit age, coverage or contribution history before calculating this dependent amount.')] });
  const compensation = new Map<string, Available<Cents>>();
  for (const filer of plan.household.filers) {
    const wage = workplace.compensationByOwner.find(row => row.ownerId === filer.id)?.annualCents ?? 0;
    const reductions = workplace.records.filter(record => record.ownerId === filer.id && plan.accounts.find(account => account.id === record.accountId)?.type === 'traditional-401k').map(record => record.deductibleCents);
    compensation.set(filer.id, mapAvailableCents(combineAvailableCents(reductions), reduction => Math.max(0, sumCents([wage, -reduction]))));
  }
  const jointCompensation = combineAvailableCents([...compensation.values()]);
  const budgets = new Map<string, OwnerBudgets>();
  for (const filer of plan.household.filers) {
    const age = filer.birthDate.known ? year - Number(filer.birthDate.value.slice(0, 4)) : undefined;
    const limit = age === undefined ? required(filer, 'required-age', 'birthDate', 'The annual IRA limit requires the filer’s age at year end.') : available(sumCents([rules.retirement.iraLimitCents, age >= rules.retirement.iraCatchupMinimumAge ? rules.retirement.iraCatchupCents : 0]));
    const ownCoverage = coverage(filer, year);
    const spouse = plan.household.filers.find(f => f.id !== filer.id)!;
    const spouseCoverage = coverage(spouse, year);
    const coverageConflict = ownCoverage.known && !ownCoverage.value ? [filer, spouse].find(person => {
      const declared = coverage(person, year);
      return declared.known && !declared.value && workplace.records.some(record => record.ownerId === person.id && record.eligibleCents.status === 'available' && record.eligibleCents.value > 0);
    }) : undefined;
    let deduction: Available<Cents>;
    if (coverageConflict) deduction = { status: 'unsupported-case', issues: [problem(coverageConflict.id, 'conflicting-workplace-coverage', 'workplaceCoverage', 'The explicit absence of workplace coverage conflicts with a current funded 401(k).', 'Correct this filer’s current-year workplace coverage before calculating IRA deductions.')] };
    else if (!ownCoverage.known || (!ownCoverage.value && !spouseCoverage.known)) deduction = required(filer, 'required-workplace-coverage', 'workplaceCoverage', 'IRA deductibility requires explicit current-year workplace coverage for the filer and spouse.');
    else if (!ownCoverage.value && spouseCoverage.known && !spouseCoverage.value) deduction = combineAvailableCents([limit, jointCompensation], values => Math.min(...values));
    else {
      const range = ownCoverage.value ? rules.retirement.iraDeductionCovered : rules.retirement.iraDeductionSpouseCovered;
      deduction = combineAvailableCents([limit, traditionalMagiCents, jointCompensation], values => Math.min(reducedBudget(values[0]!, values[1]!, range.startCents, range.endCents), values[2]!));
    }
    const roth = combineAvailableCents([limit, jointCompensation, rothMagiCents], values => reducedBudget(Math.min(values[0]!, values[1]!), values[2]!, rules.retirement.rothIra.startCents, rules.retirement.rothIra.endCents));
    budgets.set(filer.id, { filer, compensation: compensation.get(filer.id)!, limit, deduction, roth });
  }
  const ownerUsed = new Map<string, Cents>(), rothUsed = new Map<string, Cents>();
  let jointUsed = 0;
  let unresolvedPriorFunding: readonly Issue[] = [];
  const records: ContributionRecord[] = [];
  for (const request of [...requests].sort((a, b) => a.month - b.month || a.priority - b.priority || a.ruleId.localeCompare(b.ruleId))) {
    const account = plan.accounts.find(a => a.id === request.accountId);
    if (account?.type === 'traditional-401k' || account?.type === 'roth-401k') continue;
    const rule = plan.contributions.find(r => r.id === request.ruleId);
    const budget = budgets.get(request.ownerId);
    const conversionTarget = request.backdoorRoth ? plan.accounts.find(account => account.id === request.backdoorRoth!.rothIraAccountId) : undefined;
    const reasons: Issue[] = [];
    let eligibleCents: Available<Cents>;
    if (!account || !rule || !budget || rule.accountId !== account.id || account.ownerId !== request.ownerId || request.year !== year || !Number.isInteger(request.month) || request.month < 1 || request.month > 12 || !Number.isSafeInteger(request.requestedCents) || request.requestedCents < 0
      || (request.backdoorRoth && (account.type !== 'traditional-ira' || conversionTarget?.type !== 'roth-ira' || conversionTarget.ownerId !== request.ownerId))) {
      reasons.push(problem(request.ruleId, 'unsupported-contribution-link', 'accountId', 'The request has conflicting owner, account, rule, year or month facts.', 'Regenerate requests from the validated plan.'));
      eligibleCents = { status: 'unsupported-case', issues: reasons };
    } else if (account.type === 'taxable-brokerage') eligibleCents = available(request.requestedCents);
    else if (request.requestedCents === 0) eligibleCents = available(0);
    else if (unresolvedPriorFunding.length) {
      reasons.push(problem(request.ruleId, 'required-prior-ira-funding', 'amount', 'An earlier IRA request has unresolved eligibility under shared compensation or owner limits.', 'Resolve the earlier eligibility before funding overlapping requests.'));
      eligibleCents = { status: 'needs-data', issues: reasons };
    } else {
      const capacity = account.type === 'roth-ira' ? combineAvailableCents([budget.limit, jointCompensation, budget.roth], values => Math.max(0, Math.min(values[0]! - (ownerUsed.get(request.ownerId) ?? 0), values[1]! - jointUsed, values[2]! - (rothUsed.get(request.ownerId) ?? 0)))) : combineAvailableCents([budget.limit, jointCompensation], values => Math.max(0, Math.min(values[0]! - (ownerUsed.get(request.ownerId) ?? 0), values[1]! - jointUsed)));
      if (capacity.status !== 'available') {
        eligibleCents = capacity;
        reasons.push(...capacity.issues.map(issue => ({ ...issue, recordId: request.ruleId })));
        unresolvedPriorFunding = reasons;
      } else {
        const funded = Math.min(request.requestedCents, capacity.value);
        if (funded > 0 && request.backdoorRoth && request.backdoorRoth.readiness.status !== 'available') {
          eligibleCents = request.backdoorRoth.readiness;
          reasons.push(...request.backdoorRoth.readiness.issues);
          unresolvedPriorFunding = reasons;
        } else {
          eligibleCents = available(funded);
          ownerUsed.set(request.ownerId, sumCents([ownerUsed.get(request.ownerId) ?? 0, funded]));
          jointUsed = sumCents([jointUsed, funded]);
          if (account.type === 'roth-ira') rothUsed.set(request.ownerId, sumCents([rothUsed.get(request.ownerId) ?? 0, funded]));
        }
      }
    }
    if (eligibleCents.status === 'available' && eligibleCents.value < request.requestedCents) reasons.push(problem(request.ruleId, 'ira-contribution-capped', 'amount', 'The request exceeds the owner IRA, compensation or Roth income-eligibility limit.', 'Reduce this rule or adjust its priority; prevented cents remain in cash.'));
    const preventedCents = mapAvailableCents(eligibleCents, value => request.requestedCents - value);
    records.push({ ruleId: request.ruleId, accountId: request.accountId, ownerId: request.ownerId, year, month: request.month, requestedCents: request.requestedCents, eligibleCents, deductibleCents: available(0), nondeductibleCents: eligibleCents, preventedCents, reasons,
      ...(request.backdoorRoth ? { conversionRothAccountId: request.backdoorRoth.rothIraAccountId } : {}) });
  }
  // Deduction priority is applied to funded traditional deposits only. Coverage
  // can block the deduction without preventing otherwise legal funding.
  const deductibleUsed = new Map<string, Cents>();
  const finalized = records.map(record => {
    const account = plan.accounts.find(a => a.id === record.accountId);
    if (account?.type !== 'traditional-ira') return record;
    // Explicit nondeductible election applies independently to federal and CA.
    if (record.conversionRothAccountId) {
      if (record.eligibleCents.status === 'available' && record.eligibleCents.value > 0 && records.some(other => other.ownerId === record.ownerId && !other.conversionRothAccountId
        && plan.accounts.find(account => account.id === other.accountId)?.type === 'traditional-ira'
        && (other.eligibleCents.status !== 'available' || other.eligibleCents.value > 0))) {
        const reason = problem(record.ruleId, 'unsupported-backdoor-other-ira-funding', 'destination.backdoorRoth', 'Other traditional IRA funding in this year requires a broader basis and conversion calculation.', 'Use only the clean contribution-and-conversion route or supply a separately supported pro-rata calculation.');
        const unresolved: Available<Cents> = { status: 'unsupported-case', issues: [reason] };
        return { ...record, eligibleCents: unresolved, nondeductibleCents: unresolved, preventedCents: unresolved, reasons: [...record.reasons, reason] };
      }
      return record;
    }
    const budget = budgets.get(record.ownerId)!.deduction;
    const deductibleCents = record.eligibleCents.status === 'available' && record.eligibleCents.value === 0 ? available(0) : combineAvailableCents([record.eligibleCents, budget], values => Math.min(values[0]!, Math.max(0, values[1]! - (deductibleUsed.get(record.ownerId) ?? 0))));
    if (deductibleCents.status === 'available') deductibleUsed.set(record.ownerId, sumCents([deductibleUsed.get(record.ownerId) ?? 0, deductibleCents.value]));
    const nondeductibleCents = combineAvailableCents([record.eligibleCents, deductibleCents], values => sumCents([values[0]!, -values[1]!]));
    const reasons = deductibleCents.status === 'available' ? record.reasons : [...record.reasons, ...deductibleCents.issues.map(issue => ({ ...issue, recordId: record.ruleId }))];
    return { ...record, deductibleCents, nondeductibleCents, reasons };
  });
  const owners: IraOwnerYear[] = [...plan.household.filers].sort((a, b) => a.id.localeCompare(b.id)).map(filer => {
    const ownerRecords = finalized.filter(record => record.ownerId === filer.id && plan.accounts.find(a => a.id === record.accountId)?.type !== 'taxable-brokerage');
    const traditional = ownerRecords.filter(record => plan.accounts.find(a => a.id === record.accountId)?.type === 'traditional-ira');
    const deduction = combineAvailableCents(traditional.map(record => record.deductibleCents));
    const newBasisCents = combineAvailableCents(traditional.map(record => record.nondeductibleCents));
    const openingBasis: History<Cents> = rental.closing.iraBasisByOwner[filer.id] ?? { known: false };
    const convertedBasisCents = combineAvailableCents(traditional.filter(record => record.conversionRothAccountId).map(record => record.eligibleCents));
    const closingBasis: History<Cents> = openingBasis.known && newBasisCents.status === 'available' && convertedBasisCents.status === 'available' ? { known: true, value: sumCents([openingBasis.value, newBasisCents.value, -convertedBasisCents.value]) } : { known: false };
    const budget = budgets.get(filer.id)!;
    return { ownerId: filer.id, compensationCents: budget.compensation, ownerLimitCents: budget.limit, traditionalDeductionLimitCents: budget.deduction, rothContributionLimitCents: budget.roth, eligibleCents: combineAvailableCents(ownerRecords.map(record => record.eligibleCents)), federalDeductibleCents: deduction, californiaDeductibleCents: deduction, nondeductibleCents: combineAvailableCents(ownerRecords.map(record => record.nondeductibleCents)), newBasisCents, openingBasis, closingBasis };
  });
  const issues = [...new Map(finalized.flatMap(record => record.reasons).map(issue => [JSON.stringify(issue), issue])).values()];
  return { year, records: finalized, owners, federalDeductibleCents: combineAvailableCents(owners.map(owner => owner.federalDeductibleCents)), californiaDeductibleCents: combineAvailableCents(owners.map(owner => owner.californiaDeductibleCents)), nondeductibleCents: combineAvailableCents(owners.map(owner => owner.nondeductibleCents)), traditionalMagiCents, rothMagiCents, closingIraBasisByOwner: Object.fromEntries(owners.map(owner => [owner.ownerId, owner.closingBasis])), issues, explanations };
}
