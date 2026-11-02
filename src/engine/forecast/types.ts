import type {Cents,History,ValidatedPlan} from '../model/plan';
import type {ValidatedRetirementCalendar} from '../retirement/calendar';
import type {Available,Issue} from '../model/results';
import type {HouseholdTaxState} from '../model/tax-state';
import type {RsuExactState} from '../equity/rsu';
import type {ProjectionResult} from '../projection-types';
import type {OpeningLoanProvenance} from '../property/loans';
import type {RuleSet} from '../rules/types';
export interface ForecastContext {readonly source:ValidatedPlan;readonly plan:ValidatedPlan;readonly rules:RuleSet;readonly sourceBinding:string;readonly ruleBinding:string}
export interface ForecastRothHistory {readonly openingContributionBasis:History<Cents>;readonly contributionsSinceStartCents:Available<Cents>;readonly conversionLayers:readonly {readonly year:number;readonly taxableCents:Available<Cents>;readonly nontaxableCents:Available<Cents>}[]}
export interface ForecastCheckpoint {
 readonly rothHistoryByAccount:Readonly<Record<string,ForecastRothHistory>>;
 readonly sourceIssues:readonly Issue[];
 readonly schemaVersion:1;readonly year:number;readonly sourceBinding:string;readonly ruleBinding:string;
 readonly accountExact:Readonly<Record<string,Available<string>>>;readonly brokerageBasis:Readonly<Record<string,Available<Cents>>>;
 readonly brokerageBasisHistory:Readonly<Record<string,History<Cents>>>;
 readonly rsuState:Readonly<Record<string,Available<readonly RsuExactState[]>>>;
 readonly propertyExact:Readonly<Record<string,Available<string>>>;readonly existingHomeExact:Readonly<Record<string,Available<string>>>;readonly priorMarketComplete:Readonly<Record<string,boolean>>;
 readonly loanClosing:Readonly<Record<string,Available<Cents>>>;readonly loanOrigin:Readonly<Record<string,{readonly opening:OpeningLoanProvenance;readonly payment:OpeningLoanProvenance}>>;
 readonly taxState:HouseholdTaxState;readonly reserve:Available<Cents>;readonly conditionalOnGap:boolean;readonly lastEarmarked:Available<Cents>;
}
export type ForecastYearPolicy=Readonly<{kind:'working'}>|Readonly<{kind:'retired';year:number;plan:ValidatedPlan;calendar:ValidatedRetirementCalendar;employmentEndDate:string;inheritedIssues:readonly Issue[]}>;
export interface ForecastYearStep {readonly projection:ProjectionResult;readonly closing:ForecastCheckpoint}
export interface ForecastTrace {readonly projection:ProjectionResult;readonly checkpoints:readonly ForecastCheckpoint[]}
export interface PreparedForecastYear {postMonth(month:number):void;finish():ForecastYearStep}
