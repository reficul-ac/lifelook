import type { ValidatedPlan } from './plan';

export interface Issue {
  readonly code: string;
  readonly recordId?: string;
  readonly year?: number;
  readonly field?: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly explanation: string;
  readonly resolution: string;
}
export type Available<T> = Readonly<{ status: 'available'; value: T }> | Readonly<{ status: 'needs-data' | 'unsupported-case'; issues: readonly Issue[] }>;
export interface RuleProvenance {
  readonly status: 'verified' | 'provisional' | 'projected';
  readonly ruleVersion: string;
  readonly baselineYear: number;
  readonly applicableYear: number;
  readonly sources: readonly string[];
  readonly assumptions: readonly string[];
}
export interface Coverage {
  readonly completeForModeledScope: boolean;
  readonly completeHouseholdLiability: boolean;
  readonly issues: readonly Issue[];
}
export type ValidationResult = Readonly<{ ok: true; plan: ValidatedPlan; issues: readonly Issue[] }> | Readonly<{ ok: false; issues: readonly Issue[] }>;

export type { CashYear, CashMonth, CashTotals, CashStream, WageFacts, SalaryPeriod } from '../cash/income';
export type { ContributionRequest } from '../cash/contribution-requests';
export type { LoanMonth, LoanSchedule, LoanAverageBalanceEvidence, MortgageQualificationEvidence, OpeningLoanProvenance } from '../property/loans';
export type { GrowthMonth } from '../growth';

