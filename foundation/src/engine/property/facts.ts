import type { CashYear } from '../cash/income';
import { Decimal, settleCents } from '../money';
import type { Cents, Expense, History, Property, PropertyLoan, RentalBookState, RentalUnit, TaxBook, ValidatedPlan } from '../model/plan';
import type { HouseholdTaxState } from '../model/tax-state';
import type { Available, Issue } from '../model/results';
import type { YearRules } from '../rules/types';
import type { ExpenseAllocation } from './allocation';
import { allocateExpense, allocateShares, sharedRentalShares } from './allocation';
import type { DepreciationYear } from './depreciation';
import { calculateDepreciation } from './depreciation';
import type { LoanSchedule, MortgageQualificationEvidence } from './loans';

export interface ExpenseAllocationRecord extends ExpenseAllocation {
  readonly expenseId: string;
  readonly propertyId: string;
  readonly taxCategory: Expense['taxCategory'];
  readonly paidCents: Cents;
  readonly mortgageInsuranceQualification?: History<boolean>;
}
export interface RentalTaxBookFacts {
  readonly rentalId: string;
  readonly book: TaxBook;
  readonly rentCents: Cents;
  readonly operatingExpenseCents: Cents;
  readonly eligibleInterestCents: Cents;
  readonly depreciationCents: Cents;
  readonly taxableProfitCents: Cents;
  readonly openingState: RentalBookState;
  readonly closingState: RentalBookState;
}
export interface RentalYearFacts {
  readonly rentalId: string;
  readonly propertyId: string;
  readonly unit: RentalUnit;
  readonly financingAtRiskQualification: History<boolean>;
  readonly rentCents: Cents;
  readonly operatingExpenseCents: Cents;
  readonly capitalExpenseCents: Cents;
  readonly debtPaymentCents: Cents;
  readonly cashInterestCents: Cents;
  readonly principalPaidCents: Cents;
  readonly cashFlowCents: Cents;
  readonly eligibleInterestCents: Available<Cents>;
  readonly depreciation: Readonly<Record<TaxBook, Available<DepreciationYear>>>;
  readonly books: Readonly<Record<TaxBook, Available<RentalTaxBookFacts>>>;
}
export interface PersonalLoanFacts {
  readonly loanId: string;
  readonly propertyId: string;
  readonly cashInterestCents: Cents;
  readonly personalInterestCents: Available<Cents>;
  readonly qualification?: MortgageQualificationEvidence;
}
export interface PersonalDeductionFacts {
  readonly propertyTaxPaidCents: Cents;
  readonly homeownersInsuranceCents: Cents;
  readonly mortgageInsuranceCents: Cents;
  readonly mortgageInterestCents: Available<Cents>;
  readonly loans: readonly PersonalLoanFacts[];
}
export interface PropertyYearFacts {
  readonly year: number;
  readonly expenses: readonly ExpenseAllocationRecord[];
  readonly rentals: readonly RentalYearFacts[];
  readonly personal: PersonalDeductionFacts;
  readonly cash: Readonly<{ rentCents: Cents; operatingExpenseCents: Cents;
    capitalExpenseCents: Cents; debtPaymentCents: Cents; interestCents: Cents;
    principalPaidCents: Cents }>;
  readonly closingRentalState: Readonly<Record<string, Readonly<Record<TaxBook, Available<RentalBookState>>>>>;
  readonly issues: readonly Issue[];
}

const books: readonly TaxBook[] = ['federal', 'california', 'federal-amt', 'california-amt'];
const sum = (values: readonly Cents[]): Cents => settleCents(values.reduce((total, value) => total.plus(value), new Decimal(0)));
const available = <T>(value: T): Available<T> => ({ status: 'available', value });
function sumAvailable(values: readonly Available<Cents>[]): Available<Cents> {
  const unavailable = values.filter(value => value.status !== 'available');
  if (unavailable.length) return { status: unavailable.some(value => value.status === 'unsupported-case')
    ? 'unsupported-case' : 'needs-data', issues: unavailable.flatMap(value => value.issues) };
  return available(sum(values.map(value => value.status === 'available' ? value.value : 0)));
}

