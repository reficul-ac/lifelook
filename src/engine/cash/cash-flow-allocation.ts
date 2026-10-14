import type { Cents, ValidatedPlan } from '../model/plan';
import type { Available, Issue } from '../model/results';
import type { HouseholdTaxState } from '../model/tax-state';
import type { PropertyYearFacts } from '../property/facts';
import type { LoanSchedule } from '../property/loans';
import type { YearRules } from '../rules/types';
import { resolveHouseholdYear, type HouseholdYear } from '../tax/comparison';
import type { CashYear } from './income';
import type { ContributionRequest } from './contribution-requests';
import type { CashFlowAllocationYear } from './allocation-types';
import { createAllocationAdapter, type AllocationAdapter } from './allocation-adapter';
import { allocationFundingCeilings, scheduleAllocationFunding, settleAllocationTargets, type FundingTarget, type EmployerFundingBudget } from './allocation-funding';
import { allocateAnnualTax } from './tax-timing';
import { resolveWorkplaceContributions } from '../tax/workplace';
import { Decimal, settleCents, assertMonetaryRange } from '../money';
import { backdoorRothReadiness } from './backdoor-roth';


export interface AllocationYearInput {
 readonly plan: ValidatedPlan; readonly cash: CashYear; readonly legacyRequests: readonly ContributionRequest[];
 readonly property: PropertyYearFacts; readonly loans: readonly LoanSchedule[]; readonly opening: HouseholdTaxState; readonly rules: YearRules;
 readonly cashIncomeByMonth: readonly Cents[]; readonly expensesByMonth: readonly Cents[]; readonly debtPaymentsByMonth: readonly Cents[];
 readonly rsuWithholdingByMonth: readonly Cents[]; readonly taxWeightsByMonth: readonly Cents[];
 readonly financedConstructionByMonth?:readonly Cents[];
 readonly openingUnrestrictedCashCents?:Available<Cents>;
 readonly openingAccountBalances?: ReadonlyMap<string, Available<Cents>>;
}
export interface ResolvedAllocationYear {
 readonly household: HouseholdYear; readonly requests: readonly ContributionRequest[]; readonly report: CashFlowAllocationYear;
 readonly allocationBudgetByMonth?:readonly Cents[];
 readonly incomeTaxByMonth: readonly Cents[]; readonly preTransferCashByMonth: readonly Cents[];
}

const sum = (values: readonly Cents[]): Cents => settleCents(values.reduce((total, value) => total.plus(value), new Decimal(0)));
const available = <T>(value: T): Available<T> => ({ status: 'available', value });
function missing<T>(values: readonly Available<unknown>[]): Available<T> | undefined {
  const unresolved = values.filter(value => value.status !== 'available');
  return unresolved.length ? { status: unresolved.some(value => value.status === 'unsupported-case') ? 'unsupported-case' : 'needs-data', issues: unresolved.flatMap(value => value.issues) } : undefined;
}
function readiness(household: HouseholdYear): Available<never> | undefined {
  return missing([household.tax, ...household.contributions.flatMap(record => [record.eligibleCents, record.deductibleCents, record.nondeductibleCents])]);
}
function eligible(household: HouseholdYear, ruleId?: string): Cents {
  return sum(household.contributions.filter(record => ruleId === undefined || record.ruleId === ruleId).map(record => record.eligibleCents.status === 'available' ? record.eligibleCents.value : 0));
}
function cashTiming(input: AllocationYearInput, household: HouseholdYear) {
  if (household.tax.status !== 'available') throw new Error('Tax timing requires resolved tax.');
  const federal = allocateAnnualTax(household.tax.value.federal.totalCents, input.taxWeightsByMonth);
  const california = allocateAnnualTax(household.tax.value.california.totalCents, input.taxWeightsByMonth);
  const incomeTaxByMonth = federal.map((value, month) => sum([value, california[month]!]));
  const preTransferCashByMonth = input.cashIncomeByMonth.map((value, month) => sum([value, -input.expensesByMonth[month]!, -input.debtPaymentsByMonth[month]!, -household.payroll.months[month]!.totalCents, -incomeTaxByMonth[month]!, input.rsuWithholdingByMonth[month]!]));
  return { incomeTaxByMonth, preTransferCashByMonth,...(input.financedConstructionByMonth?{allocationBudgetByMonth:preTransferCashByMonth.map((a,i)=>sum([a,input.financedConstructionByMonth![i]!]))}:{}) };
}
function requestsFor(adapter: AllocationAdapter, year: number, targets: readonly FundingTarget[], ceilings: readonly Cents[], employers: readonly EmployerFundingBudget[], routeReadiness: ReadonlyMap<string, Available<true>>): readonly ContributionRequest[] {
  const schedule = scheduleAllocationFunding(targets, ceilings, employers);
  return targets.flatMap(target => {
    const source = adapter.sourceMap.get(target.ruleId)!;
    if (source.destination.kind !== 'account') return [];
    const destination = source.destination;
    const account = adapter.plan.accounts.find(account => account.id === (destination.backdoorRoth?.traditionalIraAccountId ?? destination.accountId))!;
    const sponsor = adapter.plan.salaries.find(salary => salary.id === destination.sponsoringSalaryId);
    return schedule.requestsByRule.get(target.ruleId)!.flatMap((requestedCents, index) => requestedCents ? [{ ruleId: target.ruleId, accountId: account.id, ownerId: account.ownerId, year, month: index + 1, priority: target.priority, requestedCents,
      ...(destination.backdoorRoth ? { backdoorRoth: { rothIraAccountId: destination.accountId, readiness: routeReadiness.get(target.ruleId)! } } : {}),
      ...(sponsor ? { sponsoringSalaryId: sponsor.id, employerId: sponsor.employerId } : {}) }] : []);
  });
}

