import type { ContributionRequest } from '../cash/contribution-requests';
import type { CashYear } from '../cash/income';
import type { Cents, Filer, ValidatedPlan } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import { Decimal, settleCents } from '../money';
import type { YearRules } from '../rules/types';
import type { ContributionRecord } from './facts';

export interface OwnerCompensation { readonly ownerId: string; readonly annualCents: Cents; readonly monthlyCents: readonly Cents[] }
export interface EmployerCompensation extends OwnerCompensation { readonly employerId: string }
export interface WorkplaceYear {
  readonly year: number;
  readonly filers: readonly Filer[];
  readonly records: readonly ContributionRecord[];
  readonly remainingRequests: readonly ContributionRequest[];
  readonly compensationByOwner: readonly OwnerCompensation[];
  readonly compensationByEmployer: readonly EmployerCompensation[];
  readonly federalIncomeTaxWageReductionCents: Available<Cents>;
  readonly californiaIncomeTaxWageReductionCents: Available<Cents>;
  readonly issues: readonly Issue[];
  readonly provenance: readonly RuleProvenance[];
}
const sum = (values: readonly Cents[]): Cents => settleCents(values.reduce((a, b) => a.plus(b), new Decimal(0)));
const available = (value: Cents): Available<Cents> => ({ status: 'available', value });
const workplaceRulePaths = ['electiveDeferralLimitCents', 'regularCatchupCents', 'enhancedCatchupCents', 'catchupMinimumAge', 'enhancedCatchupMinimumAge', 'enhancedCatchupMaximumAge', 'rothCatchupPriorYearWageThresholdCents', 'mandatoryRothCatchup'].map(p => `retirement.${p}`);

export function usedRuleProvenance(rules: YearRules, paths: readonly string[]): readonly RuleProvenance[] {
  const distinct = new Map<string, RuleProvenance>();
  for (const path of paths) { const p = rules.provenance[path]; if (p) distinct.set(JSON.stringify(p), p); }
  return [...distinct.values()];
}

