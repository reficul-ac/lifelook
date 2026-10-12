import type { Cents, Filer, History } from '../model/plan';
import type { Available, Issue } from '../model/results';
import type { RentalYearFacts } from '../property/facts';
import type { RentalLossYear } from './rental-losses';
import type { WorkplaceYear } from './workplace';

export interface ContributionRecord {
  readonly ruleId: string;
  readonly accountId: string;
  readonly ownerId: string;
  readonly year: number;
  readonly month: number;
  readonly requestedCents: Cents;
  readonly eligibleCents: Available<Cents>;
  readonly deductibleCents: Available<Cents>;
  readonly nondeductibleCents: Available<Cents>;
  readonly preventedCents: Available<Cents>;
  readonly reasons: readonly Issue[];
}
export interface IncomeAdjustments {
  readonly federalCents: Cents;
  readonly californiaCents: Cents;
  readonly traditionalIraDeductionCents: Cents;
  readonly traditionalMagiAddbacksCents: Cents;
  readonly rothMagiAddbacksCents: Cents;
  readonly passiveMagiAddbacksCents: Cents;
}
export interface PreIraFacts {
  readonly year: number;
  readonly filers: readonly Filer[];
  readonly grossWagesCents: Cents;
  readonly ordinaryTaxableCents: Cents;
  readonly nonTaxableCashCents: Cents;
  readonly niitOtherIncomeCents: Available<Cents>;
  readonly federalIncomeTaxWageReductionCents: Available<Cents>;
  readonly californiaIncomeTaxWageReductionCents: Available<Cents>;
  /** Non-rental AGI before the current IRA resolution, retaining any declared preview deduction. */
  readonly nonRentalFederalAgiCents: Available<Cents>;
  readonly nonRentalCaliforniaAgiCents: Available<Cents>;
  readonly rentalFacts: readonly RentalYearFacts[];
  readonly adjustments: IncomeAdjustments;
  readonly issues: readonly Issue[];
}
export interface IraOwnerYear {
  readonly ownerId: string;
  readonly compensationCents: Available<Cents>;
  readonly ownerLimitCents: Available<Cents>;
  readonly traditionalDeductionLimitCents: Available<Cents>;
  readonly rothContributionLimitCents: Available<Cents>;
  readonly eligibleCents: Available<Cents>;
  readonly federalDeductibleCents: Available<Cents>;
  readonly californiaDeductibleCents: Available<Cents>;
  readonly nondeductibleCents: Available<Cents>;
  readonly newBasisCents: Available<Cents>;
  readonly openingBasis: History<Cents>;
  readonly closingBasis: History<Cents>;
}
export interface IraYear {
  readonly year: number;
  readonly records: readonly ContributionRecord[];
  readonly owners: readonly IraOwnerYear[];
  readonly federalDeductibleCents: Available<Cents>;
  readonly californiaDeductibleCents: Available<Cents>;
  readonly nondeductibleCents: Available<Cents>;
  readonly traditionalMagiCents: Available<Cents>;
  readonly rothMagiCents: Available<Cents>;
  readonly closingIraBasisByOwner: Readonly<Record<string, History<Cents>>>;
  readonly issues: readonly Issue[];
  readonly explanations: readonly string[];
}
export interface ResolvedTaxFacts {
  readonly year: number;
  readonly filers: readonly Filer[];
  readonly federalAgiCents: Available<Cents>;
  readonly californiaAgiCents: Available<Cents>;
  readonly federalAmtIncomeCents: Available<Cents>;
  readonly californiaAmtIncomeCents: Available<Cents>;
  readonly federalRentalCents: Available<Cents>;
  readonly californiaRentalCents: Available<Cents>;
  readonly saltMagiCents: Available<Cents>;
  readonly niitMagiCents: Available<Cents>;
  readonly niitOtherIncomeCents: Available<Cents>;
  readonly traditionalIraMagiCents: Available<Cents>;
  readonly rothIraMagiCents: Available<Cents>;
  readonly passiveAllowanceMagiCents: Available<Cents>;
  readonly rental: RentalLossYear;
  readonly ira: IraYear;
  readonly workplace: WorkplaceYear;
  readonly preIra: PreIraFacts;
  readonly issues: readonly Issue[];
}
