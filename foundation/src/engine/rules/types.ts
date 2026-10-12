import type { RuleProvenance } from '../model/results.js';

export type RuleScalar = number | string | boolean | null;
export interface RuleSource {
  readonly id: string;
  readonly url: string;
  readonly snapshot: string;
  readonly publicationDate: string | null;
  readonly publicationYear: number;
}
export interface IndexingPolicy {
  readonly kind: 'fixed' | 'indexed' | 'administered' | 'statutory-growth';
  readonly incrementCents?: number;
  readonly rounding?: 'floor' | 'nearest';
  readonly growthBps?: number;
  readonly startsAfterYear?: number;
  /** Some retirement rules round the inflation increase, preserving the original base. */
  readonly roundIncreaseOnly?: boolean;
  readonly anchorPath?: string;
  readonly fixedOffsetCents?: number;
}
export interface RuleTransition<T> {
  readonly effectiveYear: number;
  readonly value: T;
  readonly indexing?: IndexingPolicy;
  readonly sources: readonly RuleSource[];
}
export interface RuleValue<T> {
  /** Omission means unresolved; never silently convert an absent constant to zero. */
  readonly value?: T;
  readonly publicationYear: number;
  readonly applicableYear: number;
  readonly effectiveFrom: string;
  readonly effectiveThrough?: string;
  readonly reviewDate: string;
  readonly status: 'verified' | 'provisional';
  readonly sources: readonly RuleSource[];
  readonly assumptions: readonly string[];
  readonly indexing: IndexingPolicy;
  readonly transitions: readonly RuleTransition<T>[];
}
export interface RulePack {
  readonly version: string;
  readonly jurisdiction: 'federal' | 'california' | 'payroll' | 'retirement';
  readonly baselineYear: 2026;
  /** Paths are relative to their jurisdiction, with arrays represented by numeric segments. */
  readonly values: Readonly<Record<string, RuleValue<RuleScalar>>>;
}
export interface RuleSet {
  readonly version: string;
  readonly baselineYear: 2026;
  readonly federal: RulePack;
  readonly california: RulePack;
  readonly payroll: RulePack;
  readonly retirement: RulePack;
}
export interface TaxBracket { readonly upperCents: number | null; readonly rateBps: number }
export interface PassiveRules {
  readonly allowanceCents: number;
  readonly phaseoutStartCents: number;
  readonly phaseoutEndCents: number;
  readonly reductionBps: number;
}
export interface FederalRules {
  readonly brackets: readonly TaxBracket[];
  readonly standardDeductionCents: number;
  readonly additionalStandardDeductionPerFilerCents: number;
  readonly ageDeductionMinimumAge: number;
  readonly seniorDeduction: { readonly perFilerCents: number; readonly minimumAge: number; readonly phaseoutStartCents: number; readonly reductionBps: number };
  readonly salt: { readonly capCents: number; readonly phaseoutStartCents: number; readonly reductionBps: number; readonly floorCents: number };
  readonly itemized: { readonly restrictionNumerator: number; readonly restrictionDenominator: number; readonly thresholdCents: number };
  readonly mortgage: { readonly post2017LimitCents: number; readonly pre2017LimitCents: number; readonly cutoffDate: string };
  readonly mortgageInsurance: { readonly allowed: boolean; readonly phaseoutStartCents: number; readonly phaseoutStepCents: number; readonly reductionBps: number };
  readonly amt: { readonly exemptionCents: number; readonly phaseoutStartCents: number; readonly phaseoutBps: number; readonly rateSplitCents: number; readonly lowerRateBps: number; readonly upperRateBps: number };
  readonly passive: PassiveRules;
  readonly niit: { readonly thresholdCents: number; readonly rateBps: number };
  readonly qbi: { readonly deductionBps: number; readonly phaseoutStartCents: number; readonly phaseoutEndCents: number; readonly wageOnlyLimitBps: number; readonly wageMixedLimitBps: number; readonly ubiaLimitBps: number; readonly minimumDeductionCents: number; readonly minimumQbiCents: number };
  readonly rental: { readonly recoveryPeriodMonths: number; readonly convention: string };
}
export interface CaliforniaRules {
  readonly brackets: readonly TaxBracket[];
  readonly standardDeductionCents: number;
  readonly personalCreditPerFilerCents: number;
  readonly seniorCreditPerFilerCents: number;
  readonly seniorCreditMinimumAge: number;
  readonly creditPhaseout: { readonly startCents: number; readonly stepCents: number; readonly reductionPerExemptionCents: number };
  readonly itemized: { readonly phaseoutStartCents: number; readonly reductionBps: number; readonly maxReductionBps: number };
  readonly mortgage: { readonly acquisitionLimitCents: number };
  readonly mortgageInsurance: { readonly allowed: boolean };
  readonly amt: { readonly exemptionCents: number; readonly phaseoutStartCents: number; readonly phaseoutBps: number; readonly rateBps: number };
  readonly surtax: { readonly thresholdCents: number; readonly rateBps: number };
  readonly passive: PassiveRules;
  readonly rental: { readonly recoveryPeriodMonths: number; readonly convention: string };
}
export interface PayrollRules {
  readonly socialSecurityRateBps: number;
  readonly socialSecurityWageBaseCents: number;
  readonly medicareRateBps: number;
  readonly additionalMedicareRateBps: number;
  readonly additionalMedicareThresholdCents: number;
  readonly sdiRateBps: number;
  readonly sdiWageBaseCents: number | null;
}
export interface RetirementRules {
  readonly electiveDeferralLimitCents: number;
  readonly regularCatchupCents: number;
  readonly enhancedCatchupCents: number;
  readonly catchupMinimumAge: number;
  readonly enhancedCatchupMinimumAge: number;
  readonly enhancedCatchupMaximumAge: number;
  readonly rothCatchupPriorYearWageThresholdCents: number;
  readonly mandatoryRothCatchup: boolean;
  readonly iraLimitCents: number;
  readonly iraCatchupCents: number;
  readonly iraCatchupMinimumAge: number;
  readonly iraDeductionCovered: { readonly startCents: number; readonly endCents: number };
  readonly iraDeductionSpouseCovered: { readonly startCents: number; readonly endCents: number };
  readonly rothIra: { readonly startCents: number; readonly endCents: number };
}
export interface YearRules {
  readonly year: number;
  readonly ruleVersion: string;
  readonly baselineYear: 2026;
  readonly federal: FederalRules;
  readonly california: CaliforniaRules;
  readonly payroll: PayrollRules;
  readonly retirement: RetirementRules;
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
}
