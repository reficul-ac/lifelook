import type { ISODate, YearMonth } from './model/plan';

export interface CalendarParts { readonly year: number; readonly month: number; readonly day: number }
export function isLeapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Invalid calendar year or month.');
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
}
export function daysInYear(year: number): number { daysInMonth(year, 1); return isLeapYear(year) ? 366 : 365; }
export function calendarDate(year: number, month: number, day: number): ISODate {
  const length = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError('Invalid calendar day.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, length)).padStart(2, '0')}`;
}
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
export function isValidYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0] = value.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12;
}
export function parseISODate(value: ISODate): CalendarParts {
  if (!isValidISODate(value)) throw new RangeError('Invalid ISO calendar date.');
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return { year, month, day };
}
export function yearMonth(year: number, month: number): YearMonth { return calendarDate(year, month, 1).slice(0, 7); }

