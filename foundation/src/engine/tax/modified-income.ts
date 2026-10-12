import type { CashYear } from '../cash/income';
import type { Cents } from '../model/plan';
import type { Available, Issue } from '../model/results';
import { Decimal, settleCents } from '../money';
import type { PropertyYearFacts } from '../property/facts';
import type { YearRules } from '../rules/types';
import type { PreIraFacts } from './facts';
import type { WorkplaceYear } from './workplace';

export const sumCents = (values: readonly Cents[]): Cents => settleCents(values.reduce((sum, value) => sum.plus(value), new Decimal(0)));
export function mapAvailableCents(value: Available<Cents>, transform: (value: Cents) => Cents): Available<Cents> { return value.status === 'available' ? { status: 'available', value: transform(value.value) } : value; }
export function combineAvailableCents(values: readonly Available<Cents>[], transform: (values: readonly Cents[]) => Cents = sumCents): Available<Cents> {
  const missing = values.filter(v => v.status !== 'available');
  return missing.length ? { status: missing.some(v => v.status === 'unsupported-case') ? 'unsupported-case' : 'needs-data', issues: missing.flatMap(v => v.issues) } : { status: 'available', value: transform(values.map(v => v.status === 'available' ? v.value : 0)) };
}
export function buildPreIraFacts(cash: CashYear, workplace: WorkplaceYear, property: PropertyYearFacts): PreIraFacts {
  const issues: Issue[] = [...workplace.issues, ...property.issues];
  const uncharacterized = cash.streams.filter(stream => stream.classification === 'ordinary-taxable' && (!stream.niitTreatment || stream.niitTreatment === 'unknown'));
  const niitIssues: Issue[] = uncharacterized.map(stream => ({ code: 'required-niit-characterization', recordId: stream.id, year: cash.year, field: 'niitTreatment', severity: 'warning', explanation: 'This ordinary taxable income has unresolved net-investment-income treatment.', resolution: 'Confirm whether this income is included in or excluded from NIIT.' }));
  const niitOtherIncomeCents: Available<Cents> = niitIssues.length ? { status: 'needs-data', issues: niitIssues } : { status: 'available', value: sumCents(cash.streams.filter(stream => stream.classification === 'ordinary-taxable' && stream.niitTreatment === 'included').map(stream => stream.annualCents)) };
  const gross = sumCents([cash.annual.wageCents, cash.annual.ordinaryTaxableCents]);
  return {
    year: cash.year, filers: workplace.filers, grossWagesCents: cash.annual.wageCents, ordinaryTaxableCents: cash.annual.ordinaryTaxableCents, nonTaxableCashCents: cash.annual.nonTaxableCents,
    niitOtherIncomeCents, federalIncomeTaxWageReductionCents: workplace.federalIncomeTaxWageReductionCents, californiaIncomeTaxWageReductionCents: workplace.californiaIncomeTaxWageReductionCents,
    nonRentalFederalAgiCents: mapAvailableCents(workplace.federalIncomeTaxWageReductionCents, reduction => sumCents([gross, -reduction])),
    nonRentalCaliforniaAgiCents: mapAvailableCents(workplace.californiaIncomeTaxWageReductionCents, reduction => sumCents([gross, -reduction])),
    rentalFacts: property.rentals,
    adjustments: { federalCents: 0, californiaCents: 0, traditionalIraDeductionCents: 0, traditionalMagiAddbacksCents: 0, rothMagiAddbacksCents: 0, passiveMagiAddbacksCents: 0 },
    issues: [...issues, ...niitIssues],
  };
}
/** Form8582 and FTB3801 line6 exclude passive income/loss and restore IRA deductions. */
export function passiveAllowanceMagi(facts: PreIraFacts, _rules: YearRules): Available<Cents> {
  return mapAvailableCents(facts.nonRentalFederalAgiCents, value => sumCents([value, facts.adjustments.traditionalIraDeductionCents, facts.adjustments.passiveMagiAddbacksCents]));
}
