import { isValidISODate, isValidYearMonth, parseISODate } from './dates';
import { rsuVestingEvents } from './equity/rsu';
import { Decimal, MAX_CENTS, settleCents } from './money';
import type { Filer, ISODate, PlanDocument, RsuGrant, ValidatedPlan } from './model/plan';
import type { Issue, ValidationResult } from './model/results';
import { checkCoverage } from './coverage';
import { allocateExpense, allocateShares, loanRentalShares, sharedRentalShares } from './property/allocation';

type Obj = Record<string, unknown>;
const books = ['federal', 'california', 'federal-amt', 'california-amt'] as const;
const isObject = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Validates complete documents without turning absent history into an invented amount. */
class Validator {
  readonly issues: Issue[] = [];
  readonly ids = new Map<string, string>();
  constructor(readonly planId?: string) {}
  issue(field: string, recordId: string | undefined, explanation: string, code = 'invalid-input'): void {
    this.issues.push({ code, ...(recordId ? { recordId } : {}), field, severity: 'error', explanation, resolution: 'Correct the indicated input and save the record again.' });
  }
  object(value: unknown, field: string, recordId?: string): Obj | undefined {
    if (!isObject(value)) { this.issue(field, recordId, 'A plain JSON object is required.'); return undefined; }
    return value;
  }
  array(value: unknown, field: string, recordId?: string): readonly unknown[] {
    if (!Array.isArray(value)) { this.issue(field, recordId, 'An array is required.'); return []; }
    return value;
  }
  text(value: unknown, field: string, recordId?: string): value is string {
    if (typeof value !== 'string' || value.trim().length === 0) { this.issue(field, recordId, 'A nonempty string is required.'); return false; }
    return true;
  }
  integer(value: unknown, field: string, recordId: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) { this.issue(field, recordId, `An integer from ${min} through ${max} is required.`); return false; }
    return true;
  }
  cents(value: unknown, field: string, recordId?: string, signed = false): value is number { return this.integer(value, field, recordId, signed ? -MAX_CENTS : 0, MAX_CENTS); }
  rate(value: unknown, field: string, recordId?: string, growth = true): value is number { return this.integer(value, field, recordId, growth ? -9999 : 0, 100000); }
  shares(value: unknown, field: string, recordId: string, positive = false): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || positive && value === 0 || value > Number.MAX_SAFE_INTEGER || new Decimal(value).decimalPlaces() > 6) {
      this.issue(field, recordId, `A finite ${positive ? 'positive' : 'nonnegative'} share quantity with at most six decimal places is required.`);
      return false;
    }
    return true;
  }
  enum(value: unknown, options: readonly string[], field: string, recordId?: string): void {
    if (typeof value !== 'string' || !options.includes(value)) this.issue(field, recordId, `Choose one of: ${options.join(', ')}.`);
  }
  bool(value: unknown, field: string, recordId?: string): void { if (typeof value !== 'boolean') this.issue(field, recordId, 'An explicit boolean is required.'); }
  date(value: unknown, field: string, recordId?: string): value is string {
    if (!isValidISODate(value)) { this.issue(field, recordId, 'Use a complete valid ISO calendar date (YYYY-MM-DD).'); return false; }
    return true;
  }
  range(record: Obj, start: string, end: string, recordId?: string): void {
    this.date(record[start], start, recordId);
    if (record[end] !== undefined && this.date(record[end], end, recordId) && isValidISODate(record[start]) && record[end] < record[start]) this.issue(end, recordId, 'The inclusive end date precedes the start date.');
  }
  history(value: unknown, field: string, recordId: string | undefined, check: (value: unknown, field: string) => void): void {
    const h = this.object(value, field, recordId);
    if (!h) return;
    if (h.known === true) {
      if (!Object.hasOwn(h, 'value')) this.issue(`${field}.value`, recordId, 'A known history requires its explicit value.');
      else check(h.value, `${field}.value`);
      if (Object.keys(h).some(key => key !== 'known' && key !== 'value')) this.issue(field, recordId, 'History permits only known and value.');
    } else if (h.known === false) {
      if (Object.keys(h).some(key => key !== 'known')) this.issue(field, recordId, 'Unknown history must not carry a value.');
    } else this.issue(`${field}.known`, recordId, 'History must explicitly state whether it is known.');
  }
  booleanHistory(value: unknown, field: string, recordId?: string): void { this.history(value, field, recordId, (v, f) => this.bool(v, f, recordId)); }
  moneyHistory(value: unknown, field: string, recordId?: string, signed = false): void { this.history(value, field, recordId, (v, f) => { this.cents(v, f, recordId, signed); }); }
  allocation(value: unknown, field: string, recordId?: string): void {
    const a = this.object(value, field, recordId);
    if (!a) return;
    const n = this.integer(a.numerator, `${field}.numerator`, recordId, 0);
    const d = this.integer(a.denominator, `${field}.denominator`, recordId, 1);
    if (n && d && (a.numerator as number) > (a.denominator as number)) this.issue(field, recordId, 'The allocation numerator must not exceed its denominator.');
  }
  record(value: unknown, collection: string, name = true): Obj | undefined {
    const o = this.object(value, collection, this.planId);
    if (!o) return undefined;
    const id = typeof o.id === 'string' ? o.id : this.planId;
    if (this.text(o.id, 'id', id)) {
      if (this.ids.has(o.id)) this.issue('id', o.id, 'IDs must be unique across all document records.', 'duplicate-id');
      else this.ids.set(o.id, collection);
    }
    if (name) this.text(o.name, 'name', id);
    return o;
  }
  uniqueRows(rows: readonly unknown[], key: (row: Obj) => unknown, field: string, recordId?: string): void {
    const seen = new Set<unknown>();
    rows.forEach((row, index) => {
      if (!isObject(row)) return;
      const value = key(row);
      if (seen.has(value)) this.issue(`${field}[${index}]`, recordId, 'Duplicate entries for the same key are not permitted.');
      seen.add(value);
    });
  }
  recurring(o: Obj, id: string): void {
    this.cents(o.amountCents, 'amountCents', id);
    this.enum(o.frequency, ['monthly', 'annual'], 'frequency', id);
    this.range(o, 'startDate', 'endDate', id);
    this.rate(o.annualGrowthBps, 'annualGrowthBps', id);
  }
}