function loanShares(loan: PropertyLoan | undefined, property: Property,
  units: readonly RentalUnit[]): Readonly<Record<string, Decimal>> {
  const defaults = sharedRentalShares(property, units);
  return Object.fromEntries([...units].sort((a, b) => a.id.localeCompare(b.id)).map(unit => {
    const explicit = loan && unit.loanAllocations.find(allocation => allocation.loanId === loan.id);
    if (explicit) return [unit.id, new Decimal(explicit.share.numerator).div(explicit.share.denominator)];
    const proceeds = loan?.proceedsAllocations.filter(allocation => allocation.use === 'rental'
      && allocation.rentalId === unit.id) ?? [];
    if (proceeds.length) return [unit.id, proceeds.reduce((total, allocation) => total.plus(
      new Decimal(allocation.share.numerator).div(allocation.share.denominator)), new Decimal(0))];
    // An explicit personal-only proceeds allocation is distinct from a missing trace.
    if (loan?.proceedsAllocations.length) return [unit.id, new Decimal(0)];
    return [unit.id, defaults[unit.id] ?? new Decimal(0)];
  }));
}

function eligibleLoanInterest(loan: PropertyLoan | undefined, unit: RentalUnit,
  allocatedPaidInterestCents: Cents, year: number): Available<Cents> {
  if (allocatedPaidInterestCents === 0) return available(0);
  const explicit = loan && unit.loanAllocations.find(allocation => allocation.loanId === loan.id);
  const traced = loan?.proceedsAllocations.some(allocation => allocation.use === 'rental'
    && allocation.rentalId === unit.id);
  const history = loan?.proceedsQualification.historyComplete;
  const unsupported = explicit?.qualification.known && !explicit.qualification.value
    || history?.known && !history.value;
  const missing = !loan || !history?.known || (!explicit && !traced)
    || explicit && !explicit.qualification.known || loan.proceedsQualification.kind === 'unknown';
  if (unsupported || missing) return { status: unsupported ? 'unsupported-case' : 'needs-data', issues: [{
    code: unsupported ? 'unsupported-rental-interest-history' : 'required-rental-interest-history',
    recordId: unit.id, year, field: 'loanAllocations', severity: 'warning',
    explanation: 'Rental interest requires a qualified, complete loan-proceeds allocation; floor area alone does not establish it.',
    resolution: 'Supply the loan proceeds/collateral history and explicitly confirm the rental interest allocation.',
  }] };
  return available(allocatedPaidInterestCents);
}

function unavailableIssue<T>(status: 'needs-data' | 'unsupported-case', issue: Issue): Available<T> {
  return { status, issues: [issue] };
}

