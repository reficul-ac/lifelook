import type { Cents, ValidatedPlan } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { HouseholdTaxState } from '../model/tax-state';
import type { ContributionRecord } from '../tax/facts';
import type { AllocationSource } from './allocation-adapter';

export function backdoorRothProvenance(year: number): RuleProvenance {
  return { status: 'projected', ruleVersion: 'clean-backdoor-roth.1', baselineYear: 2026, applicableYear: year,
    sources: ['https://www.irs.gov/publications/p590a', 'https://www.irs.gov/instructions/i8606', 'https://www.ftb.ca.gov/forms/2025/2025-1005-publication.pdf'],
    assumptions: ['Only confirmed clean IRA history with zero opening traditional IRA balances and basis is supported; other IRA balances, rollovers and federal/California basis differences are excluded.',
      'Accepted contributions elect nondeductible federal and California treatment and immediately convert to the same owner’s Roth IRA without intervening earnings.',
      'Contributions use the existing annual IRA and compensation limits once; the conversion consumes the new basis and transfers assets without an additional cash debit.'] };
}

/** This route deliberately excludes taxable and pro-rata conversions. Unrecorded IRAs
 * and federal/California basis differences require the owner's explicit attestation. */
export function backdoorRothReadiness(plan: ValidatedPlan, source: AllocationSource, year: number,
  opening: HouseholdTaxState, legacy: readonly ContributionRecord[],
  balances?: ReadonlyMap<string, Available<Cents>>): Available<true> {
  if (source.destination.kind !== 'account' || !source.destination.backdoorRoth) return { status: 'available', value: true };
  const route = source.destination.backdoorRoth;
  const ownerId = plan.accounts.find(account => account.id === route.traditionalIraAccountId)!.ownerId;
  const problem = (status: 'needs-data' | 'unsupported-case', code: string, explanation: string,
    recordId = source.sourceId, field = 'destination.backdoorRoth.cleanIraHistory'): Available<true> => {
    const issue: Issue = { code, recordId, year, field, severity: 'warning', explanation,
      resolution: 'Confirm clean IRA history and known-zero balances and basis. Taxable or pro-rata conversions require a separately supported calculation.' };
    return { status, issues: [issue] };
  };
  if (!route.cleanIraHistory.known) return problem('needs-data', 'required-clean-ira-history', 'The absence of other traditional, SEP or SIMPLE IRA balances, rollovers, prior basis and federal/California basis differences is unconfirmed.');
  if (!route.cleanIraHistory.value) return problem('unsupported-case', 'unsupported-backdoor-ira-history', 'This route supports only a confirmed clean, same-year nondeductible contribution and conversion.');
  const basis = opening.iraBasisByOwner[ownerId];
  const ownerAccounts = plan.accounts.filter(account => account.ownerId === ownerId && account.type === 'traditional-ira');
  const basisAccountId = ownerAccounts.find(account => !account.openingIraBasis.known || account.openingIraBasis.value !== 0)?.id ?? route.traditionalIraAccountId;
  if (!basis?.known) return problem('needs-data', 'required-backdoor-ira-basis', 'Opening owner IRA basis is unknown.', basisAccountId, 'openingIraBasis');
  if (basis.value !== 0) return problem('unsupported-case', 'unsupported-backdoor-ira-basis', 'Existing IRA basis requires a conversion calculation beyond this clean route.', basisAccountId, 'openingIraBasis');
  for (const account of plan.accounts.filter(account => account.ownerId === ownerId && account.type === 'traditional-ira')) {
    const balance = balances?.get(account.id) ?? (year === plan.startYear ? { status: 'available' as const, value: account.openingBalanceCents } : undefined);
    if (!balance || balance.status !== 'available') return problem('needs-data', 'required-backdoor-ira-balance', 'The current opening traditional IRA balance is unavailable.', account.id, 'openingBalanceCents');
    if (balance.value !== 0) return problem('unsupported-case', 'unsupported-backdoor-ira-balance', 'An existing traditional IRA balance requires a pro-rata conversion calculation.', account.id, 'openingBalanceCents');
  }
  if (legacy.some(record => record.ownerId === ownerId && plan.accounts.find(account => account.id === record.accountId)?.type === 'traditional-ira'
    && (record.eligibleCents.status !== 'available' || record.eligibleCents.value > 0))) {
    return problem('unsupported-case', 'unsupported-backdoor-other-ira-funding', 'Other funded traditional IRA contributions in this year require a broader basis and conversion calculation.');
  }
  return { status: 'available', value: true };
}