/** Saved allocation links are validated against the current saved account and salary records. */
function validateCashFlowAllocation(v: Validator, value: unknown, accounts: ReadonlyMap<string, Obj>, salaries: ReadonlyMap<string, Obj>): void {
  const field = 'cashFlowAllocation';
  const policy = v.object(value, field, v.planId);
  if (!policy) return;
  const policyId = recordId(policy) || v.planId;
  const identity = (o: Obj, path: string): string | undefined => {
    const id = typeof o.id === 'string' ? o.id : policyId;
    if (!v.text(o.id, `${path}.id`, id)) return id;
    if (v.ids.has(o.id) || o.id === v.planId) v.issue(`${path}.id`, id, 'IDs must be unique across all document records.', 'duplicate-id');
    else v.ids.set(o.id, path);
    return id;
  };
  identity(policy, field);
  const sponsors = new Map<string, unknown>();
  const routes: { source: string; target: string; path: string; id: string | undefined }[] = [];
  const directTargets = new Set<string>();
  const destination = (value: unknown, path: string, id: string | undefined): Obj | undefined => {
    const dest = v.object(value, path, id);
    if (!dest) return;
    v.enum(dest.kind, ['cash', 'account'], `${path}.kind`, id);
    if (dest.kind === 'cash') {
      if (dest.backdoorRoth !== undefined) v.issue(`${path}.backdoorRoth`, id, 'A backdoor route requires a Roth IRA destination.');
      if (dest.sponsoringSalaryId !== undefined) v.issue(`${path}.sponsoringSalaryId`, id, 'Cash cannot reference a sponsoring salary.');
      if (dest.accountId !== undefined) v.issue(`${path}.accountId`, id, 'Cash cannot reference an investment account.');
    }
    if (dest.kind !== 'account') return dest;
    if (!v.text(dest.accountId, `${path}.accountId`, id)) return dest;
    const account = accounts.get(dest.accountId);
    if (!account) v.issue(`${path}.accountId`, id, 'The referenced account does not exist.', 'dangling-reference');
    else if (account.type === 'rsu') v.issue(`${path}.accountId`, id, 'RSU accounts cannot receive cash allocations.');
    if (dest.backdoorRoth !== undefined) {
      const route = v.object(dest.backdoorRoth, `${path}.backdoorRoth`, id);
      if (account?.type !== 'roth-ira') v.issue(`${path}.backdoorRoth`, id, 'A backdoor route requires a Roth IRA destination.');
      if (route) {
        v.booleanHistory(route.cleanIraHistory, `${path}.backdoorRoth.cleanIraHistory`, id);
        if (v.text(route.traditionalIraAccountId, `${path}.backdoorRoth.traditionalIraAccountId`, id)) {
          const source = accounts.get(route.traditionalIraAccountId);
          if (!source) v.issue(`${path}.backdoorRoth.traditionalIraAccountId`, id, 'The linked traditional IRA does not exist.', 'dangling-reference');
          else if (source.type !== 'traditional-ira' || source.ownerId !== account?.ownerId) v.issue(`${path}.backdoorRoth.traditionalIraAccountId`, id, 'The linked account must be a traditional IRA belonging to the Roth IRA owner.');
          routes.push({ source: route.traditionalIraAccountId, target: dest.accountId, path, id });
        }
      }
    } else directTargets.add(dest.accountId);
    const workplace = account?.type === 'traditional-401k' || account?.type === 'roth-401k';
    if (workplace) {
      if (v.text(dest.sponsoringSalaryId, `${path}.sponsoringSalaryId`, id)) {
        const salary = salaries.get(dest.sponsoringSalaryId);
        if (!salary) v.issue(`${path}.sponsoringSalaryId`, id, 'The referenced salary does not exist.', 'dangling-reference');
        else if (salary.ownerId !== account.ownerId) v.issue(`${path}.sponsoringSalaryId`, id, 'The sponsoring salary must belong to the account owner.');
      }
      if (sponsors.has(dest.accountId) && sponsors.get(dest.accountId) !== dest.sponsoringSalaryId) v.issue(`${path}.sponsoringSalaryId`, id, 'Repeated workplace destinations must use the same sponsoring salary.');
      sponsors.set(dest.accountId, dest.sponsoringSalaryId);
    } else if (dest.sponsoringSalaryId !== undefined) v.issue(`${path}.sponsoringSalaryId`, id, 'Only workplace accounts may reference a sponsoring salary.');
    return dest;
  };
  const seen = new Set<string>();
  let percentTotal = new Decimal(0);
  v.array(policy.entries, `${field}.entries`, policyId).forEach((value, index) => {
    const path = `${field}.entries[${index}]`;
    const entry = v.object(value, path, policyId);
    if (!entry) return;
    const id = identity(entry, path);
    v.integer(entry.priority, `${path}.priority`, id, 0);
    const dest = destination(entry.destination, `${path}.destination`, id);
    const key = dest?.kind === 'cash' ? 'cash' : dest?.kind === 'account' && typeof dest.accountId === 'string' ? `account:${dest.accountId}` : undefined;
    if (key !== undefined) {
      if (seen.has(key)) v.issue(`${path}.destination`, id, 'Only one primary entry is allowed per destination.');
      seen.add(key);
    }
    const amount = v.object(entry.amount, `${path}.amount`, id);
    if (!amount) return;
    v.enum(amount.kind, ['percent', 'max-annual'], `${path}.amount.kind`, id);
    if (amount.kind === 'percent' && v.integer(amount.percentBps, `${path}.amount.percentBps`, id, 0, 10000)) percentTotal = percentTotal.plus(amount.percentBps as number);
    if (amount.kind === 'max-annual') {
      const account = dest?.kind === 'account' && typeof dest.accountId === 'string' ? accounts.get(dest.accountId) : undefined;
      if (!account || !['traditional-401k', 'roth-401k', 'traditional-ira', 'roth-ira'].includes(String(account.type))) v.issue(`${path}.amount.kind`, id, 'Annual maximums require a supported retirement account.');
    }
  });
  if (percentTotal.gt(10000)) v.issue(`${field}.entries`, policyId, 'Percentage targets cannot total more than 100%.');
  const overflow = v.object(policy.overflow, `${field}.overflow`, policyId);
  if (overflow) destination(overflow.destination, `${field}.overflow.destination`, identity(overflow, `${field}.overflow`));
  for (const route of routes) {
    if (directTargets.has(route.source)) v.issue(`${route.path}.backdoorRoth.traditionalIraAccountId`, route.id, 'The conversion source cannot also receive a direct cash allocation.');
    if (routes.some(other => other.source === route.source && other.target !== route.target)) v.issue(`${route.path}.backdoorRoth.traditionalIraAccountId`, route.id, 'A traditional IRA source cannot fund different backdoor Roth destinations.');
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function validateJsonTree(v: Validator, value: unknown, field = '', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && !isObject(value))) { v.issue(field || 'document', v.planId, 'The document may contain only finite plain JSON values.'); return; }
  if (ancestors.has(value)) { v.issue(field || 'document', v.planId, 'JSON documents cannot contain cyclic references.'); return; }
  ancestors.add(value);
  Object.entries(value).forEach(([key, entry]) => validateJsonTree(v, entry, Array.isArray(value) ? `${field}[${key}]` : field ? `${field}.${key}` : key, ancestors));
  ancestors.delete(value);
}
function records(v: Validator, raw: Obj, key: string, name = true): readonly Obj[] {
  return v.array(raw[key], key, v.planId).map(value => v.record(value, key, name)).filter((value): value is Obj => value !== undefined);
}
const recordId = (o: Obj): string => typeof o.id === 'string' ? o.id : '';