/** Owner-wide limits are spent in visible chronological/priority order. */
export function resolveWorkplaceContributions(plan: ValidatedPlan, cash: CashYear, requests: readonly ContributionRequest[], rules: YearRules): WorkplaceYear {
  const sorted = [...requests].sort((a, b) => a.month - b.month || a.priority - b.priority || a.ruleId.localeCompare(b.ruleId));
  const compensationByOwner = [...plan.household.filers].sort((a, b) => a.id.localeCompare(b.id)).map(filer => ({ ownerId: filer.id, annualCents: sum(cash.wages.filter(w => w.ownerId === filer.id).map(w => w.annualCents)), monthlyCents: Array.from({ length: 12 }, (_, i) => sum(cash.wages.filter(w => w.ownerId === filer.id).map(w => w.monthlyCents[i] ?? 0))) }));
  const compensationByEmployer: EmployerCompensation[] = [...cash.wages].sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.employerId.localeCompare(b.employerId)).map(w => ({ ownerId: w.ownerId, employerId: w.employerId, annualCents: w.annualCents, monthlyCents: [...w.monthlyCents] }));
  const records: ContributionRecord[] = [], remainingRequests: ContributionRequest[] = [], issues: Issue[] = [];
  const ownerUsed = new Map<string, { regular: Cents; catchup: Cents; unknown: readonly Issue[] }>();
  const monthlyEmployerUsed = new Map<string, Cents>();
  for (const request of sorted) {
    const account = plan.accounts.find(a => a.id === request.accountId);
    if (account && account.type !== 'traditional-401k' && account.type !== 'roth-401k') { remainingRequests.push(request); continue; }
    const reasons: Issue[] = [];
    const issue = (code: string, field: string, explanation: string, resolution: string): Issue => ({ code, recordId: request.ruleId, year: cash.year, field, severity: 'warning', explanation, resolution });
    const sponsor = plan.salaries.find(s => s.id === request.sponsoringSalaryId);
    const rule = plan.contributions.find(r => r.id === request.ruleId);
    const filer = plan.household.filers.find(f => f.id === request.ownerId);
    const valid = account && filer && sponsor && rule && rule.accountId === account.id && rule.sponsoringSalaryId === sponsor.id && account.ownerId === request.ownerId && sponsor.ownerId === request.ownerId && request.employerId === sponsor.employerId && request.year === cash.year && Number.isInteger(request.month) && request.month >= 1 && request.month <= 12 && Number.isSafeInteger(request.requestedCents) && request.requestedCents >= 0;
    let eligibility: Available<Cents>;
    if (!valid) {
      reasons.push(issue('unsupported-contribution-link', 'sponsoringSalaryId', 'The request has conflicting owner, rule, account, year or sponsoring-employer facts.', 'Use the validated sponsoring salary and regenerate contribution requests.'));
      eligibility = { status: 'unsupported-case', issues: reasons };
    } else if (request.requestedCents === 0) eligibility = available(0);
    else {
      const used = ownerUsed.get(filer.id) ?? { regular: 0, catchup: 0, unknown: [] };
      if (used.unknown.length) {
        reasons.push(issue('required-owner-limit', 'amount', 'An earlier contribution has unresolved eligibility under this owner’s shared annual limit.', 'Resolve the earlier contribution history before funding later overlapping rules.'));
        eligibility = { status: 'needs-data', issues: reasons };
      } else {
        const employer = compensationByEmployer.find(e => e.ownerId === filer.id && e.employerId === sponsor.employerId);
        const key = JSON.stringify([filer.id, sponsor.employerId, request.month]);
        const already = monthlyEmployerUsed.get(key) ?? 0;
        const compensation = Math.max(0, (employer?.monthlyCents[request.month - 1] ?? 0) - already);
        const desired = Math.min(request.requestedCents, compensation);
        const base = Math.min(desired, Math.max(0, rules.retirement.electiveDeferralLimitCents - used.regular));
        let catchup = 0;
        let missing: Issue | undefined;
        if (desired > base) {
          if (!filer.birthDate.known) missing = issue('required-age', 'birthDate', 'Catch-up eligibility requires the filer’s age at calendar year end.', 'Supply the filer’s birth date before using catch-up funding.');
          else {
            const age = cash.year - Number(filer.birthDate.value.slice(0, 4));
            if (age >= rules.retirement.catchupMinimumAge) {
              const facts = filer.employerAssumptionsByYear.find(f => f.year === cash.year && f.employerId === sponsor.employerId);
              if (!facts || !facts.planCatchUpAvailable.known) missing = issue('required-employer-history', 'employerAssumptionsByYear', 'Catch-up eligibility requires sponsoring-employer history and plan availability.', 'Supply prior-year employer wages and catch-up availability for this year.');
              else if (!facts.planCatchUpAvailable.value) reasons.push(issue('catchup-not-offered', 'employerAssumptionsByYear.planCatchUpAvailable', 'The sponsoring employer plan does not offer catch-up contributions.', 'Keep funding within the regular owner limit or use an eligible plan.'));
              else if (rules.retirement.mandatoryRothCatchup && !facts.priorYearWagesCents.known) missing = issue('required-employer-history', 'employerAssumptionsByYear.priorYearWagesCents', 'Catch-up eligibility requires prior-year wages with this sponsoring employer.', 'Supply this employer’s prior-year wages, including an explicitly confirmed zero.');
              else {
                const mandatoryRoth = rules.retirement.mandatoryRothCatchup && facts.priorYearWagesCents.known && facts.priorYearWagesCents.value > rules.retirement.rothCatchupPriorYearWageThresholdCents;
                if (mandatoryRoth && account.type === 'traditional-401k') reasons.push(issue('mandatory-roth-catchup', 'accountId', 'Prior-year wages with this sponsoring employer require catch-up contributions on a Roth basis.', 'Add an eligible Roth 401(k) rule for this employer; no Roth destination is created automatically.'));
                else if (account.type === 'roth-401k' && !facts.rothCatchUpAvailable.known) missing = issue('required-employer-history', 'employerAssumptionsByYear.rothCatchUpAvailable', 'Roth catch-up funding requires explicit plan availability.', 'Confirm whether this sponsoring plan permits Roth catch-up contributions.');
                else if (account.type === 'roth-401k' && facts.rothCatchUpAvailable.known && !facts.rothCatchUpAvailable.value) reasons.push(issue('roth-catchup-not-offered', 'employerAssumptionsByYear.rothCatchUpAvailable', 'The sponsoring plan does not offer Roth catch-up contributions.', 'Keep funding within the regular limit or use an eligible plan.'));
                else {
                  const limit = age >= rules.retirement.enhancedCatchupMinimumAge && age <= rules.retirement.enhancedCatchupMaximumAge ? rules.retirement.enhancedCatchupCents : rules.retirement.regularCatchupCents;
                  catchup = Math.min(desired - base, Math.max(0, limit - used.catchup));
                }
              }
            }
          }
        }
        if (missing) {
          reasons.push(missing);
          eligibility = { status: 'needs-data', issues: reasons };
          ownerUsed.set(filer.id, { ...used, unknown: reasons });
        } else {
          const funded = sum([base, catchup]);
          eligibility = available(funded);
          ownerUsed.set(filer.id, { regular: sum([used.regular, base]), catchup: sum([used.catchup, catchup]), unknown: [] });
          monthlyEmployerUsed.set(key, sum([already, funded]));
          if (funded < request.requestedCents) reasons.push(issue('contribution-capped', 'amount', 'The request exceeds the owner, plan, or compensation limit.', 'Reduce this rule or adjust its priority; prevented cents remain in cash.'));
        }
      }
    }
    const traditional = account?.type === 'traditional-401k';
    const deductibleCents = eligibility.status === 'available' ? available(traditional ? eligibility.value : 0) : eligibility;
    const nondeductibleCents = eligibility.status === 'available' ? available(traditional ? 0 : eligibility.value) : eligibility;
    const preventedCents = eligibility.status === 'available' ? available(request.requestedCents - eligibility.value) : eligibility;
    records.push({ ruleId: request.ruleId, accountId: request.accountId, ownerId: request.ownerId, year: request.year, month: request.month, requestedCents: request.requestedCents, eligibleCents: eligibility, deductibleCents, nondeductibleCents, preventedCents, reasons });
    issues.push(...reasons);
  }
  const traditional = records.filter(r => plan.accounts.find(a => a.id === r.accountId)?.type === 'traditional-401k');
  const unavailable = traditional.find(r => r.deductibleCents.status !== 'available')?.deductibleCents;
  const reduction: Available<Cents> = unavailable && unavailable.status !== 'available' ? { status: unavailable.status, issues: traditional.flatMap(r => r.deductibleCents.status === 'available' ? [] : r.deductibleCents.issues) } : available(sum(traditional.map(r => r.deductibleCents.status === 'available' ? r.deductibleCents.value : 0)));
  return { year: cash.year, filers: plan.household.filers, records, remainingRequests, compensationByOwner, compensationByEmployer, federalIncomeTaxWageReductionCents: reduction, californiaIncomeTaxWageReductionCents: reduction, issues, provenance: usedRuleProvenance(rules, workplaceRulePaths) };
}
