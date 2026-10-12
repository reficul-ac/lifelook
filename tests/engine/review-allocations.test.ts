import { describe, expect, it } from 'vitest';
import references from '../../fixtures/math/projection.json';
import { validatePlan, type PlanDocument } from '../../src/engine';

function plan(): PlanDocument { return structuredClone(references.find(c => c.id === 'two-salaries-home-adu')!.input) as unknown as PlanDocument; }
describe('review: effective allocation validation', () => {
  it('rejects effective shared shares whose individually valid fractions exceed the whole', () => {
    const source = plan(), unit = source.rentals[0]!;
    const candidate = { ...source, rentals: [{ ...unit, sharedAllocation: { numerator: 3, denominator: 4 } }, { ...unit, id: 'adu-two', sharedAllocation: { numerator: 3, denominator: 4 } }] };
    const result = validatePlan(candidate); expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ recordId: 'home', field: 'rentals.sharedAllocation' }));
  });
  it('rejects aggregate explicit loan shares above one', () => {
    const source = plan(), unit = source.rentals[0]!;
    const allocation = [{ loanId: 'home-loan', share: { numerator: 3, denominator: 4 }, qualification: { known: true as const, value: true } }];
    const candidate = { ...source, rentals: [{ ...unit, loanAllocations: allocation }, { ...unit, id: 'adu-two', loanAllocations: allocation }] };
    const result = validatePlan(candidate); expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ recordId: 'home-loan', field: 'rentals.loanAllocations' }));
  });
  it('validates the mixed explicit and proceeds-default loan allocation', () => {
    const source = plan(), unit = source.rentals[0]!, property = source.properties[0]!;
    const candidate = { ...source, properties: [{ ...property, loans: property.loans.map(loan => ({ ...loan, proceedsAllocations: [{ propertyId: 'home', rentalId: 'adu-two', use: 'rental' as const, share: { numerator: 1, denominator: 2 } }] })) }], rentals: [{ ...unit, loanAllocations: [{ loanId: 'home-loan', share: { numerator: 3, denominator: 4 }, qualification: { known: true as const, value: true } }] }, { ...unit, id: 'adu-two', loanAllocations: [] }] };
    expect(validatePlan(candidate).ok).toBe(false);
  });
});