export function validatePlan(raw: unknown): ValidationResult {
  const v = new Validator(isObject(raw) && typeof raw.id === 'string' ? raw.id : undefined);
  const root = v.object(raw, 'document', v.planId);
  if (!root) return { ok: false, issues: v.issues };
  v.text(root.id, 'id', v.planId);
  if (root.schemaVersion !== 1) v.issue('schemaVersion', v.planId, 'Only document schema version 1 is supported.', 'unsupported-schema');
  v.integer(root.revision, 'revision', v.planId, 0);
  const startValid = v.integer(root.startYear, 'startYear', v.planId, 2026, 9999);
  const horizonValid = v.integer(root.horizonYears, 'horizonYears', v.planId, 1, 40);
  if (startValid && horizonValid && (root.startYear as number) + (root.horizonYears as number) - 1 > 9999) v.issue('horizonYears', v.planId, 'The forecast exceeds the supported calendar.');
  v.cents(root.openingCashCents, 'openingCashCents', v.planId, true);
  const forecastStart = startValid ? `${root.startYear}-01-01` : '';

  const owners = new Set<string>();
  const household = v.object(root.household, 'household', v.planId);
  if (household) {
    v.enum(household.filingStatus, ['married-joint'], 'household.filingStatus', v.planId);
    v.enum(household.residence, ['CA-full-year'], 'household.residence', v.planId);
    v.enum(household.currency, ['USD'], 'household.currency', v.planId);
    const filers = v.array(household.filers, 'household.filers', v.planId);
    if (filers.length !== 2) v.issue('household.filers', v.planId, 'Exactly two adult tax filers are required.');
    filers.forEach(value => {
      const f = v.record(value, 'household.filers');
      if (!f) return;
      const id = recordId(f);
      owners.add(id);
      v.history(f.birthDate, 'birthDate', id, (birth, field) => {
        if (v.date(birth, field, id) && startValid && birth > `${Number(root.startYear)-18}-01-01`) v.issue(field, id, 'Each modeled filer must be an adult at the forecast start.');
      });
      v.booleanHistory(f.workplaceCoverage, 'workplaceCoverage', id);
      if(f.seniorDeductionSsnEligible!==undefined)v.booleanHistory(f.seniorDeductionSsnEligible,'seniorDeductionSsnEligible',id);
      const coverage = v.array(f.coverageByYear, 'coverageByYear', id);
      v.uniqueRows(coverage, row => row.year, 'coverageByYear', id);
      coverage.forEach((value, index) => {
        const row = v.object(value, `coverageByYear[${index}]`, id);
        if (!row) return;
        v.integer(row.year, `coverageByYear[${index}].year`, id, 1, 9999);
        v.booleanHistory(row.workplaceCoverage, `coverageByYear[${index}].workplaceCoverage`, id);
      });
      const employers = v.array(f.employerAssumptionsByYear, 'employerAssumptionsByYear', id);
      v.uniqueRows(employers, row => `${row.employerId}:${row.year}`, 'employerAssumptionsByYear', id);
      employers.forEach((value, index) => {
        const row = v.object(value, `employerAssumptionsByYear[${index}]`, id);
        if (!row) return;
        const field = `employerAssumptionsByYear[${index}]`;
        v.integer(row.year, `${field}.year`, id, 1, 9999);
        v.text(row.employerId, `${field}.employerId`, id);
        v.moneyHistory(row.priorYearWagesCents, `${field}.priorYearWagesCents`, id);
        v.booleanHistory(row.planCatchUpAvailable, `${field}.planCatchUpAvailable`, id);
        v.booleanHistory(row.rothCatchUpAvailable, `${field}.rothCatchUpAvailable`, id);
      });
    });
    const answers = v.object(household.coverageAnswers, 'household.coverageAnswers', v.planId);
    if (answers) for (const field of ['additionalIncome', 'additionalCredits', 'qualifiedDividendsOrCapitalGains', 'retirementDistributions', 'priorFederalMinimumTaxCredits', 'priorCaliforniaMinimumTaxCredits']) v.booleanHistory(answers[field], `household.coverageAnswers.${field}`, v.planId);
  }
  const policy = v.object(root.taxPolicy, 'taxPolicy', v.planId);
  if (policy) {
    if (policy.baselineYear !== 2026) v.issue('taxPolicy.baselineYear', v.planId, 'The baseline rule year must be 2026.');
    v.rate(policy.futureIndexGrowthBps, 'taxPolicy.futureIndexGrowthBps', v.planId);
    const rows = v.array(policy.actualStateTaxPaidByYear, 'taxPolicy.actualStateTaxPaidByYear', v.planId);
    v.uniqueRows(rows, row => row.year, 'taxPolicy.actualStateTaxPaidByYear', v.planId);
    rows.forEach((value, index) => {
      const row = v.object(value, `taxPolicy.actualStateTaxPaidByYear[${index}]`, v.planId);
      if (!row) return;
      v.integer(row.year, `taxPolicy.actualStateTaxPaidByYear[${index}].year`, v.planId, 2026, 9999);
      v.cents(row.californiaIncomeTaxPaidCents, `taxPolicy.actualStateTaxPaidByYear[${index}].californiaIncomeTaxPaidCents`, v.planId);
      v.cents(row.sdiPaidCents, `taxPolicy.actualStateTaxPaidByYear[${index}].sdiPaidCents`, v.planId);
    });
  }

  const salaries = records(v, root, 'salaries');
  const otherIncome = records(v, root, 'otherIncome');
  const expenses = records(v, root, 'expenses');
  const accounts = records(v, root, 'accounts');
  const contributions = records(v, root, 'contributions', false);
  const debts = records(v, root, 'debts');
  const properties = records(v, root, 'properties');
  const rentals = records(v, root, 'rentals', false);
  const propertyById = new Map(properties.map(o => [recordId(o), o]));
  const rentalById = new Map(rentals.map(o => [recordId(o), o]));
  const accountById = new Map(accounts.map(o => [recordId(o), o]));
  const salaryById = new Map(salaries.map(o => [recordId(o), o]));
  const loanById = new Map<string, Obj>();
  const reference = (value: unknown, set: ReadonlySet<string> | ReadonlyMap<string, unknown>, field: string, id: string): void => {
    if (v.text(value, field, id) && !set.has(value)) v.issue(field, id, 'The referenced record does not exist.', 'dangling-reference');
  };

  salaries.forEach(o => {
    const id = recordId(o);
    reference(o.ownerId, owners, 'ownerId', id); v.text(o.employerId, 'employerId', id);
    v.cents(o.annualGrossCents, 'annualGrossCents', id); v.range(o, 'startDate', 'endDate', id);
    v.rate(o.annualRaiseBps, 'annualRaiseBps', id); v.integer(o.raiseMonth, 'raiseMonth', id, 1, 12); v.integer(o.raiseDay, 'raiseDay', id, 1, 31);
    const changes = v.array(o.changes, 'changes', id);
    const seen = new Set<string>();
    changes.forEach((value, index) => {
      const row = v.object(value, `changes[${index}]`, id); if (!row) return;
      const field = `changes[${index}]`;
      if (v.date(row.date, `${field}.date`, id)) {
        if (seen.has(row.date)) v.issue(`${field}.date`, id, 'Only one explicit change is allowed per salary and date.', 'duplicate-date');
        seen.add(row.date);
        if (isValidISODate(o.startDate) && row.date < o.startDate) v.issue(`${field}.date`, id, 'The change precedes the salary start.');
        if (isValidISODate(o.endDate) && row.date > o.endDate) v.issue(`${field}.date`, id, 'The change follows the salary end.');
      }
      v.enum(row.kind, ['percent', 'amount'], `${field}.kind`, id);
      if (row.kind === 'percent') v.rate(row.percentBps, `${field}.percentBps`, id);
      if (row.kind === 'amount') v.cents(row.annualGrossCents, `${field}.annualGrossCents`, id);
    });
  });
  otherIncome.forEach(o => {
    const id = recordId(o); v.recurring(o, id);
    v.enum(o.classification, ['wage', 'ordinary-taxable', 'non-taxable'], 'classification', id);
    if (o.classification === 'wage') { reference(o.ownerId, owners, 'ownerId', id); v.text(o.employerId, 'employerId', id); }
    else {
      if (o.ownerId !== undefined) reference(o.ownerId, owners, 'ownerId', id);
      if (o.employerId !== undefined) v.issue('employerId', id, 'Only wages may reference an employer.');
      if (o.classification === 'ordinary-taxable') v.enum(o.niitTreatment, ['included', 'excluded', 'unknown'], 'niitTreatment', id);
      else if (o.niitTreatment !== undefined) v.issue('niitTreatment', id, 'NIIT classification belongs to ordinary taxable income.');
    }
  });
  const rsuGrantIds: { readonly grantId: string; readonly accountId: string; readonly field: string }[] = [];
  accounts.forEach(o => {
    const id = recordId(o); reference(o.ownerId, owners, 'ownerId', id);
    v.enum(o.type, ['taxable-brokerage', 'traditional-401k', 'roth-401k', 'traditional-ira', 'roth-ira', 'rsu'], 'type', id);
    v.cents(o.openingBalanceCents, 'openingBalanceCents', id); v.rate(o.annualGrowthBps, 'annualGrowthBps', id); v.moneyHistory(o.openingIraBasis, 'openingIraBasis', id);
    if (o.type !== 'rsu') {
      if (o.rsu !== undefined) v.issue('rsu', id, 'RSU grant details belong only to RSU accounts.');
      return;
    }
    if (o.openingBalanceCents !== 0) v.issue('openingBalanceCents', id, 'RSU opening value is derived from held shares; the ordinary opening balance must be zero.');
    if (isObject(o.openingIraBasis) && o.openingIraBasis.known !== false) v.issue('openingIraBasis', id, 'An RSU account must keep IRA basis explicitly unknown.');
    const rsu = v.object(o.rsu, 'rsu', id);
    if (!rsu) return;
    v.text(rsu.employerId, 'rsu.employerId', id);
    const priceValid = v.integer(rsu.currentSharePriceCents, 'rsu.currentSharePriceCents', id, 1, MAX_CENTS);
    if (rsu.priceTargets !== undefined) {
      let previousDate = forecastStart;
      v.array(rsu.priceTargets, 'rsu.priceTargets', id).forEach((value, index) => {
        const field = `rsu.priceTargets[${index}]`, target = v.object(value, field, id);
        if (!target) return;
        if (v.date(target.date, `${field}.date`, id)) {
          if (startValid && target.date <= forecastStart) {
            v.issue(`${field}.date`, id, 'A share price target must follow January 1 of the forecast start year.');
          } else if (target.date <= previousDate) {
            v.issue(`${field}.date`, id, 'Share price targets must have distinct dates in increasing order.');
          }
          previousDate = target.date;
        }
        v.integer(target.sharePriceCents, `${field}.sharePriceCents`, id, 1, MAX_CENTS);
      });
    }
    v.array(rsu.grants, 'rsu.grants', id).forEach((value, index) => {
      const field = `rsu.grants[${index}]`, grant = v.object(value, field, id);
      if (!grant) return;
      if (v.text(grant.id, `${field}.id`, id)) {
        rsuGrantIds.push({ grantId: grant.id, accountId: id, field: `${field}.id` });
        if (v.ids.has(grant.id) || grant.id === v.planId) v.issue(`${field}.id`, id, 'IDs must be unique across all document records.', 'duplicate-id');
        else v.ids.set(grant.id, `${field}.id`);
      }
      v.text(grant.name, `${field}.name`, id);
      const dateValid = v.date(grant.startDate, `${field}.startDate`, id);
      const valueValid = v.integer(grant.grantValueCents, `${field}.grantValueCents`, id, 1, MAX_CENTS);
      const grantPriceValid = v.integer(grant.grantSharePriceCents, `${field}.grantSharePriceCents`, id, 1, MAX_CENTS);
      const awardValid = grant.awardedShares === undefined || v.shares(grant.awardedShares, `${field}.awardedShares`, id, true);
      const termValid = v.integer(grant.vestingMonths, `${field}.vestingMonths`, id, 1, 600);
      v.enum(grant.vestingFrequency, ['monthly', 'quarterly', 'annual'], `${field}.vestingFrequency`, id);
      const frequencyValid = grant.vestingFrequency === 'monthly' || grant.vestingFrequency === 'quarterly' || grant.vestingFrequency === 'annual';
      const cliffValid = v.integer(grant.cliffMonths, `${field}.cliffMonths`, id, 0, termValid ? Number(grant.vestingMonths) : 600);
      v.integer(grant.withholdingBps, `${field}.withholdingBps`, id, 0, 10000);
      v.enum(grant.taxTreatment, ['settle-at-vest', 'deferred'], `${field}.taxTreatment`, id);
      const heldValid = v.shares(grant.openingHeldShares, `${field}.openingHeldShares`, id);
      if (heldValid && grant.taxTreatment === 'deferred' && Number(grant.openingHeldShares) > 0) v.issue(`${field}.openingHeldShares`, id, 'Deferred grants with opening held shares require separate prior settlement history; the gross delivered and withheld shares cannot be inferred from net holdings.');
      v.moneyHistory(grant.openingBasis, `${field}.openingBasis`, id);
      let scheduleCalendarValid = dateValid && termValid;
      if (scheduleCalendarValid) {
        const start = parseISODate(grant.startDate as string);
        if (start.year * 12 + start.month - 1 + Number(grant.vestingMonths) > 9999 * 12 + 11) {
          scheduleCalendarValid = false;
          v.issue(`${field}.vestingMonths`, id, 'The final vesting date exceeds the supported calendar.');
        }
      }
      if (heldValid && awardValid && valueValid && grantPriceValid) {
        const awarded = grant.awardedShares === undefined ? new Decimal(Number(grant.grantValueCents)).div(Number(grant.grantSharePriceCents)) : new Decimal(Number(grant.awardedShares));
        if (new Decimal(grant.openingHeldShares as number).gt(awarded)) v.issue(`${field}.openingHeldShares`, id, 'Opening held shares cannot exceed the awarded share quantity.');
        if (scheduleCalendarValid && cliffValid && frequencyValid && forecastStart) {
          const priorVest = rsuVestingEvents(grant as unknown as RsuGrant).filter(event => event.date < forecastStart).at(-1);
          const start = parseISODate(grant.startDate as string), prior = priorVest ? parseISODate(priorVest.date) : undefined;
          const elapsedMonths = prior ? (prior.year - start.year) * 12 + prior.month - start.month : 0;
          // Event dates preserve cliffs and month anchors; cumulative units avoid rounding individual events.
          const serviceVested = elapsedMonths === grant.vestingMonths ? awarded : awarded.mul(elapsedMonths).div(Number(grant.vestingMonths));
          if (new Decimal(grant.openingHeldShares as number).gt(serviceVested)) v.issue(`${field}.openingHeldShares`, id, 'Opening held shares cannot exceed shares vested strictly before forecast start.');
        }
      }
      if (heldValid && priceValid) {
        try { settleCents(new Decimal(grant.openingHeldShares as number).times(Number(rsu.currentSharePriceCents))); }
        catch { v.issue(`${field}.openingHeldShares`, id, 'The opening held-share value exceeds the supported monetary range.', 'monetary-overflow'); }
      }
    });
  });
  contributions.forEach(o => {
    const id = recordId(o); reference(o.accountId, accountById, 'accountId', id); v.integer(o.priority, 'priority', id, 0); v.range(o, 'startDate', 'endDate', id);
    const amount = v.object(o.amount, 'amount', id);
    if (amount) {
      v.enum(amount.kind, ['fixed', 'salary-percent'], 'amount.kind', id);
      if (amount.kind === 'fixed') v.cents(amount.monthlyCents, 'amount.monthlyCents', id);
      if (amount.kind === 'salary-percent') { reference(amount.salaryId, salaryById, 'amount.salaryId', id); v.rate(amount.percentBps, 'amount.percentBps', id, false); }
    }
    const account = typeof o.accountId === 'string' ? accountById.get(o.accountId) : undefined;
    if (account?.type === 'rsu') v.issue('accountId', id, 'RSU accounts receive granted stock rather than cash contributions. Remove this contribution or choose a cash investment account.');
    const payroll = account?.type === 'traditional-401k' || account?.type === 'roth-401k';
    if (payroll || o.sponsoringSalaryId !== undefined) {
      reference(o.sponsoringSalaryId, salaryById, 'sponsoringSalaryId', id);
      const sponsor = typeof o.sponsoringSalaryId === 'string' ? salaryById.get(o.sponsoringSalaryId) : undefined;
      if (account && sponsor && sponsor.ownerId !== account.ownerId) v.issue('sponsoringSalaryId', id, 'The sponsoring salary and account must belong to the same filer.');
      if (payroll && amount?.kind === 'salary-percent' && amount.salaryId !== o.sponsoringSalaryId) v.issue('amount.salaryId', id, 'Payroll percentage contributions must use the sponsoring salary.');
    }
  });
  properties.forEach(o => {
    const id = recordId(o); v.enum(o.role, ['primary', 'rental', 'primary-with-adu'], 'role', id);
    if (v.date(o.purchaseDate, 'purchaseDate', id) && forecastStart && o.purchaseDate > forecastStart) v.issue('purchaseDate', id, 'The property must exist at the forecast start.');
    v.cents(o.purchasePriceCents, 'purchasePriceCents', id); v.cents(o.downPaymentCents, 'downPaymentCents', id); v.cents(o.openingValueCents, 'openingValueCents', id);
    if (typeof o.downPaymentCents === 'number' && typeof o.purchasePriceCents === 'number' && o.downPaymentCents > o.purchasePriceCents) v.issue('downPaymentCents', id, 'Down payment cannot exceed purchase price.');
    v.rate(o.appreciationBps, 'appreciationBps', id);
    for (const area of ['primaryArea', 'aduArea']) if (o[area] !== undefined || o.role === 'primary-with-adu') {
      if (typeof o[area] !== 'number' || !Number.isFinite(o[area]) || (o[area] as number) <= 0 || (o[area] as number) > Number.MAX_SAFE_INTEGER) v.issue(area, id, 'A finite positive living area is required.');
    }
    const overrides = v.array(o.appreciationOverrides, 'appreciationOverrides', id); v.uniqueRows(overrides, row => row.year, 'appreciationOverrides', id);
    overrides.forEach((value, index) => { const row = v.object(value, `appreciationOverrides[${index}]`, id); if (!row) return; v.integer(row.year, `appreciationOverrides[${index}].year`, id, 2026, 9999); v.rate(row.rateBps, `appreciationOverrides[${index}].rateBps`, id); });
    v.array(o.loans, 'loans', id).forEach(value => {
      const loan = v.record(value, 'loans'); if (!loan) return; const loanId = recordId(loan); loanById.set(loanId, loan);
      v.cents(loan.originalPrincipalCents, 'originalPrincipalCents', loanId); v.rate(loan.aprBps, 'aprBps', loanId, false);
      v.date(loan.originationDate, 'originationDate', loanId); v.date(loan.acquisitionDate, 'acquisitionDate', loanId); v.date(loan.firstPaymentDate, 'firstPaymentDate', loanId); v.integer(loan.termMonths, 'termMonths', loanId, 1, 1200);
      if (isValidISODate(loan.originationDate) && forecastStart && loan.originationDate > forecastStart) v.issue('originationDate', loanId, 'Existing property loans must originate no later than forecast start.');
      if (isValidISODate(loan.acquisitionDate) && forecastStart && loan.acquisitionDate > forecastStart) v.issue('acquisitionDate', loanId, 'Existing loan acquisition history must be no later than forecast start.');
      if (isValidISODate(loan.originationDate) && isValidISODate(loan.firstPaymentDate) && loan.firstPaymentDate < loan.originationDate) v.issue('firstPaymentDate', loanId, 'The first payment cannot precede origination.');
      v.moneyHistory(loan.openingBalance, 'openingBalance', loanId); v.moneyHistory(loan.openingPayment, 'openingPayment', loanId);
      reference(loan.collateralPropertyId, propertyById, 'collateralPropertyId', loanId);
      const qualification = v.object(loan.proceedsQualification, 'proceedsQualification', loanId);
      if (qualification) {
        v.enum(qualification.kind, ['acquisition', 'refinance', 'cash-out', 'mixed', 'grandfathered', 'unknown'], 'proceedsQualification.kind', loanId);
        v.booleanHistory(qualification.qualifiedAcquisitionDebt, 'proceedsQualification.qualifiedAcquisitionDebt', loanId); v.moneyHistory(qualification.qualifiedPrincipalCents, 'proceedsQualification.qualifiedPrincipalCents', loanId); v.booleanHistory(qualification.historyComplete, 'proceedsQualification.historyComplete', loanId);
      }
      v.booleanHistory(loan.financingAtRiskQualification, 'financingAtRiskQualification', loanId);
      const allocations = v.array(loan.proceedsAllocations, 'proceedsAllocations', loanId);
      const total = allocations.reduce((sum: InstanceType<typeof Decimal>, value, index) => {
        const row = v.object(value, `proceedsAllocations[${index}]`, loanId); if (!row) return sum;
        const field = `proceedsAllocations[${index}]`; reference(row.propertyId, propertyById, `${field}.propertyId`, loanId); v.enum(row.use, ['personal', 'rental'], `${field}.use`, loanId); v.allocation(row.share, `${field}.share`, loanId);
        if (row.use === 'rental') reference(row.rentalId, rentalById, `${field}.rentalId`, loanId);
        const linked = typeof row.rentalId === 'string' ? rentalById.get(row.rentalId) : undefined;
        if (linked && linked.propertyId !== row.propertyId) v.issue(`${field}.rentalId`, loanId, 'The loan allocation rental must belong to its declared property.');
        const share = row.share;
        return isObject(share) && typeof share.numerator === 'number' && Number.isSafeInteger(share.numerator) && typeof share.denominator === 'number' && Number.isSafeInteger(share.denominator) && share.denominator > 0 ? sum.plus(new Decimal(share.numerator).div(share.denominator)) : sum;
      }, new Decimal(0));
      if (total.gt(1)) v.issue('proceedsAllocations', loanId, 'Loan allocation shares cannot total more than one.');
    });
  });
  for (const grant of rsuGrantIds) if (loanById.has(grant.grantId)) v.issue(grant.field, grant.accountId, 'IDs must be unique across all document records.', 'duplicate-id');
  debts.forEach(o => {
    const id = recordId(o); v.cents(o.openingBalanceCents, 'openingBalanceCents', id); v.rate(o.aprBps, 'aprBps', id, false); v.cents(o.monthlyPaymentCents, 'monthlyPaymentCents', id);
    if (!isValidYearMonth(o.firstPaymentMonth)) v.issue('firstPaymentMonth', id, 'Use a valid ISO calendar month (YYYY-MM).');
    if (o.propertyId !== undefined) reference(o.propertyId, propertyById, 'propertyId', id);
  });
  rentals.forEach(o => {
    const id = recordId(o); reference(o.propertyId, propertyById, 'propertyId', id); v.cents(o.monthlyRentCents, 'monthlyRentCents', id); v.rate(o.rentGrowthBps, 'rentGrowthBps', id); v.range(o, 'rentStartDate', 'rentEndDate', id);
    if (v.date(o.availableDate, 'availableDate', id)) {
      if (forecastStart && o.availableDate > forecastStart) v.issue('availableDate', id, 'Included rental units must already be available at the forecast start.');
      if (isValidISODate(o.rentStartDate) && o.rentStartDate < o.availableDate) v.issue('rentStartDate', id, 'Rent cannot begin before the rental unit is available.');
    }
    const property = typeof o.propertyId === 'string' ? propertyById.get(o.propertyId) : undefined;
    if (property?.role === 'primary') v.issue('propertyId', id, 'Rental units require a rental property or a primary home with an ADU.');
    if (property && isValidISODate(property.purchaseDate) && isValidISODate(o.availableDate) && o.availableDate < property.purchaseDate && o.convertedFromPersonalUse === true) v.issue('availableDate', id, 'A personal-use conversion cannot precede purchase.');
    v.booleanHistory(o.activeParticipation, 'activeParticipation', id); v.bool(o.convertedFromPersonalUse, 'convertedFromPersonalUse', id); v.moneyHistory(o.conversionBuildingFmv, 'conversionBuildingFmv', id);
    if (o.sharedAllocation !== undefined) v.allocation(o.sharedAllocation, 'sharedAllocation', id);
    const allocations = v.array(o.loanAllocations, 'loanAllocations', id); v.uniqueRows(allocations, row => row.loanId, 'loanAllocations', id);
    allocations.forEach((value, index) => { const row = v.object(value, `loanAllocations[${index}]`, id); if (!row) return; reference(row.loanId, loanById, `loanAllocations[${index}].loanId`, id); v.allocation(row.share, `loanAllocations[${index}].share`, id); v.booleanHistory(row.qualification, `loanAllocations[${index}].qualification`, id); });
    const qualifications = v.object(o.qualifications, 'qualifications', id);
    if (qualifications) for (const field of ['longTermFairMarketLease', 'noPersonalUse', 'noSubstantialTenantServices', 'ordinaryResidential', 'advancedBasisAdjustments']) v.booleanHistory(qualifications[field], `qualifications.${field}`, id);
    if (qualifications?.californiaSmallBusinessQualification !== undefined) v.booleanHistory(qualifications.californiaSmallBusinessQualification, 'qualifications.californiaSmallBusinessQualification', id);
    const history = v.object(o.taxHistory, 'taxHistory', id);
    if (history) for (const book of books) v.history(history[book], `taxHistory.${book}`, id, (value, field) => {
      const state = v.object(value, field, id); if (!state) return;
      for (const amount of ['recoveryBasisCents', 'adjustedBuildingBasisCents', 'cumulativeDepreciationCents', 'atRiskCents', 'atRiskSuspendedCents', 'passiveSuspendedCents']) v.cents(state[amount], `${field}.${amount}`, id, amount === 'atRiskCents');
      if (typeof state.adjustedBuildingBasisCents === 'number' && typeof state.recoveryBasisCents === 'number' && state.adjustedBuildingBasisCents > state.recoveryBasisCents) v.issue(`${field}.adjustedBuildingBasisCents`, id, 'Adjusted building basis cannot exceed original recovery basis for ordinary depreciation.');
      if (typeof state.cumulativeDepreciationCents === 'number' && typeof state.recoveryBasisCents === 'number' && state.cumulativeDepreciationCents > state.recoveryBasisCents) v.issue(`${field}.cumulativeDepreciationCents`, id, 'Prior depreciation cannot exceed recovery basis.');
      const vintages = v.array(state.lossVintages, `${field}.lossVintages`, id);
      vintages.forEach((value, index) => { const row = v.object(value, `${field}.lossVintages[${index}]`, id); if (!row) return; v.integer(row.year, `${field}.lossVintages[${index}].year`, id, 1, startValid ? Number(root.startYear) - 1 : 9999); v.enum(row.source, ['at-risk', 'passive'], `${field}.lossVintages[${index}].source`, id); v.cents(row.amountCents, `${field}.lossVintages[${index}].amountCents`, id); if(row.activeParticipation!==undefined) v.booleanHistory(row.activeParticipation,`${field}.lossVintages[${index}].activeParticipation`,id); if(row.qbiQualification!==undefined) v.booleanHistory(row.qbiQualification,`${field}.lossVintages[${index}].qbiQualification`,id); });
      for (const source of ['at-risk', 'passive'] as const) {
        const qualified = vintages.filter((row): row is Obj => isObject(row) && row.source === source);
        if (qualified.every(row => typeof row.amountCents === 'number' && Number.isSafeInteger(row.amountCents) && row.amountCents >= 0 && row.amountCents <= MAX_CENTS)) {
          const sum = qualified.reduce((total, row) => total.plus(Number(row.amountCents)), new Decimal(0));
          const suspended = source === 'at-risk' ? state.atRiskSuspendedCents : state.passiveSuspendedCents;
          if (typeof suspended === 'number' && !sum.eq(suspended)) v.issue(`${field}.lossVintages`, id, 'Source-qualified loss vintages must reconcile to their corresponding suspended-loss balance.');
        }
      }
    });
    const qbi = v.object(o.qbi, 'qbi', id);
    if (qbi) {
      v.booleanHistory(qbi.qualification, 'qbi.qualification', id); v.moneyHistory(qbi.wagesCents, 'qbi.wagesCents', id); v.moneyHistory(qbi.ubiaCents, 'qbi.ubiaCents', id);
      v.history(qbi.openingLossVintages, 'qbi.openingLossVintages', id, (value, field) => {
        v.array(value, field, id).forEach((value, index) => { const row = v.object(value, `${field}[${index}]`, id); if (!row) return; v.integer(row.year, `${field}[${index}].year`, id, 1, startValid ? Number(root.startYear) - 1 : 9999); v.cents(row.amountCents, `${field}[${index}].amountCents`, id); });
      });
    }
  });
  expenses.forEach(o => {
    const id = recordId(o); v.recurring(o, id); v.enum(o.use, ['personal', 'rental', 'shared'], 'use', id); v.enum(o.taxCategory, ['property-tax', 'homeowners-insurance', 'mortgage-insurance', 'repair', 'operating', 'capital', 'personal'], 'taxCategory', id);
    if (o.propertyId !== undefined || o.use === 'shared') reference(o.propertyId, propertyById, 'propertyId', id);
    if (o.rentalId !== undefined || o.use === 'rental') reference(o.rentalId, rentalById, 'rentalId', id);
    if (o.allocationOverride !== undefined) v.allocation(o.allocationOverride, 'allocationOverride', id);
    if (o.mortgageInsuranceQualification !== undefined) v.booleanHistory(o.mortgageInsuranceQualification, 'mortgageInsuranceQualification', id);
    const linked = typeof o.rentalId === 'string' ? rentalById.get(o.rentalId) : undefined;
    if (linked && o.propertyId !== undefined && linked.propertyId !== o.propertyId) v.issue('rentalId', id, 'The expense rental must belong to the referenced property.');
    if (o.use === 'personal' && o.rentalId !== undefined) v.issue('rentalId', id, 'Personal expenses cannot also be assigned to a rental.');
    if (o.use !== 'shared' && o.allocationOverride !== undefined) v.issue('allocationOverride', id, 'Allocation overrides apply to shared expenses.');
  });

  // Validate the same effective shares calculation consumes, including default/override mixtures.
  if (v.issues.length === 0) {
    const document = raw as PlanDocument;
    for (const property of document.properties) {
      const units = document.rentals.filter(unit => unit.propertyId === property.id);
      try { sharedRentalShares(property, units); }
      catch (error) { if (!(error instanceof RangeError)) throw error; v.issue('rentals.sharedAllocation', property.id, error.message); }
      for (const loan of property.loans) {
        try { allocateShares(100, loanRentalShares(loan, property, units)); }
        catch (error) { if (!(error instanceof RangeError)) throw error; v.issue('rentals.loanAllocations', loan.id, error.message); }
      }
    }
    for (const expense of document.expenses) {
      const rental = document.rentals.find(unit => unit.id === expense.rentalId);
      const property = document.properties.find(row => row.id === (expense.propertyId ?? rental?.propertyId));
      if (!property) continue;
      try { allocateExpense(expense, property, document.rentals, 100); }
      catch (error) { if (!(error instanceof RangeError)) throw error; v.issue(expense.allocationOverride ? 'allocationOverride' : 'use', expense.id, error.message); }
    }
  }

  if (root.cashFlowAllocation !== undefined) validateCashFlowAllocation(v, root.cashFlowAllocation, accountById, salaryById);

  // Aggregate checks use decimals; individually valid amounts must not overflow a subtotal.
  if (v.issues.length === 0) {
    const aggregate = (values: readonly number[], field: string): number | undefined => {
      try { return settleCents(values.reduce((sum, value) => sum.plus(value), new Decimal(0))); }
      catch { v.issue(field, v.planId, 'The aggregate exceeds the supported monetary range.', 'monetary-overflow'); return undefined; }
    };
    const accountOpenings = accounts.flatMap(o => {
      if (o.type !== 'rsu') return [Number(o.openingBalanceCents)];
      const rsu = o.rsu as Obj;
      return (rsu.grants as readonly Obj[]).map(grant => settleCents(new Decimal(Number(grant.openingHeldShares)).times(Number(rsu.currentSharePriceCents))));
    });
    const accountTotal = aggregate(accountOpenings, 'accounts.openingBalanceCents');
    const propertyTotal = aggregate(properties.map(o => Number(o.openingValueCents)), 'properties.openingValueCents');
    const debtTotal = aggregate([...debts.map(o => Number(o.openingBalanceCents)), ...[...loanById.values()].map(o => isObject(o.openingBalance) && o.openingBalance.known === true ? Number(o.openingBalance.value) : Number(o.originalPrincipalCents))], 'debts.openingBalanceCents');
    if (accountTotal !== undefined && propertyTotal !== undefined) aggregate([accountTotal, propertyTotal, Number(root.openingCashCents)], 'openingAssetsCents');
    if (accountTotal !== undefined && propertyTotal !== undefined && debtTotal !== undefined) aggregate([accountTotal, propertyTotal, Number(root.openingCashCents), -debtTotal], 'openingNetWorthCents');
    for (const owner of owners) aggregate(accounts.filter(o => o.ownerId === owner && o.type === 'traditional-ira' && isObject(o.openingIraBasis) && o.openingIraBasis.known === true).map(o => Number((o.openingIraBasis as Obj).value)), `iraBasisByOwner.${owner}`);
  }
  if (v.issues.length) return { ok: false, issues: v.issues };
  validateJsonTree(v, raw);
  if (v.issues.length) return { ok: false, issues: v.issues };
  const plan = deepFreeze(structuredClone(raw)) as ValidatedPlan;
  return { ok: true, plan, issues: checkCoverage(plan, plan.startYear).issues };
}

