import type { AllocationDestination, ValidatedPlan } from '../model/plan';
import { validatePlan } from '../validation';
export interface AllocationSource {
  readonly policyId: string;
  readonly sourceId: string;
  readonly fieldPrefix: string;
  readonly destination: AllocationDestination;
}
export interface AllocationAdapter {
  readonly plan: ValidatedPlan;
  readonly sourceMap: ReadonlyMap<string, AllocationSource>;
}
/** Legal resolvers require descriptors, but only the allocation scheduler emits requests. */
export function createAllocationAdapter(plan: ValidatedPlan, year: number): AllocationAdapter {
  const { cashFlowAllocation: policy, ...document } = plan;
  const sourceMap = new Map<string, AllocationSource>();
  if (!policy) return { plan, sourceMap };
  const sources = [...policy.entries.map((entry, index) => ({ ...entry, fieldPrefix: `cashFlowAllocation.entries.${index}` })),
    { ...policy.overflow, priority: 0, fieldPrefix: 'cashFlowAllocation.overflow' }];
  const contributions = [...plan.contributions];
  for (const source of sources) {
    if (source.destination.kind !== 'account') continue;
    // Policy IDs are globally unique. Removing the policy before validation lets
    // descriptors reuse their source IDs without changing saved document identity.
    sourceMap.set(source.id, { policyId: policy.id, sourceId: source.id, fieldPrefix: source.fieldPrefix, destination: source.destination });
    contributions.push({ id: source.id, accountId: source.destination.backdoorRoth?.traditionalIraAccountId ?? source.destination.accountId, priority: source.priority,
      startDate: `${year}-01-01`, endDate: `${year}-12-31`, amount: { kind: 'fixed', monthlyCents: 0 },
      ...(source.destination.sponsoringSalaryId ? { sponsoringSalaryId: source.destination.sponsoringSalaryId } : {}) });
  }
  const validated = validatePlan({ ...document, contributions });
  if (!validated.ok) throw new Error(`Invalid allocation adapter: ${JSON.stringify(validated.issues)}`);
  return { plan: validated.plan, sourceMap };
}
