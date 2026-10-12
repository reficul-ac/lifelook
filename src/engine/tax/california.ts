import { Decimal, settleCents } from '../money';
import type { Cents, RentalBookState } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { HouseholdTaxState } from '../model/tax-state';
import { aggregateRuleProvenance } from '../rules/projection';
import type { TaxBracket, YearRules } from '../rules/types';
import type { ResolvedTaxFacts } from './facts';
import type { DeductionChoice } from './itemized';

export interface CaliforniaTaxExplanationStep {
  readonly code: string;
  readonly explanation: string;
  readonly amountCents?: Cents;
}
export interface CaliforniaTaxResult {
  readonly year: number;
  readonly agiCents: Cents;
  readonly taxableIncomeCents: Cents;
  readonly deductionMethod: 'standard' | 'itemized';
  readonly deductionCents: Cents;
  readonly personalExemptionCreditCents: Cents;
  readonly seniorExemptionCreditCents: Cents;
  readonly exemptionCreditsCents: Cents;
  readonly exemptionCreditReductionCents: Cents;
  readonly ordinaryTaxBeforeCreditsCents: Cents;
  readonly ordinaryTaxCents: Cents;
  readonly amtIncomeCents: Cents;
  readonly amtExclusionCents: Cents;
  readonly amtExemptionCents: Cents;
  readonly tentativeMinimumTaxCents: Cents;
  readonly amtCents: Cents;
  readonly surtaxCents: Cents;
  readonly totalCents: Cents;
  readonly provenance: RuleProvenance;
  readonly explanation: readonly CaliforniaTaxExplanationStep[];
  readonly closingState: HouseholdTaxState;
  readonly issues: readonly Issue[];
}

/** Official whole-dollar settlement is separate from monthly cash cent settlement. */
function taxDollars(cents: Decimal | Cents): Cents {
  return settleCents(new Decimal(cents).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(100));
}
function issue(year: number, code: string, field: string, explanation: string,
  resolution: string, recordId?: string): Issue {
  return { code, year, field, severity: 'warning', explanation, resolution,
    ...(recordId ? { recordId } : {}) };
}
function bracketAmount(taxableCents: Decimal, brackets: readonly TaxBracket[]): Decimal {
  let lower = new Decimal(0);
  let tax = new Decimal(0);
  for (const bracket of brackets) {
    const upper = bracket.upperCents === null ? taxableCents : new Decimal(bracket.upperCents);
    const width = Decimal.max(0, Decimal.min(taxableCents, upper).minus(lower));
    tax = tax.plus(width.times(bracket.rateBps).div(10000));
    if (bracket.upperCents === null || taxableCents.lte(upper)) break;
    lower = upper;
  }
  return tax;
}

function ordinaryTax(taxableCents: Cents, rules: YearRules): Cents {
  const table = rules.california.taxTable;
  let income = new Decimal(taxableCents);
  if (income.gt(0) && income.lte(table.maximumCents)) {
    let lower = new Decimal(0);
    let upper = new Decimal(table.firstUpperCents);
    if (income.gt(upper)) {
      const bin = income.minus(table.firstUpperCents).div(table.binWidthCents)
        .toDecimalPlaces(0, Decimal.ROUND_CEIL);
      lower = bin.minus(1).times(table.binWidthCents).plus(table.firstUpperCents);
      upper = Decimal.min(table.maximumCents, lower.plus(table.binWidthCents));
    }
    income = lower.plus(upper).div(2);
  }
  return taxDollars(bracketAmount(income, rules.california.brackets));
}

function dependencies(facts: ResolvedTaxFacts): Available<readonly Cents[]> {
  const values = [facts.californiaAgiCents, facts.federalAgiCents, facts.californiaAmtIncomeCents];
  const missing = values.find(value => value.status !== 'available');
  if (missing) return missing;
  return { status: 'available', value: values.map(value => value.status === 'available' ? value.value : 0) };
}

