import type {AccountType,Cents} from '../model/plan';
import type {Available,Coverage,Issue,RuleProvenance} from '../model/results';
import type {ForecastCheckpoint} from '../forecast/types';
import type {ProjectionResult} from '../projection-types';
import type {WithdrawalStrategyId,DistributionYearResult} from './distributions';
import type {PropertyTransitionEvent} from './property-transition';
import type {RetirementFundingResult} from './funding';
import type {RetirementTaxAttribution} from './tax-attribution';
export interface RetirementAllocationProperty {readonly propertyId:string;readonly name:string;readonly use:'personal'|'rental'|'mixed';readonly status:'existing'|'new'|'pending';readonly assetCents:Available<Cents>;readonly debtCents:Available<Cents>;readonly equityCents:Available<Cents>;readonly cashNeededCents:Available<Cents>}
export interface RetirementAllocationAccount {readonly accountId:string;readonly ownerId:string;readonly type:AccountType;readonly assetCents:Available<Cents>;readonly basisCents:Available<Cents>}
export interface RetirementAllocationSnapshot {readonly year:number;readonly properties:readonly RetirementAllocationProperty[];readonly accounts:readonly RetirementAllocationAccount[];readonly stockCents:Available<Cents>;readonly cashCents:Available<Cents>;readonly restrictedCashCents:Available<Cents>;readonly assetCents:Available<Cents>;readonly debtCents:Available<Cents>;readonly netWorthCents:Available<Cents>}
export const retirementYearMoneyFields=['rentalCashCents','plannedWithdrawalCents','otherCashIncomeCents','afterTaxIncomeCents','personalExpensesCents','personalDebtPaymentsCents','surplusCents','cashBalanceCents','stockBalanceCents','propertyValueCents','debtBalanceCents','netWorthCents','requiredWithdrawalCents','mandatoryExcessCents','reinvestedExcessCents','withdrawalShortfallCents','scheduledCapitalCents'] as const;
export type RetirementAmounts=Readonly<Record<typeof retirementYearMoneyFields[number],Available<Cents>>>;
export interface RetirementMonth extends RetirementAmounts {readonly year:number;readonly month:number;readonly taxCents:Available<Cents>}
export interface RetirementYear extends RetirementAmounts {readonly year:number;readonly strategy:WithdrawalStrategyId;readonly funding:RetirementFundingResult;readonly months:readonly RetirementMonth[];readonly tax:RetirementTaxAttribution;readonly distributions:DistributionYearResult;readonly fundingStatus:'funded'|'conditional-on-gap'|'unavailable';readonly openingAllocation:RetirementAllocationSnapshot;readonly coverage:Coverage;readonly provenance:readonly RuleProvenance[];readonly assumptions:readonly string[];readonly issues:readonly Issue[]}
export interface RetirementTransitionReport {readonly year:number;readonly events:readonly PropertyTransitionEvent[];readonly openingAllocation:RetirementAllocationSnapshot;readonly funding:RetirementFundingResult;readonly taxCents:Available<Cents>;readonly buyingCostsCents:Available<Cents>;readonly sellingCostsCents:Available<Cents>;readonly issues:readonly Issue[]}
export interface RetirementYearSettlement {readonly year:RetirementYear;readonly closing:ForecastCheckpoint;readonly projection:ProjectionResult;readonly transition?:RetirementTransitionReport;readonly issues:readonly Issue[]}