/** Every trial starts from the caller's opening state; only the verified fixed point escapes. */
export function resolveAllocationYear(input: AllocationYearInput, resolveHousehold = resolveHouseholdYear): Available<ResolvedAllocationYear> {
  for (const months of [input.cashIncomeByMonth, input.expensesByMonth, input.debtPaymentsByMonth, input.rsuWithholdingByMonth, input.taxWeightsByMonth,...(input.financedConstructionByMonth?[input.financedConstructionByMonth]:[])]) {
    if (months.length !== 12) throw new RangeError('Allocation requires twelve monthly amounts.');
    months.forEach(value => { if (!Number.isSafeInteger(value)) throw new RangeError('Allocation requires integer cents.'); assertMonetaryRange(new Decimal(value)); });
  }
  if(input.openingUnrestrictedCashCents&&input.openingUnrestrictedCashCents.status!=='available')return input.openingUnrestrictedCashCents;
  const savedPolicy = input.plan.cashFlowAllocation;
  if (!savedPolicy) throw new Error('Allocation requires a policy.');
  const policy = savedPolicy;
  const adapter = createAllocationAdapter(input.plan, input.cash.year);
  // All other household inputs are fixed within this one year solve. Keep the
  // complete request order in the key: monthly chronology can change legality.
  const searchResults = new Map<string, HouseholdYear>();
  const evaluate = (requests: readonly ContributionRequest[], evaluator?: typeof resolveHouseholdYear): HouseholdYear => {
    // Explicit outer and final verification calls must always execute freshly,
    // even when their evaluator is the authoritative default function.
    if (evaluator) return evaluator(adapter.plan, input.cash, requests, input.property, input.loans, input.opening, input.rules);
    const key = JSON.stringify(requests);
    const cached = searchResults.get(key);
    if (cached) return cached;
    const result = resolveHouseholdYear(adapter.plan, input.cash, requests, input.property, input.loans, input.opening, input.rules);
    // Eviction only recomputes pure search work; it never truncates the search.
    if (searchResults.size >= 256) searchResults.delete(searchResults.keys().next().value!);
    searchResults.set(key, result);
    return result;
  };
  const existingBaseline = evaluate(input.legacyRequests);
  const existingMissing = readiness(existingBaseline);
  if (existingMissing) return existingMissing;
  const routeReadiness = new Map([...adapter.sourceMap].map(([id, source]) => [id, backdoorRothReadiness(input.plan, source, input.cash.year, input.opening, existingBaseline.contributions, input.openingAccountBalances)]));
  const workplace = resolveWorkplaceContributions(adapter.plan, input.cash, input.legacyRequests, input.rules);
  const employers = workplace.compensationByEmployer.map(employer => ({ key: JSON.stringify([employer.ownerId, employer.employerId]), monthlyCents: employer.monthlyCents.map((amount, month) => Math.max(0, amount - sum(workplace.records.filter(record => record.ownerId === employer.ownerId && record.month === month + 1 && input.legacyRequests.find(request => request.ruleId === record.ruleId)?.employerId === employer.employerId).map(record => record.eligibleCents.status === 'available' ? record.eligibleCents.value : 0)))) }));
  const locate = (issues: readonly Issue[], ruleId: string) => {
    return issues.map(issue => {
      // Legal facts belong to their producing rule, including protected legacy
      // rules. Only allocation-owned records need a policy field translation.
      const source = adapter.sourceMap.get(issue.recordId ?? ruleId)
        ?? (issue.recordId === policy.id ? adapter.sourceMap.get(ruleId) : undefined);
      return source ? { ...issue, recordId: source.policyId, field: `${source.fieldPrefix}.${issue.field ?? 'destination'}` } : issue;
    });
  };
  const issue = (code: string, explanation: string): Issue => ({ code, recordId: policy.id, year: input.cash.year, field: 'cashFlowAllocation', severity: 'warning', explanation, resolution: 'Adjust allocation targets or supply the required legal and tax facts.' });
  const nonconvergence = (): Available<never> => ({ status: 'unsupported-case', issues: [issue('allocation-nonconvergence', 'Annual allocation and taxes did not reach a verified stable result.')] });

  function allocate(previous: HouseholdYear): Available<{ requests: readonly ContributionRequest[]; report: CashFlowAllocationYear }> {
    const existing: HouseholdYear = { ...existingBaseline, contributions: previous.contributions.filter(record => !adapter.sourceMap.has(record.ruleId)) };
    const existingByAccount = (accountId: string) => sum(existing.contributions.filter(record => record.accountId === accountId).map(record => record.eligibleCents.status === 'available' ? record.eligibleCents.value : 0));
    const timing = cashTiming(input, previous);
    const budget=timing.allocationBudgetByMonth??timing.preTransferCashByMonth;
    const original = sum(budget);
    const percentageTargets = new Map(settleAllocationTargets(original, policy.entries).map(target => [target.entryId, target.targetCents]));
    const afterExisting = budget.map((value, month) => sum([value, -sum(existing.contributions.filter(record => record.month === month + 1).map(record => record.eligibleCents.status === 'available' ? record.eligibleCents.value : 0))]));
    const liquidAfterExisting=afterExisting.map((value,i)=>sum([value,i===0&&input.openingUnrestrictedCashCents?.status==='available'?Math.min(0,input.openingUnrestrictedCashCents.value):0]));
    const cashEntry = policy.entries.find(entry => entry.destination.kind === 'cash');
    const explicitCashTarget = cashEntry ? percentageTargets.get(cashEntry.id) ?? 0 : 0;
    let explicitCash = 0;
    let ceilings = allocationFundingCeilings(liquidAfterExisting, explicitCash);
    let targets: FundingTarget[] = [];
    let acceptedRequests: readonly ContributionRequest[] = input.legacyRequests;
    let protectedHousehold = existing;
    let protectionFloors = new Map<string, Cents>();
    const reasons: Issue[] = [];
    const accountTargets = new Map<string, Cents>();
    const funded = new Map<string, { percent: Cents; max: Cents; overflow: Cents }>();
    const protectedAmounts = (h: HouseholdYear) => new Map([...new Set(h.contributions.map(record => record.ruleId))].map(id => [id, eligible(h, id)]));

    function add(ruleId: string, stage: FundingTarget['stage'], priority: number, desired: Cents, limits = ceilings): Available<Cents> {
      const source = adapter.sourceMap.get(ruleId)!;
      if (source.destination.kind !== 'account') return available(0);
      const salaryId = source.destination.sponsoringSalaryId;
      const sponsor = adapter.plan.salaries.find(salary => salary.id === salaryId);
      const target: FundingTarget = { ruleId, stage, priority, requestedCents: desired, allowedMonths: Array.from({ length: 12 }, (_, i) => i + 1), ...(sponsor ? { employerKey: JSON.stringify([sponsor.ownerId, sponsor.employerId]) } : {}) };
      const protectedTotals = protectedAmounts(protectedHousehold);
      for (const [id, floor] of protectionFloors) protectedTotals.set(id, floor);
      const destinationAccount = adapter.plan.accounts.find(account => source.destination.kind === 'account' && account.id === source.destination.accountId)!;
      // New or saved IRA eligibility can be created by a later traditional deferral.
      // Use the previous complete trial as context while reserving this stage,
      // but never publish or carry these supporting trial requests as funding.
      const support = stage !== 'overflow' && !destinationAccount.type.endsWith('-401k') ? previous.contributions.flatMap(record => {
        const descriptor = adapter.plan.contributions.find(rule => rule.id === record.ruleId);
        const account = adapter.plan.accounts.find(account => account.id === record.accountId);
        const later = adapter.sourceMap.has(record.ruleId) && !targets.some(target => target.ruleId === record.ruleId) && record.ruleId !== ruleId;
        if (!later || account?.type !== 'traditional-401k' || record.eligibleCents.status !== 'available' || !record.eligibleCents.value || !descriptor) return [];
        const salary = adapter.plan.salaries.find(salary => salary.id === descriptor.sponsoringSalaryId)!;
        return [{ ruleId: record.ruleId, accountId: record.accountId, ownerId: record.ownerId, year: record.year, month: record.month, priority: descriptor.priority, requestedCents: record.eligibleCents.value, sponsoringSalaryId: salary.id, employerId: salary.employerId }];
      }) : [];
      const supportIds = new Set(support.map(request => request.ruleId));
      const regularFirstRules = new Set<string>();
      const probe = (amount: Cents, firstMonth = 1, orderRegularFirst = false) => {
        const earlier = targets.map(prior => {
          if (!orderRegularFirst || !regularFirstRules.has(prior.ruleId)) return prior;
          const sameMonthFirst = prior.priority < priority || (prior.priority === priority && prior.ruleId.localeCompare(ruleId) < 0);
          return { ...prior, allowedMonths: prior.allowedMonths.filter(month => month < firstMonth || (month === firstMonth && sameMonthFirst)) };
        });
        const candidate = [...earlier, { ...target, requestedCents: amount, allowedMonths: target.allowedMonths.filter(month => month >= firstMonth) }];
        const requests = [...input.legacyRequests, ...requestsFor(adapter, input.cash.year, candidate, limits, employers, routeReadiness)];
        const actual = evaluate(requests);
        const contextual = support.length ? evaluate([...requests, ...support]) : actual;
        const household = support.length ? { ...contextual, contributions: contextual.contributions.filter(record => !supportIds.has(record.ruleId)) } : actual;
        const unavailable = readiness(household);
        const requested = sum(requests.filter(request => request.ruleId === ruleId).map(request => request.requestedCents));
        const preserves = [...protectedTotals].every(([id, value]) => eligible(household, id) >= value)
          && existing.contributions.every(record => household.contributions.some(other => other.ruleId === record.ruleId && other.month === record.month && other.eligibleCents.status === 'available' && record.eligibleCents.status === 'available' && other.eligibleCents.value >= record.eligibleCents.value));
        return { candidate, requests, household, actual, unavailable, requested, preserves, firstMonth, orderRegularFirst, valid: !unavailable && preserves && eligible(household, ruleId) === requested };
      };
      let trial = probe(desired);
      const scheduledDesired = trial.requested;
      if (trial.unavailable && trial.unavailable.status !== 'available') return { ...trial.unavailable, issues: locate(trial.unavailable.issues, ruleId) };
      if (!trial.valid) {
        const initial = trial;
        let best = probe(0);
        // Employer-specific restrictions can reserve regular funding for an
        // earlier traditional account while a later employer permits either
        // Roth or traditional catch-up. Discover the displaced regular rules
        // from authoritative eligibility; account type alone is insufficient.
        for (const record of initial.household.contributions) {
          const protectedAmount = protectedTotals.get(record.ruleId) ?? 0;
          if (sponsor && record.ownerId === sponsor.ownerId && protectedAmount > eligible(initial.household, record.ruleId)
            && record.reasons.some(reason => reason.code === 'mandatory-roth-catchup')) regularFirstRules.add(record.ruleId);
        }
        const needsLaterWindow = regularFirstRules.size > 0;
        for (let firstMonth = 1; firstMonth <= (needsLaterWindow ? 12 : 1); firstMonth++) {
          const ordered = !!needsLaterWindow;
          const empty = probe(0, firstMonth, ordered);
          // Later demand cannot restore regular funding excluded by this
          // window, but traditional catch-up can restore saved IRA eligibility.
          // Skip only windows that already lose the protected regular amounts.
          if (ordered && [...regularFirstRules].some(id => eligible(empty.actual, id) < (protectedTotals.get(id) ?? 0))) continue;
          const full = firstMonth === 1 && !ordered ? initial : probe(desired, firstMonth, ordered);
          let candidate = full;
          if (!candidate.valid && candidate.preserves && !candidate.unavailable) {
            // Authoritative capped deposits give a direct capacity candidate.
            // Verify it with the new schedule before avoiding a cent search.
            candidate = probe(eligible(full.household, ruleId), firstMonth, ordered);
          }
          if (!candidate.valid) {
            let low = 0, high = Math.min(desired, full.requested);
            while (low < high) {
              const middle = low + Math.ceil((high - low) / 2);
              const trial = probe(middle, firstMonth, ordered);
              if (trial.valid) low = middle; else high = middle - 1;
            }
            candidate = probe(low, firstMonth, ordered);
          }
          if (eligible(candidate.household, ruleId) > eligible(best.household, ruleId)) best = candidate;
          if (eligible(best.household, ruleId) === desired) break;
        }
        trial = best;
      }
      const amount = eligible(trial.household, ruleId);
      if (amount < scheduledDesired) {
        // Diagnose only the marginal refusal in the recovered schedule. Initial
        // discovery/chronology failures do not explain an accepted result.
        // This extra read-only probe never changes targets or accepted requests.
        const boundary = probe(amount + 1, trial.firstMonth, trial.orderRegularFirst);
        for (const record of boundary.household.contributions) {
          const savedMonth = existing.contributions.find(saved => saved.ruleId === record.ruleId && saved.month === record.month);
          const displaced = record.ruleId !== ruleId && (
            eligible(boundary.household, record.ruleId) < (protectedTotals.get(record.ruleId) ?? 0)
            || savedMonth?.eligibleCents.status === 'available' && record.eligibleCents.status === 'available' && record.eligibleCents.value < savedMonth.eligibleCents.value);
          if (record.ruleId === ruleId && record.eligibleCents.status === 'available' && record.eligibleCents.value < record.requestedCents) reasons.push(...locate(record.reasons, ruleId));
          else if (displaced) {
            const account = adapter.plan.accounts.find(account => account.id === record.accountId)!;
            reasons.push(...locate([{ ...issue('allocation-protected-limit', `Additional funding here would reduce protected deposits for ${account.name}. Those deposits retain their funding.`), field: 'destination' }], ruleId));
            // Monthly funding can consume shared capacity before a later saved
            // deposit, so its authoritative cap also explains this refusal.
            if (record.reasons.some(reason => reason.code === 'contribution-capped')) reasons.push(...locate([{ ...issue('contribution-capped', `Additional funding here would cap protected deposits for ${account.name}. Those deposits retain their funding.`), field: 'destination' }], ruleId));
            reasons.push(...locate(record.reasons.map(reason => ({ ...reason, explanation: `A rejected additional allocation would reduce these protected deposits. ${reason.explanation}` })), record.ruleId));
          }
        }
      }
      if (amount === scheduledDesired && scheduledDesired < desired) reasons.push(...locate([{ ...issue(sponsor ? 'allocation-compensation-timing' : 'allocation-cash-shortfall', sponsor ? 'Available cash and sponsoring monthly wages cannot fund the complete target together.' : 'Available cash cannot fund the complete target while preserving earlier allocations.'), field: 'destination' }], ruleId));
      targets = trial.candidate.map(candidate => candidate.ruleId === ruleId ? { ...candidate, requestedCents: amount } : candidate);
      acceptedRequests = trial.requests;
      protectedHousehold = trial.household;
      // Only the extra eligibility enabled by future trial deductions is
      // provisional. Existing and independently eligible primary deposits keep
      // their full reservation against all lower stages.
      protectionFloors.set(ruleId, Math.min(amount, eligible(trial.actual, ruleId)));
      return available(amount);
    }
    const sorted = [...policy.entries].sort((a, b) => Number(a.amount.kind === 'max-annual') - Number(b.amount.kind === 'max-annual') || a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const entry of sorted) {
      if (entry.destination.kind === 'cash') {
        // Cash competes in percentage order, then its actual earmark is
        // protected from all later deposits without reducing earlier funding.
        explicitCash = Math.min(explicitCashTarget, Math.max(0, sum([original, -eligible(protectedHousehold)])));
        ceilings = allocationFundingCeilings(liquidAfterExisting, explicitCash);
        if (explicitCash < explicitCashTarget) reasons.push({ ...issue('allocation-cash-shortfall', 'Available annual cash cannot meet the explicit saving target while preserving eligible saved deposits and earlier percentage allocations.'), field: `cashFlowAllocation.entries.${policy.entries.findIndex(source => source.id === entry.id)}.amount`, resolution: 'Review the saving percentage and visible percentage priorities; saved deposits and earlier funding remain protected.' });
        continue;
      }
      const accountId = entry.destination.accountId;
      const stage = entry.amount.kind === 'percent' ? 'percent' : 'max';
      let target = percentageTargets.get(entry.id) ?? 0;
      if (stage === 'max') {
        // Probe the authoritative resolver with annual wage/IRA bounds and no
        // cash restriction; this discovers legal capacity, not statutory formulas.
        const account = adapter.plan.accounts.find(account => account.id === accountId)!;
        const owner = previous.ira.owners.find(owner => owner.ownerId === account.ownerId)!;
        const limit = account.type.endsWith('-ira') ? owner.ownerLimitCents : available(sum(workplace.compensationByOwner.map(owner => owner.annualCents)));
        if (limit.status !== 'available') return { ...limit, issues: locate(limit.issues, entry.id) };
        const saved = { targets, acceptedRequests, protectedHousehold, protectionFloors: new Map(protectionFloors), reasonCount: reasons.length };
        const unlimited = Array<Cents>(12).fill(sum([limit.value, ...targets.map(target => target.requestedCents)]));
        const capacity = add(entry.id, stage, entry.priority, limit.value, unlimited);
        // Retain only the capacity explanation produced by the marginal legal
        // refusal, including a known zero maximum; restore all discovery state.
        const capacityReasons = reasons.splice(saved.reasonCount);
        targets = saved.targets; acceptedRequests = saved.acceptedRequests; protectedHousehold = saved.protectedHousehold; protectionFloors = saved.protectionFloors;
        if (capacity.status !== 'available') return capacity;
        target = sum([existingByAccount(accountId), capacity.value]);
        reasons.push(...capacityReasons.map(reason => ({ ...reason, explanation: `This restriction determines the computed annual maximum. ${reason.explanation}` })));
      }
      accountTargets.set(accountId, target);
      if (existingByAccount(accountId) > target) reasons.push(...locate([{ ...issue('allocation-existing-above-target', 'Eligible saved deposits exceed the configured target; those deposits keep their saved amounts and dates.'), field: 'amount' }], entry.id));
      const result = add(entry.id, stage, entry.priority, Math.max(0, target - existingByAccount(accountId)));
      if (result.status !== 'available') return result;
      funded.set(accountId, { percent: stage === 'percent' ? result.value : 0, max: stage === 'max' ? result.value : 0, overflow: 0 });
    }
    const excessOffered = Math.max(0, sum([original, -eligible(protectedHousehold), -explicitCash]));
    let excessAccepted = 0;
    if (policy.overflow.destination.kind === 'account' && excessOffered > 0) {
      const result = add(policy.overflow.id, 'overflow', 0, excessOffered);
      if (result.status !== 'available') reasons.push(...result.issues);
      else {
        excessAccepted = result.value;
        const id = policy.overflow.destination.accountId;
        funded.set(id, { ...(funded.get(id) ?? { percent: 0, max: 0, overflow: 0 }), overflow: excessAccepted });
      }
    }
    const uniqueReasons = [...new Map(reasons.map(reason => [JSON.stringify(reason), reason])).values()];
    const ids = [...new Set([...existing.contributions.map(record => record.accountId), ...accountTargets.keys(), ...(policy.overflow.destination.kind === 'account' ? [policy.overflow.destination.accountId] : [])])];
    const accounts = ids.map(accountId => {
      const amounts = funded.get(accountId) ?? { percent: 0, max: 0, overflow: 0 };
      const existingCents = existingByAccount(accountId), targetCents = accountTargets.get(accountId) ?? existingCents;
      const actualCents = sum([existingCents, amounts.percent, amounts.max, amounts.overflow]);
      return { accountId, targetCents, existingCents, percentageCents: amounts.percent, maximumCents: amounts.max, excessCents: amounts.overflow, actualCents, shortfallCents: Math.max(0, targetCents - actualCents), share: original > 0 ? available(new Decimal(actualCents).div(original).toNumber()) : { status: 'unsupported-case' as const, issues: [issue('allocation-no-surplus', 'There is no positive annual cash flow to allocate.')] }, reasons: uniqueReasons.filter(reason => [...adapter.sourceMap.values()].some(source => source.destination.kind === 'account' && source.destination.accountId === accountId && reason.field?.startsWith(`${source.fieldPrefix}.`))) };
    });
    // Known target shortfalls still reconcile to the annual pool; only saved
    // deposits exceeding that pool constitute an allocation funding conflict.
    const conflict = sum(afterExisting) < 0;
    return available({ requests: acceptedRequests, report: { year: input.cash.year, status: original <= 0 ? 'no-surplus' : conflict ? 'funding-conflict' : 'funded', originalCashFlowCents: original,...(timing.allocationBudgetByMonth?{aduBudget:{reportedCashFlowCents:sum(timing.preTransferCashByMonth),financedConstructionCents:sum(input.financedConstructionByMonth!),allocationCashFlowCents:original}}:{}), accounts, explicitCashTargetCents: explicitCashTarget, explicitCashCents: explicitCash, explicitCashShortfallCents: Math.max(0, explicitCashTarget - explicitCash), excessOfferedCents: excessOffered, excessAcceptedCents: excessAccepted, excessRetainedCents: excessOffered - excessAccepted, retainedCashCents: sum([original, -sum(accounts.map(account => account.actualCents))]), reasons: uniqueReasons } });
  }
  let household = evaluate(input.legacyRequests, resolveHousehold);
  let lastSignature: string | undefined;
  const seen = new Set<string>();
  for (let pass = 0; pass < 128; pass++) {
    const unavailable = readiness(household);
    if (unavailable) return unavailable;
    const allocation = allocate(household);
    if (allocation.status !== 'available') return allocation;
    const next = evaluate(allocation.value.requests, resolveHousehold);
    const nextMissing = readiness(next);
    if (nextMissing) return nextMissing;
    const timing = cashTiming(input, next);
    const signature = JSON.stringify([allocation.value.report, allocation.value.requests, next.contributions, timing, next.tax, next.closingTaxState]);
    if (signature === lastSignature) {
      // One additional complete solve verifies both deterministic legal funding
      // and tax/state outputs before returning the sole accepted closing state.
      const verification = allocate(next);
      if (verification.status !== 'available') return verification;
      const verified = evaluate(verification.value.requests, resolveHousehold);
      const invalid = readiness(verified); if (invalid) return invalid;
      const verifiedTiming = cashTiming(input, verified);
      const verifiedSignature = JSON.stringify([verification.value.report, verification.value.requests, verified.contributions, verifiedTiming, verified.tax, verified.closingTaxState]);
      if (verifiedSignature !== signature) return nonconvergence();
      const depositsMatch = verified.contributions.filter(record => adapter.sourceMap.has(record.ruleId)).every(record => record.eligibleCents.status === 'available' && record.eligibleCents.value === record.requestedCents);
      const reportMatches = verification.value.report.originalCashFlowCents === sum(verifiedTiming.allocationBudgetByMonth??verifiedTiming.preTransferCashByMonth)
        && verification.value.report.accounts.every(account => account.actualCents === sum(verified.contributions.filter(record => (record.conversionRothAccountId ?? record.accountId) === account.accountId).map(record => record.eligibleCents.status === 'available' ? record.eligibleCents.value : 0)));
      const legacyPreserved = existingBaseline.contributions.every(record => verified.contributions.some(final => final.ruleId === record.ruleId && final.month === record.month && final.eligibleCents.status === 'available' && record.eligibleCents.status === 'available' && final.eligibleCents.value >= record.eligibleCents.value));
      if (!depositsMatch || !reportMatches || !legacyPreserved) return nonconvergence();
      return available({ household: verified, requests: verification.value.requests, report: verification.value.report, ...verifiedTiming });
    }
    if (seen.has(signature)) return nonconvergence();
    seen.add(signature); lastSignature = signature; household = next;
  }
  return nonconvergence();
}