interface SmallBusinessAmt {
  readonly incomeAdjustmentCents: Cents;
  readonly exclusionCents: Cents;
  readonly deferralAdjustmentCents: Cents;
  readonly closingState: HouseholdTaxState;
  readonly issues: readonly Issue[];
}
function smallBusinessAmt(facts: ResolvedTaxFacts, rules: YearRules): Available<SmallBusinessAmt> {
  const rentalFacts = facts.preIra.rentalFacts;
  if (!rentalFacts.length) return { status: 'available', value: {
    incomeAdjustmentCents: 0, exclusionCents: 0, deferralAdjustmentCents: 0,
    closingState: facts.rental.closing, issues: [],
  } };
  const regular = facts.rental.california;
  const amt = facts.rental.californiaAmt;
  if (regular.status !== 'available') return regular;
  if (amt.status !== 'available') return amt;
  const knownQualified = rentalFacts.filter(rental => {
    const answer = rental.unit.qualifications.californiaSmallBusinessQualification;
    return answer?.known && answer.value;
  });
  const unknown = rentalFacts.filter(rental => !rental.unit.qualifications.californiaSmallBusinessQualification?.known);
  const receipts = settleCents(knownQualified.reduce((sum, rental) => sum.plus(rental.rentCents), new Decimal(0)));
  const maximumReceipts = settleCents(unknown.reduce((sum, rental) => sum.plus(rental.rentCents), new Decimal(receipts)));
  const threshold = rules.california.amt.smallBusinessGrossReceiptsThresholdCents;
  if (!Number.isSafeInteger(threshold) || threshold <= 0) return { status: 'needs-data', issues: [
    issue(facts.year, 'required-california-rule', 'california.amt.smallBusinessGrossReceiptsThresholdCents',
      'The California business-receipts threshold has no supported numeric rule.',
      'Supply the sourced fixed threshold before applying the business income exclusion.'),
  ] };
  const currentRecords = (id: string) => ({ regular: regular.value.rentals.find(rental => rental.rentalId === id),
    amt: amt.value.rentals.find(rental => rental.rentalId === id) });
  const totalDeferral = settleCents(new Decimal(amt.value.allowedRentalCents).minus(regular.value.allowedRentalCents));
  if (receipts >= threshold) return { status: 'available', value: {
    incomeAdjustmentCents: 0, exclusionCents: 0, deferralAdjustmentCents: totalDeferral,
    closingState: facts.rental.closing, issues: [],
  } };
  const knownMaterial = knownQualified.some(rental => {
    const records = currentRecords(rental.rentalId);
    return records.regular?.allowedRentalCents !== 0
      || records.amt?.allowedRentalCents !== records.regular?.allowedRentalCents;
  });
  const missing = unknown.filter(rental => {
    const records = currentRecords(rental.rentalId);
    return records.regular?.allowedRentalCents !== 0
      || records.amt?.allowedRentalCents !== records.regular?.allowedRentalCents
      || maximumReceipts >= threshold && knownMaterial;
  });
  if (missing.length) return { status: 'needs-data', issues: missing.map(rental =>
    issue(facts.year, 'required-california-business-qualification',
      'qualifications.californiaSmallBusinessQualification',
      'California AMT small-business income exclusion depends on a separate trade-or-business qualification and current-year aggregate receipts.',
      'Confirm the California trade-or-business qualification independently of rental QBI eligibility.', rental.rentalId)) };
  let qualifiedRegular = new Decimal(0);
  let qualifiedAmt = new Decimal(0);
  const issues: Issue[] = [];
  const closingRentals = { ...facts.rental.closing.rentals };
  for (const rental of knownQualified) {
    const records = currentRecords(rental.rentalId);
    if (!records.regular || !records.amt) return { status: 'needs-data', issues: [
      issue(facts.year, 'required-california-business-books', 'taxHistory.california-amt',
        'The California business exclusion requires both declared current regular and AMT activity results.',
        'Supply the separate current and opening California rental books.', rental.rentalId),
    ] };
    qualifiedRegular = qualifiedRegular.plus(records.regular.allowedRentalCents);
    qualifiedAmt = qualifiedAmt.plus(records.amt.allowedRentalCents);
    const regState = records.regular.closingState;
    const amtState = records.amt.closingState;
    const vintageEvidence = (state: RentalBookState): string => JSON.stringify(state.lossVintages
      .map(vintage => ({ year: vintage.year, source: vintage.source, amountCents: vintage.amountCents,
        activeParticipation: vintage.activeParticipation ?? { known: false } }))
      .sort((a, b) => a.year - b.year || a.source.localeCompare(b.source) || a.amountCents - b.amountCents));
    if (regState.passiveSuspendedCents !== amtState.passiveSuspendedCents
      || regState.atRiskSuspendedCents !== amtState.atRiskSuspendedCents
      || vintageEvidence(regState) !== vintageEvidence(amtState)) {
      const carriedIssue = issue(facts.year, 'unsupported-california-business-amt-carry',
        'taxHistory.california-amt.lossVintages',
        'The small-business AMT exclusion also changes carryover deductions; the differing loss histories need a source-qualified carryover determination.',
        'Reconcile the California business-excluded AMT loss worksheet before using later affected tax totals.', rental.rentalId);
      issues.push(carriedIssue);
      const carried = closingRentals[rental.rentalId];
      if (carried) closingRentals[rental.rentalId] = { ...carried,
        'california-amt': { status: 'unsupported-case', issues: [carriedIssue] } };
    }
  }
  const exclusionCents = settleCents(Decimal.max(0, qualifiedRegular));
  const qualifiedDifference = qualifiedAmt.minus(qualifiedRegular);
  return { status: 'available', value: {
    incomeAdjustmentCents: settleCents(qualifiedDifference.plus(exclusionCents).negated()),
    exclusionCents, deferralAdjustmentCents: settleCents(new Decimal(totalDeferral).minus(qualifiedDifference)),
    closingState: { ...facts.rental.closing, rentals: closingRentals }, issues,
  } };
}

