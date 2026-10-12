import { parseISODate } from '../dates';
import { Decimal, settleCents } from '../money';
import type { Cents, RentalBookState, RentalUnit, TaxBook } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { YearRules } from '../rules/types';

export interface DepreciationYear {
  readonly rentalId: string;
  readonly year: number;
  readonly book: TaxBook;
  readonly recoveryBasisCents: Cents;
  readonly openingAdjustedBuildingBasisCents: Cents;
  readonly depreciationCents: Cents;
  readonly monthsRecovered: number;
  readonly closing: RentalBookState;
  readonly provenance: RuleProvenance;
}

function issue(unit: RentalUnit, year: number, book: TaxBook, code: string,
  field: string, explanation: string, resolution: string): Issue {
  return { code, recordId: unit.id, year, field: `${field}.${book}`, severity: 'warning', explanation, resolution };
}

export function calculateDepreciation(
  unit: RentalUnit, year: number, book: TaxBook,
  opening: Available<RentalBookState>, rules: YearRules,
): Available<DepreciationYear> {
  if (opening.status !== 'available') return opening;
  const qualifications = (['ordinaryResidential', 'longTermFairMarketLease',
    'noPersonalUse', 'noSubstantialTenantServices', 'advancedBasisAdjustments'] as const)
    .map(field => [field, unit.qualifications[field]] as const);
  if (qualifications.some(([, answer]) => !answer.known)) return { status: 'needs-data', issues: [
    issue(unit, year, book, 'required-depreciation-qualification', 'qualifications',
      'The exclusive long-term residential rental or basis-adjustment qualifications are unknown.',
      'Confirm fair-market residential rental use without personal use or substantial tenant services, and supply basis-adjustment history.'),
  ] };
  if (qualifications.some(([field, answer]) => answer.known
    && (field === 'advancedBasisAdjustments' ? answer.value : !answer.value))) return { status: 'unsupported-case', issues: [
    issue(unit, year, book, 'unsupported-depreciation-history', 'qualifications',
      'This rental requires a depreciation or basis-adjustment schedule outside ordinary residential recovery.',
      'Supply a supported ordinary residential history or model the additional schedule separately.'),
  ] };
  const jurisdiction = book.startsWith('california') ? 'california' : 'federal';
  const method = rules[jurisdiction].rental;
  if (method.convention !== 'mid-month' || !Number.isInteger(method.recoveryPeriodMonths)
    || method.recoveryPeriodMonths <= 0) return { status: 'unsupported-case', issues: [
    issue(unit, year, book, 'unsupported-depreciation-method', 'rules',
      'The selected depreciation recovery method is unsupported.',
      'Use sourced straight-line residential rules with the mid-month convention.'),
  ] };
  if (unit.availableDate < method.ordinaryMacrsFromDate) return { status: 'unsupported-case', issues: [
    issue(unit, year, book, 'unsupported-pre-macrs-history', 'availableDate',
      'The building predates the supported ordinary MACRS recovery methods.',
      'Supply a separately verified historical recovery schedule before using this tax book.'),
  ] };
  const amtBook = book.endsWith('-amt');
  const oldAmtMethod = amtBook && unit.availableDate < method.amtSameRecoveryFromDate;
  const recoveryPeriod = oldAmtMethod ? method.amtPre1999RecoveryPeriodMonths : method.recoveryPeriodMonths;
  const ready = parseISODate(unit.availableDate);
  let recovery = opening.value.recoveryBasisCents;
  let remaining = opening.value.adjustedBuildingBasisCents;
  if (unit.convertedFromPersonalUse) {
    if (!unit.conversionBuildingFmv.known) return { status: 'needs-data', issues: [
      issue(unit, year, book, 'required-conversion-fmv', 'conversionBuildingFmv',
        'The conversion-date building fair-market value is unknown.',
        'Enter the building-only fair-market value at conversion, excluding land.'),
    ] };
    const conversionFmv = unit.conversionBuildingFmv.value;
    if (year === ready.year && opening.value.cumulativeDepreciationCents === 0) {
      recovery = settleCents(Decimal.min(recovery, remaining, conversionFmv));
      remaining = recovery;
    } else if (recovery > conversionFmv) return { status: 'unsupported-case', issues: [
      issue(unit, year, book, 'inconsistent-conversion-history', 'taxHistory',
        'The historical recovery basis exceeds the supplied conversion-date building value.',
        'Reconcile the original conversion basis and prior depreciation before claiming later deductions.'),
    ] };
  }
  const serviceStart = new Decimal(ready.year * 12 + ready.month - 1).plus('0.5');
  const serviceEnd = serviceStart.plus(recoveryPeriod);
  const yearStart = new Decimal(year * 12);
  const months = Decimal.max(0, Decimal.min(serviceEnd, yearStart.plus(12))
    .minus(Decimal.max(serviceStart, yearStart)));
  const amount = Decimal.min(remaining, new Decimal(recovery)
    .div(recoveryPeriod).times(months));
  const depreciationCents = settleCents(amount);
  const closing: RentalBookState = { ...opening.value, recoveryBasisCents: recovery,
    adjustedBuildingBasisCents: settleCents(new Decimal(remaining).minus(depreciationCents)),
    cumulativeDepreciationCents: settleCents(new Decimal(opening.value.cumulativeDepreciationCents).plus(depreciationCents)) };
  const paths = [`${jurisdiction}.rental.${oldAmtMethod ? 'amtPre1999RecoveryPeriodMonths' : 'recoveryPeriodMonths'}`,
    `${jurisdiction}.rental.convention`, `${jurisdiction}.rental.ordinaryMacrsFromDate`,
    ...(amtBook ? [`${jurisdiction}.rental.amtSameRecoveryFromDate`] : [])];
  const used = paths.map(path => rules.provenance[path]).filter((p): p is RuleProvenance => p !== undefined);
  const provenance: RuleProvenance = {
    status: used.some(p => p.status === 'provisional') ? 'provisional'
      : year > rules.baselineYear || used.some(p => p.status === 'projected') ? 'projected' : 'verified',
    ruleVersion: rules.ruleVersion, baselineYear: rules.baselineYear, applicableYear: year,
    sources: [...new Set(used.flatMap(p => p.sources))].sort(),
    assumptions: [...new Set([...used.flatMap(p => p.assumptions),
      ...(year > rules.baselineYear ? ['Future scenario continues the sourced ordinary residential recovery method and declared opening history.'] : [])])].sort(),
  };
  return { status: 'available', value: { rentalId: unit.id, year, book,
    recoveryBasisCents: recovery, openingAdjustedBuildingBasisCents: remaining,
    depreciationCents, monthsRecovered: months.toNumber(), closing, provenance } };
}
