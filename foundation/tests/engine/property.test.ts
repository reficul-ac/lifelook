import { describe, expect, it } from 'vitest';
import type { Expense, PlanDocument, Property, RentalBookState, RentalUnit, TaxBook } from '../../src/engine/model/plan';
import type { HouseholdTaxState } from '../../src/engine/model/tax-state';
import { initialTaxState } from '../../src/engine/model/tax-state';
import type { CashYear } from '../../src/engine/cash/income';
import { resolveCashYear } from '../../src/engine/cash/income';
import { allocateExpense } from '../../src/engine/property/allocation';
import { calculateDepreciation } from '../../src/engine/property/depreciation';
import { buildPropertyFacts } from '../../src/engine/property/facts';
import type { PropertyYearFacts } from '../../src/engine/property/facts';
import { calculateLoanSchedule } from '../../src/engine/property/loans';
import type { LoanSchedule } from '../../src/engine/property/loans';
import type { YearRules } from '../../src/engine/rules/types';
import { loadReferences } from '../helpers/references';
import { mustValidate } from '../helpers/plans';

interface PropertyReferenceInput {
  readonly plan: PlanDocument;
  readonly cash: CashYear;
  readonly loans: readonly LoanSchedule[];
  readonly opening: HouseholdTaxState;
  readonly rules: YearRules;
}
const references = loadReferences<PropertyReferenceInput, PropertyYearFacts>('property-2026');
const reference = references[0]!;
const rules = reference.input.rules;
const property = reference.input.plan.properties[0]!;
const unit = reference.input.plan.rentals[0]!;
const state = unit.taxHistory.federal;
if (!state.known) throw new Error('The ordinary fixture requires independently declared opening history.');
const baseState = state.value;
const expense = reference.input.plan.expenses[0]!;
const available = (value: RentalBookState) => ({ status: 'available' as const, value });
function changedPlan(overrides: Partial<PlanDocument>): PlanDocument {
  return { ...reference.input.plan, ...overrides };
}
function factsFor(plan: PlanDocument, opening?: HouseholdTaxState): PropertyYearFacts {
  const valid = mustValidate(plan);
  return buildPropertyFacts(valid, resolveCashYear(valid, plan.startYear),
    plan.properties.flatMap(p => p.loans.map(l => calculateLoanSchedule(l, plan.startYear, plan.horizonYears))),
    opening ?? initialTaxState(valid), rules);
}

