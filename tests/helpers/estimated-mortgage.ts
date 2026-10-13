import type { PlanDocument } from '../../src/engine';
import { makePlan } from './plans';

/** Complete synthetic qualification history with opening amounts derived from loan terms. */
export function makeEstimatedMortgagePlan(): PlanDocument {
  return makePlan({
    horizonYears: 3,
    openingCashCents: 5000000,
    salaries: [
      { id: 'salary-a', name: 'Filer A salary', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 15000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] },
      { id: 'salary-b', name: 'Filer B salary', ownerId: 'owner-b', employerId: 'employer-b', annualGrossCents: 9000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] },
    ],
    expenses: [
      { id: 'living-expenses', name: 'Living expenses', amountCents: 250000, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal' },
      { id: 'property-tax', name: 'Property tax', propertyId: 'home', amountCents: 600000, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'property-tax' },
    ],
    properties: [{
      id: 'home', name: 'Synthetic primary home', role: 'primary', purchaseDate: '2024-01-01',
      purchasePriceCents: 60000000, downPaymentCents: 12000000, openingValueCents: 65000000,
      appreciationBps: 0, appreciationOverrides: [],
      loans: [{
        id: 'home-loan', name: 'Synthetic fixed mortgage', originalPrincipalCents: 48000000,
        aprBps: 500, originationDate: '2024-01-01', acquisitionDate: '2024-01-01',
        termMonths: 360, firstPaymentDate: '2024-02-01',
        openingBalance: { known: false }, openingPayment: { known: false }, collateralPropertyId: 'home',
        proceedsQualification: {
          kind: 'acquisition', qualifiedAcquisitionDebt: { known: true, value: true },
          qualifiedPrincipalCents: { known: true, value: 48000000 }, historyComplete: { known: true, value: true },
        },
        proceedsAllocations: [{ propertyId: 'home', use: 'personal', share: { numerator: 1, denominator: 1 } }],
        financingAtRiskQualification: { known: true, value: true },
      }],
    }],
  });
}
