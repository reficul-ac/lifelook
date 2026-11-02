import { Decimal, settleCents } from '../money';
import type { Cents, History, QbiLossVintage, RentalBookState, TaxBook, ValidatedPlan } from './plan';
import type { Available } from './results';

export interface AduCapitalBookState {
  readonly capitalizedBuildingCents:Cents;
  readonly nondepreciableBasisCents:Cents;
  readonly recoveryActivated:boolean;
}
export interface RetirementIraBasis {readonly estimatedFederalCents?:Cents;readonly estimatedCaliforniaCents?:Cents;readonly federal:History<Cents>;readonly california:History<Cents>;readonly californiaPre1987Basis?:History<Cents>}
export interface RetirementRothHistory {readonly estimatedContributionBasisCents?:Cents;readonly firstKnownContributionYear?:number;readonly contributionBasis:History<Cents>;readonly firstContributionYear:History<number>;readonly conversionLayers:readonly {readonly year:number;readonly taxableCents:Cents;readonly nontaxableCents:Cents;readonly californiaTaxableCents?:Cents}[]}
export interface HouseholdTaxState {
  readonly retirementSection1231?:Readonly<Partial<Record<TaxBook,{readonly asOfYear:number;readonly lossVintages:readonly {readonly year:number;readonly amountCents:Cents}[];readonly undatedPriorLossCents:Cents}>>>;
  readonly retirementAccountState?:{readonly iraBasisByOwner:Readonly<Record<string,RetirementIraBasis>>;readonly rothByAccount:Readonly<Record<string,RetirementRothHistory>>};
  readonly retirementPropertyHistory?:{readonly gainBuildingBasisByRental:Readonly<Record<string,Readonly<Record<TaxBook,Available<Cents>>>>>;readonly disposedPropertyIds:readonly string[];readonly releasedActivitiesByBook?:Readonly<Partial<Record<TaxBook,readonly string[]>>>};
  readonly aduProjects?:Readonly<Record<string,Readonly<Record<TaxBook,Available<AduCapitalBookState>>>>>;
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
  const estimated=Object.fromEntries(plan.household.filers.flatMap(filer=>{
    if(iraBasisByOwner[filer.id]?.known)return [];
    const subtotal=settleCents(plan.accounts.filter(a=>a.ownerId===filer.id&&a.type==='traditional-ira').reduce((n,a)=>n.plus(a.openingIraBasis.known?a.openingIraBasis.value:0),new Decimal(0)));
    return subtotal>0?[[filer.id,{federal:{known:false as const},california:{known:false as const},estimatedFederalCents:subtotal,estimatedCaliforniaCents:subtotal}]]:[];
  }));
  return {
    year: plan.startYear - 1, rentals, qbiLossVintages, iraBasisByOwner,
    ...(Object.keys(estimated).length?{retirementAccountState:{iraBasisByOwner:estimated,rothByAccount:{}}}:{}),
    ...(plan.properties.some(p=>p.aduProject)?{aduProjects:Object.fromEntries(plan.properties.flatMap(p=>p.aduProject?[[p.aduProject.id,Object.fromEntries(books.map(book=>[book,{status:'available' as const,value:{capitalizedBuildingCents:0,nondepreciableBasisCents:0,recoveryActivated:false}}]))]]:[])) as NonNullable<HouseholdTaxState['aduProjects']>}:{}),
    minimumTaxCreditCoverage: { federal: plan.household.coverageAnswers.priorFederalMinimumTaxCredits, california: plan.household.coverageAnswers.priorCaliforniaMinimumTaxCredits },
  };
}
