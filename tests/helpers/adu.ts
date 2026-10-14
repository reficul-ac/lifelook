import type { AduBookTreatments, AduProject, AduTaxSplit, PlanDocument, RentalBookState, TaxBook } from '../../src/engine/model/plan';
import type { Available } from '../../src/engine/model/results';
import { makePlan } from './plans';

export const aduBooks: readonly TaxBook[] = ['federal', 'california', 'federal-amt', 'california-amt'];
export const zeroAduBook: RentalBookState = { recoveryBasisCents: 0, adjustedBuildingBasisCents: 0, cumulativeDepreciationCents: 0, atRiskCents: 0, atRiskSuspendedCents: 0, passiveSuspendedCents: 0, lossVintages: [] };
export function makeAduTreatments(amountCents: number, kind: keyof AduTaxSplit = 'buildingBasisCents'): AduBookTreatments {
  const split: AduTaxSplit = { buildingBasisCents: 0, currentDeductionCents: 0, nondepreciableBasisCents: 0, nondeductibleExpenseCents: 0, [kind]: amountCents };
  return Object.fromEntries(aduBooks.map(book => [book, { known: true, value: { ...split } }])) as unknown as AduBookTreatments;
}
export function makeAduPlan(planOverrides: Partial<PlanDocument> = {}, projectOverrides: Partial<AduProject> = {}): PlanDocument {
  const project: AduProject = {
    id: 'adu-project', name: 'Synthetic new ADU', rentalId: 'new-adu', constructionStartDate: '2027-01-01', completionDate: '2027-07-31',
    costs: [{ id: 'building-stage', name: 'Building', paymentDate: '2027-07-01', amountCents: 30_000_000, category: 'building', treatments: makeAduTreatments(30_000_000) }],
    valuation: { kind: 'adu-value-per-square-foot', valuePerSquareFootCents: 27_500 }, sharedExpenseOverrides: [],
    propertyTax: { addedAssessedValueCents: { known: true, value: 22_000_000 }, marginalRateBps: { known: true, value: 120 }, annualAssessmentGrowthBps: 200, completedValueEnrollmentYear: 2028, additionalAnnualChargesCents: 0, constructionAssessments: [], paymentYears: [2026, 2027, 2028].map(year => ({ year, complete: { known: true, value: true }, payments: [] })), originalExpenseExcludesAdu: { known: true, value: true } },
    taxQualifications: Object.fromEntries(aduBooks.map(book => [book, { known: true, value: true }])) as AduProject['taxQualifications'],
    productionPeriod: { known: true, value: { startDate: '2027-01-01', endDate: '2027-07-31', uninterrupted: true } }, supportOperatingDeficits: { known: true, value: true }, ...projectOverrides,
  };
  return makePlan({ horizonYears: 3, openingCashCents: 40_000_000,
    properties: [{ id: 'home', name: 'Existing primary home', role: 'primary-with-adu', purchaseDate: '2024-01-01', purchasePriceCents: 80_000_000, downPaymentCents: 80_000_000, openingValueCents: 100_000_000, appreciationBps: 0, appreciationOverrides: [], primaryArea: 1800, aduArea: 800, loans: [], aduProject: project }],
    rentals: [{ id: 'new-adu', propertyId: 'home', availableDate: '2027-08-01', rentStartDate: '2027-09-01', monthlyRentCents: 0, rentGrowthBps: 0,
      activeParticipation: { known: true, value: true }, loanAllocations: [], convertedFromPersonalUse: false, conversionBuildingFmv: { known: true, value: 0 },
      qualifications: { longTermFairMarketLease: { known: true, value: true }, noPersonalUse: { known: true, value: true }, noSubstantialTenantServices: { known: true, value: true }, ordinaryResidential: { known: true, value: true }, advancedBasisAdjustments: { known: true, value: false }, californiaSmallBusinessQualification: { known: true, value: true } },
      taxHistory: Object.fromEntries(aduBooks.map(book => [book, { known: true, value: structuredClone(zeroAduBook) }])) as PlanDocument['rentals'][number]['taxHistory'],
      qbi: { qualification: { known: true, value: false }, wagesCents: { known: true, value: 0 }, ubiaCents: { known: true, value: 0 }, openingLossVintages: { known: true, value: [] } },
    }], ...planOverrides,
  });
}
export function aduValue<T>(result: Available<T>): T {
  if (result.status !== 'available') throw new Error(JSON.stringify(result.issues));
  return result.value;
}
