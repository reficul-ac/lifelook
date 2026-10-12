import { expect, it } from 'vitest';
import { defaultRentalAllocation, initializePurchaseLoan } from '../../src/engine/property/input-defaults';
import { loadReferences } from '../helpers/references';
import type { PlanDocument } from '../../src/engine/model/plan';
import { validatePlan } from '../../src/engine/validation';

it('initializes ordinary purchase principal and payment with the loan convention', () => {
  expect(initializePurchaseLoan({ purchasePriceCents: 50000000, downPaymentCents: 20000000, aprBps: 0, termMonths: 360 }))
    .toEqual({ status: 'available', value: { originalPrincipalCents: 30000000, monthlyPaymentCents: 83333 } });
  // Independent fixed-rate annuity: $300,000, 6%, 360 payments -> $1,798.65.
  expect(initializePurchaseLoan({ purchasePriceCents: 50000000, downPaymentCents: 20000000, aprBps: 600, termMonths: 360 }))
    .toEqual({ status: 'available', value: { originalPrincipalCents: 30000000, monthlyPaymentCents: 179865 } });
});
it('rejects impossible or incomplete purchase terms without a numeric default', () => {
  for (const input of [
    { purchasePriceCents: 100, downPaymentCents: 101, aprBps: 0, termMonths: 360 },
    { purchasePriceCents: 100, downPaymentCents: 0, aprBps: -1, termMonths: 360 },
    { purchasePriceCents: 100, downPaymentCents: 0, aprBps: 0, termMonths: 0 },
    { purchasePriceCents: NaN, downPaymentCents: 0, aprBps: 0, termMonths: 360 },
  ]) {
    const value = initializePurchaseLoan(input);
    expect(value.status).toBe('needs-data'); expect(value).not.toHaveProperty('value');
  }
});
it('returns a serializable default area allocation using the engine allocation rules', () => {
  const plan = loadReferences<PlanDocument, unknown>('projection').find(c => c.id === 'two-salaries-home-adu')!.input;
  const rental = { ...plan.rentals[0]!, sharedAllocation: undefined };
  const { sharedAllocation: _, ...unit } = rental;
  expect(defaultRentalAllocation(plan.properties[0]!, [unit])).toEqual({ status: 'available', value: { adu: '25.00%' } });
  const invalid = defaultRentalAllocation({ ...plan.properties[0]!, aduArea: 0 }, [unit]);
  expect(invalid.status).toBe('needs-data'); expect(invalid).not.toHaveProperty('value');
});
it('rejects future acquisition history for an existing property loan', () => {
  const plan = loadReferences<PlanDocument, unknown>('projection').find(c => c.id === 'two-salaries-home-adu')!.input;
  const original = plan.properties[0]!;
  const invalid = validatePlan({ ...plan, properties: [{ ...original, loans: [{ ...original.loans[0]!, acquisitionDate: '2027-01-01' }] }] });
  expect(invalid.ok).toBe(false);
  expect(invalid.issues).toContainEqual(expect.objectContaining({ recordId: original.loans[0]!.id, field: 'acquisitionDate' }));
});
