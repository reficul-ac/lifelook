import type { Cents, BasisPoints, Property, RentalUnit } from '../model/plan';
import type { Available, Issue } from '../model/results';
import { CalculationRangeError, Decimal, MAX_CENTS, settleCents } from '../money';
import { sharedRentalShares } from './allocation';
import { scheduledPayment } from './loans';

export interface PurchaseLoanInput {
  readonly purchasePriceCents: Cents;
  readonly downPaymentCents: Cents;
  readonly aprBps: BasisPoints;
  readonly termMonths: number;
}
function invalid(field: string, explanation: string): Available<never> {
  const issue: Issue = { code: 'required-purchase-terms', field, severity: 'error', explanation, resolution: 'Enter supported purchase and loan terms before applying a calculated default.' };
  return { status: 'needs-data', issues: [issue] };
}
/** Initializes cash terms only; acquisition and history qualifications remain explicit. */
export function initializePurchaseLoan(input: PurchaseLoanInput): Available<{ originalPrincipalCents: Cents; monthlyPaymentCents: Cents }> {
  for (const key of ['purchasePriceCents', 'downPaymentCents'] as const)
    if (!Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > MAX_CENTS) return invalid(key, 'Purchase money must be nonnegative integer cents within the supported range.');
  if (input.downPaymentCents > input.purchasePriceCents) return invalid('downPaymentCents', 'The down payment exceeds the purchase price.');
  if (!Number.isInteger(input.aprBps) || input.aprBps < 0 || input.aprBps > 100000) return invalid('aprBps', 'Use a nonnegative APR within the supported rate range.');
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1 || input.termMonths > 1200) return invalid('termMonths', 'Enter a term from one through 1,200 months.');
  try {
    const originalPrincipalCents = settleCents(new Decimal(input.purchasePriceCents).minus(input.downPaymentCents));
    return { status: 'available', value: { originalPrincipalCents, monthlyPaymentCents: scheduledPayment(originalPrincipalCents, input.aprBps, input.termMonths) } };
  } catch (error) {
    if (!(error instanceof CalculationRangeError)) throw error;
    return { status: 'unsupported-case', issues: [{ code: 'monetary-overflow', field: 'monthlyPaymentCents', severity: 'error', explanation: 'The calculated payment exceeds the supported monetary range.', resolution: 'Reduce the principal or APR, or adjust the term before applying a default.' }] };
  }
}
export function defaultRentalAllocation(property: Property, rentals: readonly RentalUnit[]): Available<Readonly<Record<string, string>>> {
  try {
    return { status: 'available', value: Object.fromEntries(Object.entries(sharedRentalShares(property, rentals)).map(([id, share]) => [id, `${share.mul(100).toFixed(2)}%`])) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { status: 'needs-data', issues: [{ code: 'required-rental-allocation', recordId: property.id, field: 'sharedAllocation', severity: 'error', explanation: error.message, resolution: 'Enter positive primary/ADU areas or supported explicit allocation shares.' }] };
  }
}