export function calculateCaliforniaTax(
  facts: ResolvedTaxFacts, deductions: DeductionChoice,
  opening: HouseholdTaxState, rules: YearRules,
): Available<CaliforniaTaxResult> {
  const ready = dependencies(facts);
  if (ready.status !== 'available') return ready;
  const marker = opening.minimumTaxCreditCoverage.california;
  if (!marker.known || marker.value) return { status: marker.known ? 'unsupported-case' : 'needs-data', issues: [
    issue(facts.year, marker.known ? 'unsupported-minimum-tax-credit' : 'required-minimum-tax-credit-history',
      'minimumTaxCreditCoverage.california',
      'California minimum-tax-credit circumstances are outside the modeled credit coverage.',
      'Supply a known absence of prior credit circumstances or add a verified credit calculation before using this liability.'),
  ] };
  const missingAge = facts.filers.filter(filer => !filer.birthDate.known);
  if (missingAge.length) return { status: 'needs-data', issues: missingAge.map(filer =>
    issue(facts.year, 'required-filer-age', 'birthDate',
      'California senior exemption credits require the filer’s age at year end.',
      'Supply the birth date to determine the January 1 birthday convention.', filer.id)) };
  if (deductions.method === 'itemized' && (!deductions.detail
    || deductions.detail.jurisdiction !== 'california')) return { status: 'needs-data', issues: [
    issue(facts.year, 'required-california-itemized-amt-detail', 'deductions.detail',
      'California itemized tax needs its jurisdiction-specific AMT deduction evidence.',
      'Resolve the California itemized candidate, including eligible mortgage interest and tax addbacks.'),
  ] };
  const r = rules.california;
  const paths = [
    ...r.brackets.flatMap((_, index) => [`california.brackets.${index}.upperCents`, `california.brackets.${index}.rateBps`]),
    'california.personalCreditPerFilerCents', 'california.seniorCreditPerFilerCents',
    'california.seniorCreditMinimumAge', 'california.creditPhaseout.startCents',
    'california.creditPhaseout.stepCents', 'california.creditPhaseout.reductionPerExemptionCents',
    'california.amt.exemptionCents', 'california.amt.phaseoutStartCents',
    'california.amt.phaseoutBps', 'california.amt.rateBps',
    'california.surtax.thresholdCents', 'california.surtax.rateBps',
    ...(deductions.method === 'standard' ? ['california.standardDeductionCents'] : []),
  ];
  const [rawAgi = 0, rawFederalAgi = 0, rawAmt = 0] = ready.value;
  const business = smallBusinessAmt(facts, rules);
  if (business.status !== 'available') return business;
  if (facts.preIra.rentalFacts.length) paths.push('california.amt.smallBusinessGrossReceiptsThresholdCents');
  const agiCents = taxDollars(rawAgi);
  const federalAgiCents = taxDollars(rawFederalAgi);
  const deductionCents = taxDollars(deductions.method === 'standard'
    ? deductions.standardCents : deductions.allowedItemizedCents);
  const taxableIncomeCents = settleCents(Decimal.max(0, new Decimal(agiCents).minus(deductionCents)));
  if (taxableIncomeCents <= r.taxTable.maximumCents) paths.push(...[
    'method', 'maximumCents', 'firstUpperCents', 'binWidthCents',
  ].map(field => `california.taxTable.${field}`));
  const missingProvenance = paths.filter(path => !rules.provenance[path]);
  const constants = [r.personalCreditPerFilerCents, r.seniorCreditPerFilerCents,
    r.seniorCreditMinimumAge, r.creditPhaseout.startCents, r.creditPhaseout.stepCents,
    r.creditPhaseout.reductionPerExemptionCents, r.amt.exemptionCents,
    r.amt.phaseoutStartCents, r.amt.phaseoutBps, r.amt.rateBps,
    r.surtax.thresholdCents, r.surtax.rateBps, r.taxTable.maximumCents,
    r.taxTable.firstUpperCents, r.taxTable.binWidthCents];
  if (missingProvenance.length || constants.some(value => !Number.isFinite(value))) {
    return { status: 'needs-data', issues: [issue(facts.year, 'required-california-rule',
      missingProvenance[0] ?? 'california',
      'A used California rule has no numeric amount and sourced provenance or explicit provisional assumption.',
      'Resolve the missing rule field before presenting a California tax amount.')] };
  }
  if (r.taxTable.method !== 'california-hundred-dollar-midpoint') return { status: 'unsupported-case', issues: [
    issue(facts.year, 'unsupported-california-tax-table-method', 'california.taxTable.method',
      'This California tax-table method is unsupported.',
      'Use the sourced applicable-year table or the named provisional table-method assumption.'),
  ] };
  const ordinaryTaxBeforeCreditsCents = ordinaryTax(taxableIncomeCents, rules);
  const ageCutoff = `${String(facts.year - r.seniorCreditMinimumAge + 1).padStart(4, '0')}-01-01`;
  const seniors = facts.filers.filter(filer => filer.birthDate.known && filer.birthDate.value <= ageCutoff).length;
  const phaseoutSteps = Decimal.max(0, new Decimal(federalAgiCents).minus(r.creditPhaseout.startCents))
    .div(r.creditPhaseout.stepCents).toDecimalPlaces(0, Decimal.ROUND_CEIL);
  const perExemptionReduction = phaseoutSteps.times(r.creditPhaseout.reductionPerExemptionCents);
  const personalExemptionCreditCents = settleCents(Decimal.max(0,
    new Decimal(r.personalCreditPerFilerCents).minus(perExemptionReduction)).times(facts.filers.length));
  const seniorExemptionCreditCents = settleCents(Decimal.max(0,
    new Decimal(r.seniorCreditPerFilerCents).minus(perExemptionReduction)).times(seniors));
  const exemptionCreditsCents = settleCents(new Decimal(personalExemptionCreditCents).plus(seniorExemptionCreditCents));
  const exemptionCreditReductionCents = settleCents(new Decimal(r.personalCreditPerFilerCents)
    .times(facts.filers.length).plus(new Decimal(r.seniorCreditPerFilerCents).times(seniors)).minus(exemptionCreditsCents));
  const ordinaryTaxCents = settleCents(Decimal.max(0,
    new Decimal(ordinaryTaxBeforeCreditsCents).minus(exemptionCreditsCents)));
  // Schedule P restores the standard deduction or disallowed itemized costs;
  // only full qualified acquisition mortgage interest remains deductible here.
  const amtIncomeCents = taxDollars(new Decimal(rawAmt).plus(business.value.incomeAdjustmentCents)
    .minus(deductions.method === 'itemized' ? deductions.detail!.amtAllowedCents : 0));
  const amtExclusionCents = taxDollars(business.value.exclusionCents);
  const exemptionReduction = taxDollars(Decimal.max(0,
    new Decimal(amtIncomeCents).minus(r.amt.phaseoutStartCents)).times(r.amt.phaseoutBps).div(10000));
  const amtExemptionCents = settleCents(Decimal.max(0, new Decimal(r.amt.exemptionCents).minus(exemptionReduction)));
  const tentativeMinimumTaxCents = taxDollars(Decimal.max(0,
    new Decimal(amtIncomeCents).minus(amtExemptionCents)).times(r.amt.rateBps).div(10000));
  const amtCents = settleCents(Decimal.max(0,
    new Decimal(tentativeMinimumTaxCents).minus(ordinaryTaxBeforeCreditsCents)));
  const surtaxCents = taxDollars(Decimal.max(0,
    new Decimal(taxableIncomeCents).minus(r.surtax.thresholdCents)).times(r.surtax.rateBps).div(10000));
  const totalCents = settleCents(new Decimal(ordinaryTaxCents).plus(amtCents).plus(surtaxCents));
  const provenance = aggregateRuleProvenance(rules, paths);
  const detailProvenance = deductions.method === 'itemized' ? deductions.detail!.provenance : undefined;
  const combinedProvenance: RuleProvenance = detailProvenance ? { ...provenance,
    status: provenance.status === 'provisional' || detailProvenance.status === 'provisional' ? 'provisional'
      : provenance.status === 'projected' || detailProvenance.status === 'projected' ? 'projected' : 'verified',
    sources: [...new Set([...provenance.sources, ...detailProvenance.sources])],
    assumptions: [...new Set([...provenance.assumptions, ...detailProvenance.assumptions])],
  } : provenance;
  const closingState: HouseholdTaxState = { ...business.value.closingState, year: facts.year,
    minimumTaxCreditCoverage: { ...business.value.closingState.minimumTaxCreditCoverage,
      california: { known: true, value: amtCents > 0 && business.value.deferralAdjustmentCents > 0 } } };
  return { status: 'available', value: { year: facts.year, agiCents, taxableIncomeCents,
    deductionMethod: deductions.method, deductionCents, personalExemptionCreditCents,
    seniorExemptionCreditCents, exemptionCreditsCents, exemptionCreditReductionCents,
    ordinaryTaxBeforeCreditsCents, ordinaryTaxCents, amtIncomeCents, amtExclusionCents,
    amtExemptionCents, tentativeMinimumTaxCents, amtCents, surtaxCents, totalCents,
    provenance: combinedProvenance,
    explanation: [
      { code: 'california-agi', explanation: 'Use independent California rental and IRA adjustments; federal QBI and senior deductions do not reduce California AGI.', amountCents: agiCents },
      { code: 'california-deduction', explanation: `Apply the selected California ${deductions.method} deduction independently.`, amountCents: deductionCents },
      { code: 'california-ordinary-tax', explanation: 'Use whole-dollar California table bins through the inclusive threshold, then the sourced rate schedule.', amountCents: ordinaryTaxBeforeCreditsCents },
      { code: 'california-exemption-credits', explanation: 'Personal and age-related exemption credits phase out using federal AGI and commenced worksheet steps.', amountCents: exemptionCreditsCents },
      { code: 'california-amt', explanation: 'Apply the separate California AMT book and allowable deduction; compare tentative tax with regular tax before exemption credits.', amountCents: amtCents },
      { code: 'california-small-business-amt-exclusion', explanation: 'Exclude established positive rental business income and its preferences only when current-year aggregate business receipts are strictly below the fixed threshold; wages remain in AMTI.', amountCents: amtExclusionCents },
      { code: 'california-surtax', explanation: 'Apply the separate California high-income surtax to whole-dollar taxable income.', amountCents: surtaxCents },
    ], closingState, issues: business.value.issues } };
}
