import { Decimal, settleCents } from '../money';
import type { Cents, Expense, Property, PropertyLoan, RentalUnit } from '../model/plan';

export interface ExpenseAllocation {
  readonly personalCents: Cents;
  readonly rentalCentsByUnit: Readonly<Record<string, Cents>>;
}

function fraction(numerator: number, denominator: number): Decimal {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)
    || numerator < 0 || denominator <= 0 || numerator > denominator) {
    throw new RangeError('Invalid rental allocation fraction.');
  }
  return new Decimal(numerator).div(denominator);
}

/** Exact fractions; area is a cash allocation default, never interest qualification. */
export function sharedRentalShares(
  property: Property, rentals: readonly RentalUnit[],
): Readonly<Record<string, Decimal>> {
  const units = rentals.filter(unit => unit.propertyId === property.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const shares: Record<string, Decimal> = {};
  for (const unit of units) {
    if (unit.sharedAllocation) {
      shares[unit.id] = fraction(unit.sharedAllocation.numerator, unit.sharedAllocation.denominator);
    } else if (property.role === 'rental') {
      shares[unit.id] = new Decimal(1).div(units.length);
    } else if (property.role === 'primary-with-adu') {
      const primary = property.primaryArea ?? 0;
      const adu = property.aduArea ?? 0;
      if (primary <= 0 || adu <= 0) throw new RangeError('Shared ADU allocation requires positive floor areas.');
      shares[unit.id] = fraction(adu, primary + adu).div(units.length);
    } else shares[unit.id] = new Decimal(0);
  }
  const total = Object.values(shares).reduce((sum, share) => sum.plus(share), new Decimal(0));
  if (total.gt(1)) throw new RangeError('Rental allocation shares exceed the whole expense.');
  return shares;
}

/** Effective loan shares honor explicit unit overrides, then traced proceeds. */
export function loanRentalShares(loan: PropertyLoan | undefined, property: Property,
  units: readonly RentalUnit[]): Readonly<Record<string, Decimal>> {
  let defaults: Readonly<Record<string, Decimal>> | undefined;
  return Object.fromEntries([...units].filter(unit => unit.propertyId === property.id)
    .sort((a, b) => a.id.localeCompare(b.id)).map(unit => {
      const explicit = loan && unit.loanAllocations.find(allocation => allocation.loanId === loan.id);
      if (explicit) return [unit.id, fraction(explicit.share.numerator, explicit.share.denominator)];
      const proceeds = loan?.proceedsAllocations.filter(allocation => allocation.use === 'rental'
        && allocation.rentalId === unit.id) ?? [];
      if (proceeds.length) return [unit.id, proceeds.reduce((total, allocation) => total.plus(
        fraction(allocation.share.numerator, allocation.share.denominator)), new Decimal(0))];
      if (loan?.proceedsAllocations.length) return [unit.id, new Decimal(0)];
      if(property.aduProject?.rentalId===unit.id)return [unit.id,new Decimal(0)];
      defaults ??= sharedRentalShares(property, units);
      return [unit.id, defaults[unit.id] ?? new Decimal(0)];
    }));
}

/** Cumulative rounding between units leaves a single personal residual. */
export function allocateShares(paidCents: Cents, shares: Readonly<Record<string, Decimal>>): ExpenseAllocation {
  const paid = new Decimal(paidCents);
  if (!paid.isInteger() || paid.isNegative()) throw new RangeError('An allocation requires nonnegative integer cents.');
  settleCents(paid);
  let exact = new Decimal(0);
  let settled = new Decimal(0);
  const rentalCentsByUnit: Record<string, Cents> = {};
  for (const id of Object.keys(shares).sort()) {
    const share = shares[id]!;
    if (share.isNegative() || share.gt(1)) throw new RangeError('Invalid rental allocation share.');
    exact = exact.plus(paid.times(share));
    const next = new Decimal(settleCents(exact));
    rentalCentsByUnit[id] = settleCents(next.minus(settled));
    settled = next;
  }
  if (exact.gt(paid)) throw new RangeError('Rental allocation shares exceed the whole expense.');
  return { personalCents: settleCents(paid.minus(settled)), rentalCentsByUnit };
}

export function allocateExpense(
  expense: Expense, property: Property, rentals: readonly RentalUnit[], paidCents: Cents,
): ExpenseAllocation {
  const units = rentals.filter(unit => unit.propertyId === property.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (expense.use === 'personal') {
    return allocateShares(paidCents, Object.fromEntries(units.map(unit => [unit.id, new Decimal(0)])));
  }
  if (expense.use === 'rental') {
    if (!expense.rentalId || !units.some(unit => unit.id === expense.rentalId)) {
      throw new RangeError('Direct rental allocation requires a linked rental unit.');
    }
    return allocateShares(paidCents, Object.fromEntries(units.map(unit => [unit.id,
      new Decimal(unit.id === expense.rentalId ? 1 : 0)])));
  }
  let shares = sharedRentalShares(property, units);
  if (expense.allocationOverride) {
    const totalOverride = fraction(expense.allocationOverride.numerator, expense.allocationOverride.denominator);
    if (expense.rentalId) {
      if (!units.some(unit => unit.id === expense.rentalId)) throw new RangeError('Unknown expense allocation rental.');
      shares = Object.fromEntries(units.map(unit => [unit.id,
        unit.id === expense.rentalId ? totalOverride : new Decimal(0)]));
    } else {
      const total = Object.values(shares).reduce((sum, share) => sum.plus(share), new Decimal(0));
      if (total.eq(0) && totalOverride.gt(0)) throw new RangeError('An expense allocation requires a rental unit.');
      shares = Object.fromEntries(Object.entries(shares).map(([id, share]) => [id,
        total.eq(0) ? new Decimal(0) : share.div(total).times(totalOverride)]));
    }
  }
  return allocateShares(paidCents, shares);
}