describe('property cash allocation and independent depreciation tax books', () => {
  it('preserves loan at-risk qualification for rental-loss consumers',()=>{
    const p=reference.input.plan;
    const loan={id:'risk-mortgage',name:'Mortgage',originalPrincipalCents:120000,aprBps:1200,originationDate:'2025-12-01',acquisitionDate:'2025-12-01',termMonths:12,firstPaymentDate:'2026-01-31',openingBalance:{known:true as const,value:120000},openingPayment:{known:true as const,value:10000},collateralPropertyId:'home',proceedsQualification:{kind:'acquisition' as const,qualifiedAcquisitionDebt:{known:true as const,value:true},qualifiedPrincipalCents:{known:true as const,value:120000},historyComplete:{known:true as const,value:true}},proceedsAllocations:[{propertyId:'home',rentalId:'adu',use:'rental' as const,share:{numerator:1,denominator:4}},{propertyId:'home',use:'personal' as const,share:{numerator:3,denominator:4}}],financingAtRiskQualification:{known:false as const}};
    const plan={...p,properties:[{...property,loans:[loan]}]};
    const rental=factsFor(plan).rentals[0]!;
    expect(rental).toHaveProperty('financingAtRiskQualification',{known:false});
    expect(rental.books.federal.status).toBe('available');
  });
  it('preserves declared mortgage insurance qualification in expense facts',()=>{
    const premium:Expense={...expense,id:'premium',taxCategory:'mortgage-insurance',mortgageInsuranceQualification:{known:true,value:true}};
    const facts=factsFor(changedPlan({expenses:[premium]}));
    expect(facts.expenses[0]).toHaveProperty('mortgageInsuranceQualification',{known:true,value:true});
  });
  // Resetting recovery basis, leaking rental costs into Schedule A, or counting
  // depreciation/principal twice must fail these whole-result references.
  it.each(references)('matches independently checked property facts: $id', c => {
    const i = c.input;
    expect(buildPropertyFacts(mustValidate(i.plan), i.cash, i.loans, i.opening, i.rules))
      .toEqual(c.expected);
  });

  it('assigns fractional shared-cost cents once with the personal residual', () => {
    expect(allocateExpense(expense, property, [unit], 100001)).toEqual({
      personalCents: 75001, rentalCentsByUnit: { adu: 25000 },
    });
  });
  it('assigns direct rental costs wholly to their stated unit', () => {
    expect(allocateExpense({ ...expense, use: 'rental', rentalId: 'adu' }, property,
      [unit], 100001)).toEqual({ personalCents: 0, rentalCentsByUnit: { adu: 100001 } });
  });
  it('honors explicit expense allocations instead of substituting floor area', () => {
    expect(allocateExpense({ ...expense, allocationOverride: { numerator: 1, denominator: 3 } },
      property, [unit], 100001)).toEqual({
      personalCents: 66667, rentalCentsByUnit: { adu: 33334 },
    });
  });
  it('conserves cents across sorted rental units and rejects overallocated shares', () => {
    const second: RentalUnit = { ...unit, id: 'second', sharedAllocation: { numerator: 1, denominator: 3 } };
    const first: RentalUnit = { ...unit, sharedAllocation: { numerator: 1, denominator: 3 } };
    expect(allocateExpense(expense, property, [second, first], 100001))
      .toEqual({ personalCents: 33334, rentalCentsByUnit: { adu: 33334, second: 33333 } });
    expect(() => allocateExpense(expense, property, [
      { ...first, sharedAllocation: { numerator: 3, denominator: 4 } }, second,
    ], 100001)).toThrow('allocation');
  });

  it('starts January depreciation at availability even when rent begins in July', () => {
    const result = calculateDepreciation(unit, 2026, 'federal', available(baseState), rules);
    expect(result).toMatchObject({ status: 'available', value: {
      recoveryBasisCents: 33000000, monthsRecovered: 11.5, depreciationCents: 1150000,
      closing: { adjustedBuildingBasisCents: 31850000, cumulativeDepreciationCents: 1150000 },
    } });
  });
  it('uses the original recovery basis after the first year rather than restarting on remaining basis', () => {
    const result = calculateDepreciation(unit, 2027, 'federal', available({ ...baseState,
      adjustedBuildingBasisCents: 31850000, cumulativeDepreciationCents: 1150000,
    }), rules);
    expect(result).toMatchObject({ status: 'available', value: {
      depreciationCents: 1200000, closing: { adjustedBuildingBasisCents: 30650000,
        cumulativeDepreciationCents: 2350000 },
    } });
  });
  it('honors the final mid-month recovery boundary and the remaining-basis cap', () => {
    expect(calculateDepreciation(unit, 2053, 'federal', available({ ...baseState,
      adjustedBuildingBasisCents: 650000, cumulativeDepreciationCents: 32350000,
    }), rules)).toMatchObject({ status: 'available', value: {
      monthsRecovered: 6.5, depreciationCents: 650000,
      closing: { adjustedBuildingBasisCents: 0, cumulativeDepreciationCents: 33000000 },
    } });
    expect(calculateDepreciation(unit, 2027, 'federal', available({ ...baseState,
      adjustedBuildingBasisCents: 50000, cumulativeDepreciationCents: 32950000,
    }), rules)).toMatchObject({ status: 'available', value: { depreciationCents: 50000 } });
  });
  it('keeps a known exhausted zero basis available and never regenerates it from market value', () => {
    const result = calculateDepreciation(unit, 2027, 'federal', available({ ...baseState,
      adjustedBuildingBasisCents: 0, cumulativeDepreciationCents: 33000000,
    }), rules);
    expect(result).toMatchObject({ status: 'available', value: { depreciationCents: 0 } });
    const altered = { ...property, purchasePriceCents: 100000000, openingValueCents: 200000000 };
    expect(factsFor(changedPlan({ properties: [altered] })).rentals[0]?.books.federal)
      .toEqual(reference.expected.rentals[0]?.books.federal);
  });
  it('takes the lower building conversion FMV without including land', () => {
    const converted: RentalUnit = { ...unit, convertedFromPersonalUse: true,
      conversionBuildingFmv: { known: true, value: 27000000 } };
    expect(calculateDepreciation(converted, 2026, 'federal', available(baseState), rules))
      .toMatchObject({ status: 'available', value: {
        recoveryBasisCents: 27000000, depreciationCents: 940909,
        closing: { recoveryBasisCents: 27000000, adjustedBuildingBasisCents: 26059091,
          cumulativeDepreciationCents: 940909 },
      } });
  });
  it('requires conversion FMV and preserves unavailable opening history without numeric placeholders', () => {
    const missing = calculateDepreciation({ ...unit, convertedFromPersonalUse: true },
      2026, 'federal', available(baseState), rules);
    expect(missing.status).toBe('needs-data');
    expect(missing).not.toHaveProperty('value');
    const unknown = { status: 'needs-data' as const, issues: [{ code: 'unknown-history',
      severity: 'warning' as const, explanation: 'Unknown', resolution: 'Supply history' }] };
    expect(calculateDepreciation(unit, 2026, 'federal', unknown, rules)).toEqual(unknown);
  });
  it('blocks depreciation outside the exclusive ordinary long-term rental qualifications', () => {
    expect(calculateDepreciation({ ...unit, qualifications: { ...unit.qualifications,
      noPersonalUse: { known: false } } }, 2026, 'federal', available(baseState), rules).status)
      .toBe('needs-data');
    expect(calculateDepreciation({ ...unit, qualifications: { ...unit.qualifications,
      longTermFairMarketLease: { known: true, value: false } } },
    2026, 'federal', available(baseState), rules).status).toBe('unsupported-case');
  });
  it.each(['federal', 'california', 'federal-amt', 'california-amt'] as const)(
    'reads its own %s basis and depreciation history', book => {
      const bases: Readonly<Record<TaxBook, number>> = {
        federal: 33000000, california: 30000000, 'federal-amt': 27000000, 'california-amt': 24000000,
      };
      const basis = bases[book];
      const expected: Readonly<Record<TaxBook, number>> = {
        federal: 1150000, california: 1045455, 'federal-amt': 940909, 'california-amt': 836364,
      };
      const result = calculateDepreciation(unit, 2026, book, available({ ...baseState,
        recoveryBasisCents: basis, adjustedBuildingBasisCents: basis,
      }), rules);
      expect(result).toMatchObject({ status: 'available', value: { depreciationCents: expected[book] } });
    },
  );
  it.each(['federal-amt', 'california-amt'] as const)(
    'uses sourced forty-year recovery for pre-1999 %s residential history', book => {
      expect(calculateDepreciation({ ...unit, availableDate: '1990-01-01' }, 2026, book,
        available({ ...baseState, adjustedBuildingBasisCents: 20000000,
          cumulativeDepreciationCents: 13000000 }), rules)).toMatchObject({
        status: 'available', value: { monthsRecovered: 12, depreciationCents: 825000 },
      });
    },
  );
  it('makes pre-MACRS depreciation unavailable instead of applying a modern recovery period', () => {
    expect(calculateDepreciation({ ...unit, availableDate: '1980-01-01' },
      2026, 'federal', available(baseState), rules).status).toBe('unsupported-case');
  });
  it('retains provisional rule status in a future depreciation scenario', () => {
    const altered: YearRules = { ...rules, provenance: { ...rules.provenance,
      'federal.rental.recoveryPeriodMonths': { ...rules.provenance['federal.rental.recoveryPeriodMonths']!,
        status: 'provisional', assumptions: ['Explicit hypothetical method proxy.'] } } };
    expect(calculateDepreciation(unit, 2027, 'federal', available(baseState), altered))
      .toMatchObject({ status: 'available', value: { provenance: { status: 'provisional' } } });
  });
  it('keeps known rent and cash costs when one opening tax book is unknown', () => {
    const missing: RentalUnit = { ...unit, taxHistory: { ...unit.taxHistory, federal: { known: false } } };
    const result = factsFor(changedPlan({ rentals: [missing] }));
    expect(result.rentals[0]).toMatchObject({ rentCents: 600000, operatingExpenseCents: 147500,
      cashFlowCents: 452500 });
    expect(result.rentals[0]?.books.federal.status).toBe('needs-data');
    expect(result.rentals[0]?.books.federal).not.toHaveProperty('value');
    expect(result.rentals[0]?.books.california.status).toBe('available');
    expect(result.closingRentalState.adu?.federal.status).toBe('needs-data');
  });
  it('records capital spending as cash while blocking unsupported affected basis schedules', () => {
    const capital: Expense = { ...expense, id: 'capital', use: 'rental', rentalId: 'adu',
      taxCategory: 'capital', amountCents: 100000 };
    const result = factsFor(changedPlan({ expenses: [...reference.input.plan.expenses, capital] }));
    expect(result.rentals[0]).toMatchObject({ capitalExpenseCents: 100000, cashFlowCents: 352500 });
    expect(result.rentals[0]?.books.federal.status).toBe('unsupported-case');
    expect(result.closingRentalState.adu?.federal.status).toBe('unsupported-case');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'unsupported-capital-basis-schedule', recordId: 'adu', year: 2026,
    }));
  });
  it('allocates full loan cash separately from traced eligible interest without deducting principal', () => {
    const loan = {
      id: 'mortgage', name: 'Shared mortgage', originalPrincipalCents: 120000,
      aprBps: 1200, originationDate: '2025-12-01', acquisitionDate: '2025-12-01',
      termMonths: 12, firstPaymentDate: '2026-01-31',
      openingBalance: { known: true as const, value: 120000 },
      openingPayment: { known: true as const, value: 10000 }, collateralPropertyId: 'home',
      proceedsQualification: { kind: 'acquisition' as const,
        qualifiedAcquisitionDebt: { known: true as const, value: true },
        qualifiedPrincipalCents: { known: true as const, value: 120000 },
        historyComplete: { known: true as const, value: true } },
      proceedsAllocations: [
        { propertyId: 'home', rentalId: 'adu', use: 'rental' as const, share: { numerator: 1, denominator: 4 } },
        { propertyId: 'home', use: 'personal' as const, share: { numerator: 3, denominator: 4 } },
      ], financingAtRiskQualification: { known: true as const, value: true },
    };
    const result = factsFor(changedPlan({ properties: [{ ...property, loans: [loan] }] }));
    // Independent monthly nominal worksheet gives 8394 interest / 111606 principal.
    expect(result.cash).toMatchObject({ debtPaymentCents: 120000, interestCents: 8394,
      principalPaidCents: 111606 });
    expect(result.rentals[0]).toMatchObject({ debtPaymentCents: 30000,
      cashInterestCents: 2099, principalPaidCents: 27901, cashFlowCents: 422500,
      eligibleInterestCents: { status: 'available', value: 2099 },
      books: { federal: { status: 'available', value: { taxableProfitCents: -699599 } } },
    });
    expect(result.personal.mortgageInterestCents).toEqual({ status: 'available', value: 6295 });
  });
  it('does not let area alone invent a rental interest deduction when proceeds history is unknown', () => {
    const loan = {
      id: 'uncertain-mortgage', name: 'Uncertain mortgage', originalPrincipalCents: 120000,
      aprBps: 1200, originationDate: '2025-12-01', acquisitionDate: '2025-12-01',
      termMonths: 12, firstPaymentDate: '2026-01-31',
      openingBalance: { known: true as const, value: 120000 },
      openingPayment: { known: true as const, value: 10000 }, collateralPropertyId: 'home',
      proceedsQualification: { kind: 'unknown' as const,
        qualifiedAcquisitionDebt: { known: false as const }, qualifiedPrincipalCents: { known: false as const },
        historyComplete: { known: false as const } },
      proceedsAllocations: [], financingAtRiskQualification: { known: false as const },
    };
    const result = factsFor(changedPlan({ properties: [{ ...property, loans: [loan] }] }));
    expect(result.rentals[0]?.cashFlowCents).toBe(422500);
    expect(result.rentals[0]?.eligibleInterestCents.status).toBe('needs-data');
    expect(result.rentals[0]?.books.federal).not.toHaveProperty('value');
    expect(result.rentals[0]?.depreciation.federal.status).toBe('available');
  });
  it('deducts only actually paid current interest during negative amortization', () => {
    const loan = {
      id: 'below-interest-mortgage', name: 'Below-interest mortgage', originalPrincipalCents: 10000,
      aprBps: 1200, originationDate: '2025-12-01', acquisitionDate: '2025-12-01',
      termMonths: 360, firstPaymentDate: '2026-01-31',
      openingBalance: { known: true as const, value: 10000 },
      openingPayment: { known: true as const, value: 50 }, collateralPropertyId: 'home',
      proceedsQualification: { kind: 'acquisition' as const,
        qualifiedAcquisitionDebt: { known: true as const, value: true },
        qualifiedPrincipalCents: { known: true as const, value: 10000 },
        historyComplete: { known: true as const, value: true } },
      proceedsAllocations: [
        { propertyId: 'home', rentalId: 'adu', use: 'rental' as const, share: { numerator: 1, denominator: 4 } },
        { propertyId: 'home', use: 'personal' as const, share: { numerator: 3, denominator: 4 } },
      ], financingAtRiskQualification: { known: true as const, value: true },
    };
    const result = factsFor(changedPlan({ properties: [{ ...property, loans: [loan] }] }));
    expect(result.rentals[0]?.eligibleInterestCents).toEqual({ status: 'available', value: 150 });
    expect(result.personal.mortgageInterestCents).toEqual({ status: 'available', value: 450 });
    expect(result.rentals[0]?.principalPaidCents).toBeLessThan(0);
  });
});
