import { describe, expect, it } from 'vitest';
import reference from '../../../fixtures/tax/qualified-principal-carry.json';
import references from '../../../fixtures/tax/rental-losses-2026.json';
import type { TaxBook } from '../../../src/engine/model/plan';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import type { YearRules } from '../../../src/engine/rules/types';
import type { PreIraFacts } from '../../../src/engine/tax/facts';
import { resolveRentalLosses } from '../../../src/engine/tax/rental-losses';

const fields = { federal: 'federal', california: 'california', 'federal-amt': 'federalAmt', 'california-amt': 'californiaAmt' } as const;
const books = Object.keys(fields) as TaxBook[];
function scenario() {
  const source = structuredClone(references[0]!.input) as unknown as { facts: PreIraFacts; opening: HouseholdTaxState; rules: YearRules };
  const opening: HouseholdTaxState = { ...source.opening, rentals: { 'rental-a': Object.fromEntries(books.map(book => {
    const current = source.opening.rentals['rental-a']![book];
    if (current.status !== 'available') throw new Error('Unknown synthetic history');
    return [book, { status: 'available', value: { ...current.value, atRiskCents: reference.openingAtRiskCents, atRiskSuspendedCents: 0, passiveSuspendedCents: 0, lossVintages: [] } }];
  })) as unknown as HouseholdTaxState['rentals'][string] } };
  const factsFor = (year: typeof reference.years[number]): PreIraFacts => ({ ...source.facts, year: year.year, rentalFacts: source.facts.rentalFacts.map(r => ({ ...r, rentCents: year.rentCents, operatingExpenseCents: year.operatingExpenseCents, principalPaidCents: year.principalPaidCents, debtPaymentCents: year.principalPaidCents, cashInterestCents: 0, cashFlowCents: year.cashFlowCents, financingAtRiskQualification: { known: true, value: true }, books: Object.fromEntries(books.map(book => {
    const current = r.books[book]; if (current.status !== 'available') throw new Error('Unknown current book');
    return [book, { status: 'available', value: { ...current.value, rentCents: year.rentCents, operatingExpenseCents: year.operatingExpenseCents, eligibleInterestCents: 0, depreciationCents: year.books[book].depreciationCents, taxableProfitCents: year.books[book].taxableProfitCents } }];
  })) as typeof r.books })) });
  return { opening, rules: source.rules, factsFor };
}
describe('review: qualifying principal and carried at-risk books', () => {
  it.each(books)('matches the independent two-year %s worksheet and subsequent loss release', book => {
    const { opening, rules, factsFor } = scenario(); let carried = opening;
    for (const year of reference.years) {
      const result = resolveRentalLosses(factsFor(year), carried, rules), resolved = result[fields[book]];
      expect(resolved.status).toBe('available'); if (resolved.status !== 'available') throw new Error('Missing book');
      const expected = year.books[book], row = resolved.value.rentals[0]!;
      expect(row.allowedRentalCents).toBe(expected.allowedRentalCents);
      expect(row.closingState.atRiskCents).toBe(expected.closingAtRiskCents);
      expect(row.closingState.atRiskSuspendedCents).toBe(expected.atRiskSuspendedCents);
      expect(row.atRisk.closingAmountAtRiskCents).toBe(expected.closingAtRiskCents);
      carried = result.closing;
    }
  });
  it('does not invent outside-owner funding for repayments when rental cash is insufficient', () => {
    const { opening, rules, factsFor } = scenario(), facts = factsFor(reference.years[0]!);
    const result = resolveRentalLosses({ ...facts, rentalFacts: facts.rentalFacts.map(r => ({ ...r, cashFlowCents: -1 })) }, opening, rules);
    for (const field of Object.values(fields)) {
      expect(result[field].status).toBe('needs-data'); expect(result[field]).not.toHaveProperty('value');
      expect(result.closing.rentals['rental-a']![field === 'federalAmt' ? 'federal-amt' : field === 'californiaAmt' ? 'california-amt' : field].status).toBe('needs-data');
    }
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'required-at-risk-repayment-funding' }));
  });
  it('requires financing qualification for a principal reduction even in a profit year', () => {
    const { opening, rules, factsFor } = scenario(), facts = factsFor(reference.years[0]!);
    const result = resolveRentalLosses({ ...facts, rentalFacts: facts.rentalFacts.map(r => ({ ...r, financingAtRiskQualification: { known: false } })) }, opening, rules);
    expect(result.federal.status).toBe('needs-data'); expect(result.federal).not.toHaveProperty('value');
  });
  it('blocks an unmodeled recapture when repayment makes the year-end capacity negative', () => {
    const { opening, rules, factsFor } = scenario(), facts = factsFor(reference.years[0]!);
    const result = resolveRentalLosses({ ...facts, rentalFacts: facts.rentalFacts.map(r => ({ ...r, principalPaidCents: 1300000, cashFlowCents: 300000 })) }, opening, rules);
    expect(result.federal.status).toBe('unsupported-case'); expect(result.federal).not.toHaveProperty('value');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unsupported-at-risk-recapture' }));
  });
  it('keeps exactly zero year-end capacity available without inventing recapture', () => {
    const { opening, rules, factsFor } = scenario(), facts = factsFor(reference.years[0]!);
    const result = resolveRentalLosses({ ...facts, rentalFacts: facts.rentalFacts.map(r => ({ ...r, principalPaidCents: 1200000, cashFlowCents: 400000 })) }, opening, rules);
    expect(result.federal.status).toBe('available');
    if (result.federal.status === 'available') expect(result.federal.value.rentals[0]!.closingState.atRiskCents).toBe(0);
  });
  it('does not infer qualifying new borrowing from negative principal amortization', () => {
    const { opening, rules, factsFor } = scenario(), facts = factsFor(reference.years[0]!);
    const result = resolveRentalLosses({ ...facts, rentalFacts: facts.rentalFacts.map(r => ({ ...r, principalPaidCents: -1 })) }, opening, rules);
    expect(result.federal.status).toBe('unsupported-case'); expect(result.federal).not.toHaveProperty('value');
  });
});
