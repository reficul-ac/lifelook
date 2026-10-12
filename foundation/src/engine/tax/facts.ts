import type { Cents } from '../model/plan';
import type { Available, Issue } from '../model/results';

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
