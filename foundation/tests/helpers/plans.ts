import type { PlanDocument, ValidatedPlan } from '../../src/engine/model/plan';
import { validatePlan } from '../../src/engine/validation';

/** Synthetic, fully answered empty household; never uses personal financial data. */
export function makePlan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    schemaVersion: 1, id: 'synthetic-plan', revision: 0, startYear: 2026, horizonYears: 1,
    openingCashCents: 0,
    household: {
      filingStatus: 'married-joint', residence: 'CA-full-year', currency: 'USD',
      filers: [
        { id: 'owner-a', name: 'Filer A', birthDate: { known: true, value: '1980-01-01' }, workplaceCoverage: { known: true, value: false }, coverageByYear: [], employerAssumptionsByYear: [] },
        { id: 'owner-b', name: 'Filer B', birthDate: { known: true, value: '1982-01-01' }, workplaceCoverage: { known: true, value: false }, coverageByYear: [], employerAssumptionsByYear: [] },
      ],
      coverageAnswers: {
        additionalIncome: { known: true, value: false }, additionalCredits: { known: true, value: false },
        qualifiedDividendsOrCapitalGains: { known: true, value: false }, retirementDistributions: { known: true, value: false },
        priorFederalMinimumTaxCredits: { known: true, value: false }, priorCaliforniaMinimumTaxCredits: { known: true, value: false },
      },
    },
    taxPolicy: { baselineYear: 2026, futureIndexGrowthBps: 0, actualStateTaxPaidByYear: [] },
    salaries: [], otherIncome: [], expenses: [], accounts: [], contributions: [], debts: [], properties: [], rentals: [],
    ...overrides,
  };
}

export function mustValidate(doc: PlanDocument): ValidatedPlan {
  const result = validatePlan(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
}
