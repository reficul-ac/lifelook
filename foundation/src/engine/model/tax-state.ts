import { Decimal, settleCents } from '../money';
import type { Cents, History, QbiLossVintage, RentalBookState, TaxBook, ValidatedPlan } from './plan';
import type { Available } from './results';

export interface HouseholdTaxState {
  readonly year: number;
  readonly rentals: Readonly<Record<string, Readonly<Record<TaxBook, Available<RentalBookState>>>>>;
  readonly qbiLossVintages: Readonly<Record<string, History<readonly QbiLossVintage[]>>>;
  readonly iraBasisByOwner: Readonly<Record<string, History<Cents>>>;
  readonly minimumTaxCreditCoverage: Readonly<{ federal: History<boolean>; california: History<boolean> }>;
}
const books: readonly TaxBook[] = ['federal', 'california', 'federal-amt', 'california-amt'];

/** Reads declared opening books only; unknown history never becomes known zero. */
export function initialTaxState(plan: ValidatedPlan): HouseholdTaxState {
  const rentals: Record<string, Readonly<Record<TaxBook, Available<RentalBookState>>>> = Object.create(null);
  const qbiLossVintages: Record<string, History<readonly QbiLossVintage[]>> = Object.create(null);
  plan.rentals.forEach(rental => {
    const carried = Object.fromEntries(books.map(book => {
      const history = rental.taxHistory[book];
      const result: Available<RentalBookState> = history.known ? { status: 'available', value: history.value } : {
        status: 'needs-data', issues: [{ code: 'required-history', recordId: rental.id, year: plan.startYear, field: `taxHistory.${book}`, severity: 'warning', explanation: `The opening ${book} rental book is unknown.`, resolution: 'Supply the opening basis, depreciation, at-risk and suspended-loss history, including confirmed zeros.' }],
      };
      return [book, result];
    })) as Record<TaxBook, Available<RentalBookState>>;
    rentals[rental.id] = carried;
    qbiLossVintages[rental.id] = rental.qbi.openingLossVintages;
  });
  const iraBasisByOwner = Object.fromEntries(plan.household.filers.map(filer => {
    const histories = plan.accounts.filter(account => account.ownerId === filer.id && account.type === 'traditional-ira').map(account => account.openingIraBasis);
    const history: History<Cents> = histories.some(h => !h.known) ? { known: false } : { known: true, value: settleCents(histories.reduce((sum, h) => sum.plus(h.known ? h.value : 0), new Decimal(0))) };
    return [filer.id, history];
  }));
  return {
    year: plan.startYear - 1, rentals, qbiLossVintages, iraBasisByOwner,
    minimumTaxCreditCoverage: { federal: plan.household.coverageAnswers.priorFederalMinimumTaxCredits, california: plan.household.coverageAnswers.priorCaliforniaMinimumTaxCredits },
  };
}