export function buildPropertyFacts(
  plan: ValidatedPlan, cash: CashYear, loans: readonly LoanSchedule[],
  opening: HouseholdTaxState, rules: YearRules,
): PropertyYearFacts {
  const year = cash.year;
  const properties = new Map(plan.properties.map(property => [property.id, property]));
  const units = [...plan.rentals].sort((a, b) => a.id.localeCompare(b.id));
  const unitsById = new Map(units.map(unit => [unit.id, unit]));
  const streamById = new Map(cash.streams.map(stream => [stream.id, stream]));
  const expenses: ExpenseAllocationRecord[] = [];
  for (const expense of [...plan.expenses].sort((a, b) => a.id.localeCompare(b.id))) {
    const propertyId = expense.propertyId ?? (expense.rentalId ? unitsById.get(expense.rentalId)?.propertyId : undefined);
    if (!propertyId) continue;
    const property = properties.get(propertyId);
    if (!property) continue; // Validated plans cannot have dangling references.
    const paidCents = streamById.get(expense.id)?.annualCents ?? 0;
    const allocation = allocateExpense(expense, property, units, paidCents);
    expenses.push({ expenseId: expense.id, propertyId, taxCategory: expense.taxCategory,
      paidCents, ...allocation, ...(expense.mortgageInsuranceQualification?{mortgageInsuranceQualification:expense.mortgageInsuranceQualification}:{}) });
  }
  const personalExpenses = expenses.filter(expense => properties.get(expense.propertyId)?.role !== 'rental');
  const personalCategory = (category: Expense['taxCategory']): Cents => sum(personalExpenses
    .filter(expense => expense.taxCategory === category).map(expense => expense.personalCents));

  const rentalPayments: Record<string, Cents[]> = {};
  const rentalInterest: Record<string, Cents[]> = {};
  const rentalEligibleInterest: Record<string, Available<Cents>[]> = {};
  const rentalFinancing: Record<string, History<boolean>[]> = {};
  units.forEach(unit => { rentalPayments[unit.id] = []; rentalInterest[unit.id] = [];
    rentalEligibleInterest[unit.id] = []; rentalFinancing[unit.id]=[]; });
  const personalLoans: PersonalLoanFacts[] = [];
  const totalDebtPayments: Cents[] = [];
  const totalInterest: Cents[] = [];
  const totalPrincipal: Cents[] = [];
  for (const schedule of [...loans].sort((a, b) => a.loanId.localeCompare(b.loanId))) {
    const property = plan.properties.find(property => property.loans.some(loan => loan.id === schedule.loanId));
    const declared = property?.loans.find(loan => loan.id === schedule.loanId);
    const linkedDebt = !declared && plan.debts.find(debt => debt.id === schedule.loanId);
    const ownerProperty = property ?? (linkedDebt && linkedDebt.propertyId ? properties.get(linkedDebt.propertyId) : undefined);
    if (!ownerProperty) continue;
    const months = schedule.months.filter(month => Number(month.date.slice(0, 4)) === year);
    const paymentCents = sum(months.map(month => month.paymentCents));
    const interestCents = sum(months.map(month => month.interestCents));
    const paidInterestCents = sum(months.map(month => Math.min(month.paymentCents, month.interestCents)));
    const principalCents = sum(months.map(month => month.principalPaidCents));
    totalDebtPayments.push(paymentCents); totalInterest.push(interestCents); totalPrincipal.push(principalCents);
    const shares = loanShares(declared, ownerProperty, units);
    const payment = allocateShares(paymentCents, shares);
    const interest = allocateShares(interestCents, shares);
    const paidInterest = allocateShares(paidInterestCents, shares);
    const eligibility: Available<Cents>[] = [];
    for (const unit of units) {
      if(shares[unit.id]?.gt(0))rentalFinancing[unit.id]!.push(declared?.financingAtRiskQualification??{known:false});
      rentalPayments[unit.id]!.push(payment.rentalCentsByUnit[unit.id] ?? 0);
      rentalInterest[unit.id]!.push(interest.rentalCentsByUnit[unit.id] ?? 0);
      const eligible = eligibleLoanInterest(declared, unit, paidInterest.rentalCentsByUnit[unit.id] ?? 0, year);
      rentalEligibleInterest[unit.id]!.push(eligible); eligibility.push(eligible);
    }
    if (ownerProperty.role !== 'rental') {
      const unresolved = eligibility.filter(value => value.status !== 'available');
      const personalInterestCents: Available<Cents> = unresolved.length
        ? { status: unresolved.some(value => value.status === 'unsupported-case') ? 'unsupported-case' : 'needs-data',
          issues: unresolved.flatMap(value => value.issues) }
        : available(paidInterest.personalCents);
      personalLoans.push({ loanId: schedule.loanId, propertyId: ownerProperty.id,
        cashInterestCents: interest.personalCents, personalInterestCents,
        ...(schedule.qualification ? { qualification: schedule.qualification } : {}) });
    }
  }

  const rentals: RentalYearFacts[] = [];
  const closingRentalState: Record<string, Readonly<Record<TaxBook, Available<RentalBookState>>>> = {};
  const issues: Issue[] = [];
  for (const unit of units) {
    const allocations = expenses.filter(expense => (expense.rentalCentsByUnit[unit.id] ?? 0) !== 0);
    const operatingExpenseCents = sum(allocations.filter(expense => expense.taxCategory !== 'capital'
      && expense.taxCategory !== 'personal').map(expense => expense.rentalCentsByUnit[unit.id]!));
    const nonDeductibleCashCents = sum(allocations.filter(expense => expense.taxCategory === 'personal')
      .map(expense => expense.rentalCentsByUnit[unit.id]!));
    const capitalExpenseCents = sum(allocations.filter(expense => expense.taxCategory === 'capital')
      .map(expense => expense.rentalCentsByUnit[unit.id]!));
    const rentCents = streamById.get(unit.id)?.annualCents ?? 0;
    const debtPaymentCents = sum(rentalPayments[unit.id]!);
    const cashInterestCents = sum(rentalInterest[unit.id]!);
    const principalPaidCents = settleCents(new Decimal(debtPaymentCents).minus(cashInterestCents));
    const eligibleInterestCents = sumAvailable(rentalEligibleInterest[unit.id]!);
    const depreciation: Partial<Record<TaxBook, Available<DepreciationYear>>> = {};
    const rentalBooks: Partial<Record<TaxBook, Available<RentalTaxBookFacts>>> = {};
    const closingBooks: Partial<Record<TaxBook, Available<RentalBookState>>> = {};
    const capitalIssue: Issue = { code: 'unsupported-capital-basis-schedule', recordId: unit.id,
      year, field: 'expenses.taxCategory', severity: 'warning',
      explanation: 'Capital rental spending changes basis and needs an additional recovery schedule.',
      resolution: 'Supply a supported capital-improvement schedule before using current or later tax totals.' };
    for (const book of books) {
      const missingState: Available<RentalBookState> = { status: 'needs-data', issues: [{
        code: 'required-history', recordId: unit.id, year, field: `taxHistory.${book}`, severity: 'warning',
        explanation: `The opening ${book} rental book is unknown.`,
        resolution: 'Supply the opening basis, depreciation, at-risk and suspended-loss history, including confirmed zeros.',
      }] };
      const bookOpening = opening.rentals[unit.id]?.[book] ?? missingState;
      const d = capitalExpenseCents > 0
        ? unavailableIssue<DepreciationYear>('unsupported-case', capitalIssue)
        : calculateDepreciation(unit, year, book, bookOpening, rules);
      depreciation[book] = d;
      if (d.status !== 'available') {
        rentalBooks[book] = d; closingBooks[book] = d; issues.push(...d.issues);
      } else if (eligibleInterestCents.status !== 'available') {
        rentalBooks[book] = eligibleInterestCents;
        // The physical depreciation state is known, but a dependent tax book
        // stays unavailable until its unresolved financing history is supplied.
        closingBooks[book] = eligibleInterestCents; issues.push(...eligibleInterestCents.issues);
      } else if (bookOpening.status === 'available') {
        rentalBooks[book] = available({ rentalId: unit.id, book, rentCents,
          operatingExpenseCents, eligibleInterestCents: eligibleInterestCents.value,
          depreciationCents: d.value.depreciationCents,
          taxableProfitCents: settleCents(new Decimal(rentCents).minus(operatingExpenseCents)
            .minus(eligibleInterestCents.value).minus(d.value.depreciationCents)),
          openingState: bookOpening.value, closingState: d.value.closing });
        closingBooks[book] = available(d.value.closing);
      }
    }
    closingRentalState[unit.id] = closingBooks as Record<TaxBook, Available<RentalBookState>>;
    const financing = rentalFinancing[unit.id]!;
    const financingAtRiskQualification:History<boolean> = financing.some(h=>h.known&&!h.value)?{known:true,value:false}:financing.some(h=>!h.known)?{known:false}:{known:true,value:true};
    rentals.push({ rentalId: unit.id, propertyId: unit.propertyId, unit, rentCents,
      financingAtRiskQualification,
      operatingExpenseCents, capitalExpenseCents, debtPaymentCents, cashInterestCents,
      principalPaidCents, cashFlowCents: settleCents(new Decimal(rentCents)
        .minus(operatingExpenseCents).minus(nonDeductibleCashCents).minus(capitalExpenseCents).minus(debtPaymentCents)),
      eligibleInterestCents, depreciation: depreciation as Record<TaxBook, Available<DepreciationYear>>,
      books: rentalBooks as Record<TaxBook, Available<RentalTaxBookFacts>> });
  }
  const uniqueIssues = [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()];
  return { year, expenses, rentals,
    personal: { propertyTaxPaidCents: personalCategory('property-tax'),
      homeownersInsuranceCents: personalCategory('homeowners-insurance'),
      mortgageInsuranceCents: personalCategory('mortgage-insurance'),
      mortgageInterestCents: sumAvailable(personalLoans.map(loan => loan.personalInterestCents)), loans: personalLoans },
    cash: { rentCents: sum(rentals.map(rental => rental.rentCents)),
      operatingExpenseCents: sum(expenses.filter(expense => expense.taxCategory !== 'capital').map(expense => expense.paidCents)),
      capitalExpenseCents: sum(expenses.filter(expense => expense.taxCategory === 'capital').map(expense => expense.paidCents)),
      debtPaymentCents: sum(totalDebtPayments), interestCents: sum(totalInterest), principalPaidCents: sum(totalPrincipal) },
    closingRentalState, issues: uniqueIssues };
}
