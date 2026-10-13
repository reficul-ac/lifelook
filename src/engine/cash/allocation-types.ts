import type { Cents } from '../model/plan';
import type { Available, Issue } from '../model/results';

export interface AccountAllocationFunding {
  readonly accountId: string;
  readonly targetCents: Cents;
  readonly existingCents: Cents;
  readonly percentageCents: Cents;
  readonly maximumCents: Cents;
  readonly excessCents: Cents;
  readonly actualCents: Cents;
  readonly shortfallCents: Cents;
  /** Actual funding divided by the original annual cash flow; a fraction. */
  readonly share: Available<number>;
  readonly reasons: readonly Issue[];
}
export interface CashFlowAllocationYear {
  readonly year: number;
  readonly status: 'funded' | 'no-surplus' | 'funding-conflict';
  readonly originalCashFlowCents: Cents;
  readonly accounts: readonly AccountAllocationFunding[];
  readonly explicitCashCents: Cents;
  readonly excessOfferedCents: Cents;
  readonly excessAcceptedCents: Cents;
  readonly excessRetainedCents: Cents;
  readonly retainedCashCents: Cents;
  readonly reasons: readonly Issue[];
}
