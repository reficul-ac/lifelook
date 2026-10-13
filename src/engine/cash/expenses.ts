import type { Cents, ISODate } from '../model/plan';
import { Decimal, settleCents, settleSeries } from '../money';
import { calendarDate, parseISODate } from '../dates';

export interface RecurringCash {
  readonly amountCents: Cents;
  readonly frequency: 'monthly' | 'annual';
  readonly startDate: ISODate;
  readonly endDate?: ISODate;
  readonly annualGrowthBps: number;
}

/** Scheduled payments retain their original day; growth occurs on January 1. */
export function recurringAmounts(record: RecurringCash, year: number): readonly Cents[] {
  const { year: startYear, month: startMonth, day: startDay } = parseISODate(record.startDate);
  const amount = new Decimal(record.amountCents).mul(new Decimal(1).plus(new Decimal(record.annualGrowthBps).div(10000)).pow(Math.max(0, year - startYear)));
  return settleSeries(Array.from({ length: 12 }, (_, i) => {
    const date = calendarDate(year, i + 1, startDay);
    return date >= record.startDate && (!record.endDate || date <= record.endDate)
      && (record.frequency === 'monthly' || i + 1 === startMonth) ? amount : new Decimal(0);
  }));
}

/** Annual expense budgets settle in monthly installments, preserving saved inputs. */
export function expenseAmounts(record: RecurringCash, year: number): readonly Cents[] {
  if (record.frequency === 'monthly') return recurringAmounts(record, year);
  const { year: startYear, day: startDay } = parseISODate(record.startDate);
  const annualAmount = new Decimal(record.amountCents).mul(new Decimal(1).plus(new Decimal(record.annualGrowthBps).div(10000)).pow(Math.max(0, year - startYear)));
  let activeMonths = 0, settledCents = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const date = calendarDate(year, i + 1, startDay);
    if (date < record.startDate || record.endDate && date > record.endDate) return 0;
    // Multiply before dividing so repeating twelfths cannot move an exact half-cent.
    const next = settleCents(annualAmount.mul(++activeMonths).div(12));
    const installment = next - settledCents;
    settledCents = next;
    return installment;
  });
}
