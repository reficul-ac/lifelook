import type {PlanDocument} from '../engine';
import type {EditTarget} from './edit-types';
import type {InputSection, IssueViewState, ReviewTarget} from './issue-presentation';

export type Destination = 'overview' | 'income' | 'accounts' | 'properties' | 'spending' | 'household';
export interface WorkspaceRoute {destination: Destination; editor: {target: EditTarget; returnTo: Destination; origin: HTMLElement | null} | null; surface: 'edit' | 'forecast'}
export const destinations: readonly [Destination, string][] = [['overview', 'Overview'], ['income', 'Income'], ['accounts', 'Accounts'], ['properties', 'Properties'], ['spending', 'Spending & debts'], ['household', 'Household']];
export function destinationForSection(section: InputSection): Destination {
  return ({Household: 'household', Income: 'income', 'Expenses and debts': 'spending', Investments: 'accounts', Properties: 'properties'} as const)[section];
}
export function targetForReview(target: ReviewTarget, state: IssueViewState, producingPlan: PlanDocument): EditTarget | null {
  if (target.section === 'Household') return {kind: 'record', section: 'household', recordId: 'household'};
  if (target.recordId === producingPlan.cashFlowAllocation?.id || target.recordId === state.allocationDraft?.recordId) return {kind: 'allocation'};
  const property = producingPlan.properties.find(p => p.id === target.recordId || p.loans.some(l => l.id === target.recordId) || p.aduProject?.id === target.recordId);
  const rental = producingPlan.rentals.find(r => r.id === target.recordId);
  const expense = producingPlan.expenses.find(e => e.id === target.recordId && e.propertyId);
  if (property || rental || expense) return {kind: 'record', section: 'properties', recordId: property?.id ?? rental?.propertyId ?? expense!.propertyId!};
  const draft = state.drafts[target.recordId];
  if (draft) return {kind: 'record', section: draft.section, recordId: draft.recordId};
  for (const section of ['salaries', 'otherIncome', 'accounts', 'contributions', 'expenses', 'children', 'debts', 'properties', 'rentals'] as const) {
    if ((producingPlan[section] ?? []).some(r => r.id === target.recordId)) return {kind: 'record', section, recordId: target.recordId};
  }
  return null;
}
