import { describe, expect, it } from 'vitest';
import type { ResolvedTaxFacts } from '../../../src/engine/tax/facts';
import type { DeductionChoice } from '../../../src/engine/tax/itemized';
import { calculateCaliforniaTax } from '../../../src/engine/tax/california';
import type { CaliforniaTaxResult } from '../../../src/engine/tax/california';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import type { Available } from '../../../src/engine/model/results';
import type { YearRules } from '../../../src/engine/rules/types';
import type { History } from '../../../src/engine/model/plan';
import type { PropertyYearFacts } from '../../../src/engine/property/facts';
import type { RentalLossRecord } from '../../../src/engine/tax/rental-losses';
import { loadReferences } from '../../helpers/references';

interface CaliforniaReferenceInput {
  readonly facts: ResolvedTaxFacts;
  readonly deductions: DeductionChoice;
  readonly opening: HouseholdTaxState;
  readonly rules: YearRules;
}
const references = loadReferences<CaliforniaReferenceInput,
  Available<Partial<CaliforniaTaxResult>>>('california-2026');
const first = references[0]!;
function calculate(input: CaliforniaReferenceInput = first.input) {
  return calculateCaliforniaTax(input.facts, input.deductions, input.opening, input.rules);
}
function rentalInput(qualification: History<boolean> | undefined,
  grossReceiptsCents = 5000000, regularProfit = 500000, amtProfit = 800000): CaliforniaReferenceInput {
  const i = structuredClone(first.input);
  const template = loadReferences<unknown, PropertyYearFacts>('property-2026')[0]!.expected.rentals[0]!;
  const originalUnit = template.unit;
  const { californiaSmallBusinessQualification: ignored, ...qualifications } = originalUnit.qualifications;
  void ignored;
  const unit = { ...originalUnit, qualifications: { ...qualifications,
    ...(qualification ? { californiaSmallBusinessQualification: qualification } : {}) } };
  const regularState = originalUnit.taxHistory.california;
  if (!regularState.known) throw new Error('The test supplies known synthetic California history.');
  const emptyMovement = { openingCents: 0, currentAdditionCents: 0, releaseCents: 0, closingCents: 0 };
  const record = (amount: number): RentalLossRecord => ({ rentalId: unit.id,
    taxableProfitCents: amount, allowedRentalCents: amount,
    atRisk: { ...emptyMovement, openingAmountAtRiskCents: 50000000, closingAmountAtRiskCents: 50000000 },
    passive: emptyMovement, releasedLossVintages: [], closingState: regularState.value });
  const ca = i.facts.rental.california;
  const caAmt = i.facts.rental.californiaAmt;
  if (ca.status !== 'available' || caAmt.status !== 'available') throw new Error('Available source inputs required.');
  const rental = { ...i.facts.rental,
    california: { status: 'available' as const, value: { ...ca.value,
      allowedRentalCents: regularProfit, rentals: [record(regularProfit)] } },
    californiaAmt: { status: 'available' as const, value: { ...caAmt.value,
      allowedRentalCents: amtProfit, rentals: [record(amtProfit)] } },
  };
  return { ...i, deductions: { method: 'itemized', standardCents: 1180000,
    allowedItemizedCents: 20000000,
    detail: { jurisdiction: 'california', originalCents: 20000000, allowedCents: 20000000,
      disallowedCents: 0, mortgageInterestCents: 0, mortgageInsuranceCents: 0,
      saltCents: 20000000, propertyTaxPaidCents: 20000000,
      niitDeductionCents: { status: 'available', value: 0 }, amtAllowedCents: 0,
      provenance: i.rules.provenance['california.standardDeductionCents']!, reasons: [] },
  }, facts: { ...i.facts, californiaAgiCents: { status: 'available', value: 30000000 },
    federalAgiCents: { status: 'available', value: 30000000 },
    californiaAmtIncomeCents: { status: 'available', value: 30000000 + amtProfit - regularProfit },
    californiaRentalCents: { status: 'available', value: regularProfit }, rental,
    preIra: { ...i.facts.preIra, rentalFacts: [{ ...template, unit, rentCents: grossReceiptsCents }] } } };
}
function suspendedBusinessLossInput(differingBooks: boolean): CaliforniaReferenceInput {
  const i = rentalInput({ known: true, value: true }, 5000000, 0, 0);
  const update = (book: 'california' | 'california-amt', amount: number) => {
    const jurisdiction = book === 'california' ? i.facts.rental.california : i.facts.rental.californiaAmt;
    if (jurisdiction.status !== 'available') throw new Error('Known synthetic loss books required.');
    const previous = jurisdiction.value.rentals[0]!;
    return { status: 'available' as const, value: { ...jurisdiction.value,
      closingPassiveLossCents: amount,
      rentals: [{ ...previous, taxableProfitCents: -amount,
        passive: { openingCents: 0, currentAdditionCents: amount, releaseCents: 0, closingCents: amount },
        closingState: { ...previous.closingState, passiveSuspendedCents: amount,
          lossVintages: [{ year: 2026, source: 'passive' as const, amountCents: amount,
            activeParticipation: { known: true as const, value: true } }] } }],
    } };
  };
  const regular = update('california', 500000);
  const amt = update('california-amt', differingBooks ? 800000 : 500000);
  const history = i.facts.preIra.rentalFacts[0]!.unit.taxHistory;
  const carried = Object.fromEntries(Object.entries(history).map(([book, h]) => [book,
    h.known ? { status: 'available' as const, value: book === 'california'
      ? regular.value.rentals[0]!.closingState : book === 'california-amt'
        ? amt.value.rentals[0]!.closingState : h.value } : { status: 'needs-data' as const, issues: [] },
  ])) as HouseholdTaxState['rentals'][string];
  return { ...i, facts: { ...i.facts, rental: { ...i.facts.rental,
    california: regular, californiaAmt: amt,
    closing: { ...i.facts.rental.closing, rentals: { adu: carried } } } } };
}

