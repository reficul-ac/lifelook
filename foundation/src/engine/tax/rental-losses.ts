import type { Cents, History, RentalBookState, RentalLossVintage, TaxBook } from '../model/plan';
import type { HouseholdTaxState } from '../model/tax-state';
import type { Available, Issue } from '../model/results';
import { Decimal, settleCents, settleSeries } from '../money';
import type { RentalTaxBookFacts, RentalYearFacts } from '../property/facts';
import type { YearRules } from '../rules/types';
import type { PreIraFacts } from './facts';
import { passiveAllowanceMagi, sumCents } from './modified-income';

export interface LossBalanceMovement { readonly openingCents: Cents; readonly currentAdditionCents: Cents; readonly releaseCents: Cents; readonly closingCents: Cents }
export interface AtRiskMovement extends LossBalanceMovement { readonly openingAmountAtRiskCents: Cents; readonly closingAmountAtRiskCents: Cents }
export interface RentalLossRecord {
  readonly rentalId: string;
  readonly taxableProfitCents: Cents;
  readonly allowedRentalCents: Cents;
  readonly atRisk: AtRiskMovement;
  readonly passive: LossBalanceMovement;
  readonly releasedLossVintages: readonly RentalLossVintage[];
  readonly closingState: RentalBookState;
}
export interface RentalJurisdictionYear {
  readonly book: TaxBook;
  readonly passiveAllowanceMagiCents: Cents;
  readonly specialAllowanceCents: Cents;
  readonly allowedRentalCents: Cents;
  readonly closingAtRiskLossCents: Cents;
  readonly closingPassiveLossCents: Cents;
  readonly rentals: readonly RentalLossRecord[];
}
export interface RentalLossYear {
  readonly year: number;
  readonly federal: Available<RentalJurisdictionYear>;
  readonly california: Available<RentalJurisdictionYear>;
  readonly federalAmt: Available<RentalJurisdictionYear>;
  readonly californiaAmt: Available<RentalJurisdictionYear>;
  readonly closing: HouseholdTaxState;
  readonly issues: readonly Issue[];
  readonly assumptions: readonly string[];
}
const bookFields = { federal: 'federal', california: 'california', 'federal-amt': 'federalAmt', 'california-amt': 'californiaAmt' } as const;
const books = Object.keys(bookFields) as TaxBook[];
interface Pool {
  readonly rental: RentalYearFacts;
  readonly facts: RentalTaxBookFacts;
  readonly opening: RentalBookState;
  readonly arPool: readonly RentalLossVintage[];
  readonly arReleased: Cents;
  readonly arClosing: Cents;
  readonly closingRisk: Cents;
  pool: readonly RentalLossVintage[];
  released: readonly RentalLossVintage[];
}
const order = (a: RentalLossVintage, b: RentalLossVintage): number => a.year - b.year || a.source.localeCompare(b.source);
function consume(pool: readonly RentalLossVintage[], amount: Cents, eligible: (v: RentalLossVintage) => boolean = () => true): { remaining: readonly RentalLossVintage[]; released: readonly RentalLossVintage[] } {
  let left = amount;
  const remaining: RentalLossVintage[] = [], released: RentalLossVintage[] = [];
  for (const vintage of [...pool].sort(order)) {
    const taken = eligible(vintage) ? Math.min(left, vintage.amountCents) : 0;
    left -= taken;
    if (taken) released.push({ ...vintage, amountCents: taken });
    if (vintage.amountCents > taken) remaining.push({ ...vintage, amountCents: vintage.amountCents - taken });
  }
  return { remaining, released };
}
function mergeVintages(vintages: readonly RentalLossVintage[]): readonly RentalLossVintage[] {
  const result = new Map<string, RentalLossVintage>();
  for (const vintage of [...vintages].sort(order)) {
    const key = JSON.stringify([vintage.year, vintage.source, vintage.activeParticipation, vintage.qbiQualification]);
    const previous = result.get(key);
    result.set(key, previous ? { ...vintage, amountCents: sumCents([previous.amountCents, vintage.amountCents]) } : vintage);
  }
  return [...result.values()];
}
function issue(rentalId: string, year: number, book: TaxBook, code: string, explanation: string): Issue {
  return { code, recordId: rentalId, year, field: `taxHistory.${book}`, severity: 'warning', explanation, resolution: 'Supply the qualified financing, participation-at-origin and carried loss history before claiming dependent tax totals.' };
}
function resolveBook(facts: PreIraFacts, opening: HouseholdTaxState, rules: YearRules, book: TaxBook): Available<RentalJurisdictionYear> {
  const magi = passiveAllowanceMagi(facts, rules);
  if (magi.status !== 'available') return magi;
  const jurisdiction = book.startsWith('california') ? 'california' : 'federal';
  const allowance = rules[jurisdiction].passive;
  const cap = settleCents(Decimal.max(0, new Decimal(allowance.allowanceCents).minus(Decimal.max(0, new Decimal(magi.value).minus(allowance.phaseoutStartCents)).mul(allowance.reductionBps).div(10000))));
  const missing: Issue[] = [], unsupported: Issue[] = [], pools: Pool[] = [];
  for (const rental of [...facts.rentalFacts].sort((a, b) => a.rentalId.localeCompare(b.rentalId))) {
    const carried = opening.rentals[rental.rentalId]?.[book];
    const current = rental.books[book];
    if (!carried) { missing.push(issue(rental.rentalId, facts.year, book, 'required-history', 'The opening rental book is unknown.')); continue; }
    if (carried.status !== 'available') { (carried.status === 'unsupported-case' ? unsupported : missing).push(...carried.issues); continue; }
    if (current.status !== 'available') { (current.status === 'unsupported-case' ? unsupported : missing).push(...current.issues); continue; }
    const state = carried.value;
    const loss = Math.max(0, -current.value.taxableProfitCents);
    if (state.atRiskCents < 0) { unsupported.push(issue(rental.rentalId, facts.year, book, 'unsupported-at-risk-recapture', 'A negative opening amount at risk requires historical loss-recapture facts.')); continue; }
    if (loss || state.atRiskSuspendedCents) {
      const financing: History<boolean> = rental.financingAtRiskQualification;
      if (!financing?.known) { missing.push(issue(rental.rentalId, facts.year, book, 'required-at-risk-financing', 'At-risk loss capacity requires a qualified financing answer.')); continue; }
      if (!financing.value) { unsupported.push(issue(rental.rentalId, facts.year, book, 'unsupported-at-risk-financing', 'The financing is outside supported personal-liability or qualified-nonrecourse financing.')); continue; }
    }
    const originalAr = state.lossVintages.filter(v => v.source === 'at-risk');
    const currentVintage: RentalLossVintage[] = loss ? [{ year: facts.year, source: 'at-risk', amountCents: loss, activeParticipation: rental.unit.activeParticipation, qbiQualification: rental.unit.qbi.qualification }] : [];
    const arTotal = sumCents([state.atRiskSuspendedCents, loss]);
    const capacity = sumCents([state.atRiskCents, Math.max(0, current.value.taxableProfitCents)]);
    const arReleased = Math.min(arTotal, Math.max(0, capacity));
    const ar = consume([...originalAr, ...currentVintage], arReleased);
    const passive = [...state.lossVintages.filter(v => v.source === 'passive'), ...ar.released.map(v => ({ ...v, source: 'passive' as const }))];
    pools.push({ rental, facts: current.value, opening: state, arPool: ar.remaining, arReleased, arClosing: arTotal - arReleased, closingRisk: capacity - arReleased, pool: passive, released: [] });
  }
  if (missing.length || unsupported.length) return { status: unsupported.length ? 'unsupported-case' : 'needs-data', issues: [...missing, ...unsupported] };
  // Form8582 PartII/VI applies the active special allowance before PartVII
  // allocates the remaining losses against passive income. Active profits
  // reduce the active loss pool independently of other passive activities.
  if (cap > 0) pools.forEach(p => {
    if (!p.rental.unit.activeParticipation.known && (p.pool.length || p.facts.taxableProfitCents > 0)) missing.push(issue(p.rental.rentalId, facts.year, book, 'required-active-participation', 'Current participation is unknown, so the shared active rental allowance cannot be resolved.'));
    if (p.rental.unit.activeParticipation.known && p.rental.unit.activeParticipation.value && p.pool.some(v => !v.activeParticipation?.known)) missing.push(issue(p.rental.rentalId, facts.year, book, 'required-loss-origin', 'A carried loss lacks its participation-at-origin answer, so its special-allowance eligibility is unknown.'));
  });
  if (missing.length) return { status: 'needs-data', issues: missing };
  const active = (p: Pool, v: RentalLossVintage): boolean => Boolean(p.rental.unit.activeParticipation.known && p.rental.unit.activeParticipation.value && v.activeParticipation?.known && v.activeParticipation.value);
  const eligible = pools.map(p => sumCents(p.pool.filter(v => active(p, v)).map(v => v.amountCents)));
  const activeIncome = pools.map(p => p.rental.unit.activeParticipation.known && p.rental.unit.activeParticipation.value ? Math.max(0, p.facts.taxableProfitCents) : 0);
  const netEligible = Math.max(0, sumCents(eligible) - sumCents(activeIncome));
  const lossWeights = eligible.map((loss, i) => Math.max(0, loss - activeIncome[i]!));
  const totalWeights = sumCents(lossWeights);
  const special = Math.min(cap, netEligible);
  const specialShares = settleSeries(lossWeights.map(loss => totalWeights ? new Decimal(special).mul(loss).div(totalWeights) : new Decimal(0)));
  pools.forEach((p, index) => { const consumed = consume(p.pool, specialShares[index]!, v => active(p, v)); p.pool = consumed.remaining; p.released = [...p.released, ...consumed.released]; });
  pools.forEach(p => {
    const ownRelease = Math.min(Math.max(0, p.facts.taxableProfitCents), sumCents(p.pool.map(v => v.amountCents)));
    const own = consume(p.pool, ownRelease); p.pool = own.remaining; p.released = [...p.released, ...own.released];
  });
  const passiveIncome = sumCents(pools.map(p => Math.max(0, p.facts.taxableProfitCents - sumCents(p.released.map(v => v.amountCents)))));
  const passiveLosses = pools.map(p => sumCents(p.pool.map(v => v.amountCents)));
  const totalLoss = sumCents(passiveLosses);
  const againstIncome = Math.min(passiveIncome, totalLoss);
  const incomeShares = settleSeries(passiveLosses.map(loss => totalLoss ? new Decimal(againstIncome).mul(loss).div(totalLoss) : new Decimal(0)));
  pools.forEach((p, index) => { const consumed = consume(p.pool, incomeShares[index]!); p.pool = consumed.remaining; p.released = [...p.released, ...consumed.released]; });
  const rentals = pools.map(p => {
    const released = sumCents(p.released.map(v => v.amountCents));
    const passiveClosed = sumCents(p.pool.map(v => v.amountCents));
    const closingState: RentalBookState = { ...p.facts.closingState, atRiskCents: p.closingRisk, atRiskSuspendedCents: p.arClosing, passiveSuspendedCents: passiveClosed, lossVintages: mergeVintages([...p.arPool, ...p.pool]) };
    return { rentalId: p.rental.rentalId, taxableProfitCents: p.facts.taxableProfitCents, allowedRentalCents: sumCents([Math.max(0, p.facts.taxableProfitCents), -released]), atRisk: { openingCents: p.opening.atRiskSuspendedCents, currentAdditionCents: Math.max(0, -p.facts.taxableProfitCents), releaseCents: p.arReleased, closingCents: p.arClosing, openingAmountAtRiskCents: p.opening.atRiskCents, closingAmountAtRiskCents: p.closingRisk }, passive: { openingCents: p.opening.passiveSuspendedCents, currentAdditionCents: p.arReleased, releaseCents: released, closingCents: passiveClosed }, releasedLossVintages: mergeVintages(p.released), closingState };
  });
  return { status: 'available', value: { book, passiveAllowanceMagiCents: magi.value, specialAllowanceCents: cap, allowedRentalCents: sumCents(rentals.map(r => r.allowedRentalCents)), closingAtRiskLossCents: sumCents(rentals.map(r => r.atRisk.closingCents)), closingPassiveLossCents: sumCents(rentals.map(r => r.passive.closingCents)), rentals } };
}
export function resolveRentalLosses(facts: PreIraFacts, opening: HouseholdTaxState, rules: YearRules): RentalLossYear {
  const resolved = Object.fromEntries(books.map(book => [book, resolveBook(facts, opening, rules, book)])) as Record<TaxBook, Available<RentalJurisdictionYear>>;
  const rentals: Record<string, Readonly<Record<TaxBook, Available<RentalBookState>>>> = Object.fromEntries(facts.rentalFacts.map(rental => [rental.rentalId, Object.fromEntries(books.map(book => {
    const result = resolved[book];
    const carried: Available<RentalBookState> = result.status === 'available' ? { status: 'available', value: result.value.rentals.find(r => r.rentalId === rental.rentalId)!.closingState } : result;
    return [book, carried];
  })) as Record<TaxBook, Available<RentalBookState>>]));
  const issues = [...new Map(Object.values(resolved).flatMap(r => r.status === 'available' ? [] : r.issues).map(i => [JSON.stringify(i), i])).values()];
  return { year: facts.year, federal: resolved.federal, california: resolved.california, federalAmt: resolved['federal-amt'], californiaAmt: resolved['california-amt'], closing: { ...opening, year: facts.year, rentals }, issues, assumptions: ['No activity-level owner capital injections or distributions are modeled; cash gaps do not create at-risk funding.'] };
}