export function createPlan(today: ISODate, id: string): PlanDocument {
  const { year } = parseISODate(today);
  if (year < 2025 || year > 9959 || typeof id !== 'string' || id.trim() === '') throw new RangeError('A supported current calendar date and nonempty plan ID are required.');
  const unknown = { known: false } as const;
  const filer = (ownerId: string, name: string): Filer => ({ id: ownerId, name, birthDate: unknown, workplaceCoverage: unknown, coverageByYear: [], employerAssumptionsByYear: [] });
  return deepFreeze({
    schemaVersion: 1, id, revision: 0, startYear: year + 1, horizonYears: 30, openingCashCents: 0,
    household: {
      filers: [filer('owner-a', 'Filer A'), filer('owner-b', 'Filer B')], filingStatus: 'married-joint', residence: 'CA-full-year', currency: 'USD',
      coverageAnswers: { additionalIncome: unknown, additionalCredits: unknown, qualifiedDividendsOrCapitalGains: unknown, retirementDistributions: unknown, priorFederalMinimumTaxCredits: unknown, priorCaliforniaMinimumTaxCredits: unknown },
    },
    taxPolicy: { baselineYear: 2026, futureIndexGrowthBps: 0, actualStateTaxPaidByYear: [] },
    salaries: [], otherIncome: [], expenses: [], accounts: [], contributions: [], debts: [], properties: [], rentals: [],
  });
}
