import type { PlanDocument } from '../../src/engine/model/plan';
import { makePlan } from './plans';

/** Fully answered assets with deliberately different retained custom rates. */
export function makeGrowthPlan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return makePlan({
    accounts: [
      { id: 'stock', name: 'Stock account', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 1_000_000, annualGrowthBps: 500, openingIraBasis: { known: true, value: 0 }, openingTaxableBasis: { known: true, value: 1_000_000 } },
      { id: 'custom', name: 'Custom Roth', ownerId: 'owner-b', type: 'roth-ira', openingBalanceCents: 0, annualGrowthBps: 650, openingIraBasis: { known: true, value: 0 } },
    ],
    properties: [{ id: 'home', name: 'Owned home', role: 'primary', purchaseDate: '2020-01-01', purchasePriceCents: 1_000_000, downPaymentCents: 1_000_000, openingValueCents: 1_000_000, appreciationBps: 300, appreciationOverrides: [], loans: [] }],
    ...overrides,
  });
}

export function makeScheduledGrowthPlan(): PlanDocument {
  const plan = makeGrowthPlan();
  return {
    ...plan,
    horizonYears: 2,
    accounts: [...plan.accounts, {
      id: 'scheduled', name: 'Scheduled RSUs', ownerId: 'owner-a', type: 'rsu', openingBalanceCents: 0,
      annualGrowthBps: 200, openingIraBasis: { known: false },
      rsu: {
        employerId: 'employer', currentSharePriceCents: 10_000,
        priceTargets: [{ date: '2027-01-01', sharePriceCents: 20_000 }],
        grants: [{ id: 'held-grant', name: 'Fully vested historical grant', startDate: '2024-01-01', grantValueCents: 10_000, grantSharePriceCents: 10_000, vestingMonths: 12, vestingFrequency: 'monthly', cliffMonths: 0, withholdingBps: 0, taxTreatment: 'settle-at-vest', openingHeldShares: 1, openingBasis: { known: true, value: 10_000 } }],
      },
    }],
  };
}