describe('California ordinary tax, filer credits, AMT and high-income surtax', () => {
  // Wrong table-bin inclusivity, federal instead of California taxable income,
  // after-credit AMT comparison, or missing senior credit must fail these values.
  it.each(references)('matches independent California worksheet amounts: $id', c => {
    expect(calculate(c.input)).toMatchObject(c.expected);
  });
  it('preserves provisional published-bracket and table-method assumptions', () => {
    const result = calculate();
    expect(result).toMatchObject({ status: 'available', value: {
      provenance: { status: 'provisional', baselineYear: 2026, applicableYear: 2026 },
    } });
    if (result.status !== 'available') throw new Error('Expected the defined provisional scenario.');
    expect(result.value.provenance.assumptions.length).toBeGreaterThan(0);
  });
  it('does not use the federal AGI, QBI or senior deduction to reduce California taxable income', () => {
    const i = first.input;
    const changed: CaliforniaReferenceInput = { ...i, facts: { ...i.facts,
      federalAgiCents: { status: 'available', value: 0 },
      federalAmtIncomeCents: { status: 'available', value: 0 },
    } };
    const before = calculate();
    const after = calculate(changed);
    expect(before.status).toBe('available');
    expect(after.status).toBe('available');
    if (before.status === 'available' && after.status === 'available') {
      expect(after.value.taxableIncomeCents).toBe(before.value.taxableIncomeCents);
    }
  });
  it('propagates unknown California AGI or age without a numeric tax placeholder', () => {
    const i = first.input;
    const unknown = { status: 'needs-data' as const, issues: [{ code: 'unknown-ca-agi',
      severity: 'warning' as const, explanation: 'Unknown California book', resolution: 'Supply California history' }] };
    expect(calculate({ ...i, facts: { ...i.facts, californiaAgiCents: unknown } }))
      .toEqual(unknown);
    const missingAge = calculate({ ...i, facts: { ...i.facts,
      filers: i.facts.filers.map((filer, index) => index === 0
        ? { ...filer, birthDate: { known: false as const } } : filer),
    } });
    expect(missingAge.status).toBe('needs-data');
    expect(missingAge).not.toHaveProperty('value');
  });
  it('retains the explicit prior minimum-tax-credit coverage boundary', () => {
    const i = first.input;
    const result = calculate({ ...i, opening: { ...i.opening,
      minimumTaxCreditCoverage: { ...i.opening.minimumTaxCreditCoverage,
        california: { known: true, value: true } },
    } });
    expect(result.status).toBe('unsupported-case');
    expect(result).not.toHaveProperty('value');
  });
  it('requires a complete itemized AMT candidate rather than substituting a standard amount', () => {
    const result = calculate({ ...first.input,
      deductions: { method: 'itemized', standardCents: 1180000, allowedItemizedCents: 2000000 },
    });
    expect(result.status).toBe('needs-data');
    expect(result).not.toHaveProperty('value');
  });
  it('excludes established small-business rental income and preferences while retaining wage AMTI', () => {
    expect(calculate(rentalInput({ known: true, value: true }))).toMatchObject({
      status: 'available', value: { amtIncomeCents: 29500000, amtExclusionCents: 500000,
        closingState: { minimumTaxCreditCoverage: { california: { known: true, value: false } } } },
    });
  });
  it('uses current-year strict aggregate gross receipts rather than doubling the MFJ threshold', () => {
    expect(calculate(rentalInput({ known: true, value: true }, 99999999))).toMatchObject({
      status: 'available', value: { amtExclusionCents: 500000 },
    });
    expect(calculate(rentalInput({ known: true, value: true }, 100000000))).toMatchObject({
      status: 'available', value: { amtExclusionCents: 0, amtIncomeCents: 30300000 },
    });
  });
  it('requires an independent California business qualification without inferring it from QBI', () => {
    const result = calculate(rentalInput(undefined));
    expect(result.status).toBe('needs-data');
    expect(result).not.toHaveProperty('value');
    expect(calculate(rentalInput({ known: true, value: false }))).toMatchObject({
      status: 'available', value: { amtExclusionCents: 0, amtIncomeCents: 30300000 },
    });
  });
  it('marks a newly relevant AMT deferral for the next-year minimum-tax-credit coverage boundary', () => {
    const i = rentalInput({ known: true, value: false }, 5000000, 500000, 30500000);
    const firstYear = calculate(i);
    expect(firstYear).toMatchObject({ status: 'available', value: {
      closingState: { minimumTaxCreditCoverage: { california: { known: true, value: true } } },
    } });
    if (firstYear.status !== 'available') throw new Error('The synthetic first year is available.');
    expect(firstYear.value.amtCents).toBeGreaterThan(0);
    const later = calculate({ ...i, facts: { ...i.facts, year: 2027 }, opening: firstYear.value.closingState });
    expect(later.status).toBe('unsupported-case');
    expect(later).not.toHaveProperty('value');
  });
  it('keeps missing indexed AMT rules unavailable instead of manufacturing a zero exemption', () => {
    const r = structuredClone(first.input.rules);
    const { exemptionCents: ignored, ...rest } = r.california.amt;
    void ignored;
    const result = calculate({ ...first.input, rules: { ...r,
      california: { ...r.california, amt: rest as YearRules['california']['amt'] } } });
    expect(result.status).toBe('needs-data');
    expect(result).not.toHaveProperty('value');
  });
  it('retains current tax and known equal business-loss books without fabricating a carry adjustment', () => {
    expect(calculate(suspendedBusinessLossInput(false))).toMatchObject({ status: 'available', value: {
      closingState: { rentals: { adu: { 'california-amt': { status: 'available',
        value: { passiveSuspendedCents: 500000 } } } } },
    } });
  });
  it('makes only the differing business-excluded AMT loss carry unavailable for later years', () => {
    const result = calculate(suspendedBusinessLossInput(true));
    expect(result).toMatchObject({ status: 'available', value: {
      closingState: { rentals: { adu: { california: { status: 'available' },
        'california-amt': { status: 'unsupported-case' } } } },
    } });
    if (result.status !== 'available') throw new Error('The current known liability is available.');
    expect(result.value.issues).toContainEqual(expect.objectContaining({
      code: 'unsupported-california-business-amt-carry', recordId: 'adu', year: 2026,
      field: 'taxHistory.california-amt.lossVintages',
    }));
  });
  it('does not treat a missing business-receipts threshold as an unlimited exclusion', () => {
    const i = rentalInput({ known: true, value: true });
    const { smallBusinessGrossReceiptsThresholdCents: ignored, ...rest } = i.rules.california.amt;
    void ignored;
    const result = calculate({ ...i, rules: { ...i.rules,
      california: { ...i.rules.california, amt: rest as YearRules['california']['amt'] } } });
    expect(result.status).toBe('needs-data');
    expect(result).not.toHaveProperty('value');
  });
  it('preserves differing source years in suspended AMT vintages even when their totals match', () => {
    const i = suspendedBusinessLossInput(false);
    const current = i.facts.rental.californiaAmt;
    if (current.status !== 'available') throw new Error('Known synthetic input required.');
    const record = current.value.rentals[0]!;
    const result = calculate({ ...i, facts: { ...i.facts, rental: { ...i.facts.rental,
      californiaAmt: { status: 'available', value: { ...current.value, rentals: [{ ...record,
        closingState: { ...record.closingState, lossVintages: record.closingState.lossVintages
          .map(vintage => ({ ...vintage, year: 2025 })) } }] } },
    } } });
    expect(result).toMatchObject({ status: 'available', value: {
      closingState: { rentals: { adu: { 'california-amt': { status: 'unsupported-case' } } } },
    } });
  });
  it('produces deterministic output from immutable facts, choices and carried state', () => {
    const i = structuredClone(first.input);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    };
    freeze(i);
    expect(calculate(i)).toEqual(calculate(i));
    expect(i.opening.year).toBe(2025);
  });
});
