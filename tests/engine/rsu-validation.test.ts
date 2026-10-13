import { describe, expect, it } from 'vitest';
import type { Account, RsuGrant } from '../../src/engine/model/plan';
import { MAX_CENTS } from '../../src/engine/money';
import { validatePlan } from '../../src/engine/validation';
import { makePlan } from '../helpers/plans';

const grant: RsuGrant = {
  id: 'grant-a', name: 'Initial award', startDate: '2024-01-31', grantValueCents: 12000000,
  grantSharePriceCents: 10000, vestingMonths: 48, vestingFrequency: 'quarterly', cliffMonths: 12,
  withholdingBps: 3500, taxTreatment: 'settle-at-vest', openingHeldShares: 100.123456,
  openingBasis: { known: false },
};
const account: Account = {
  id: 'rsu-account', name: 'Employer equity', ownerId: 'owner-a', type: 'rsu',
  openingBalanceCents: 0, annualGrowthBps: 500, openingIraBasis: { known: false },
  rsu: { employerId: 'employer-a', currentSharePriceCents: 15000, grants: [grant] },
};
const withGrant = (changes: Record<string, unknown>) => ({ ...account, rsu: { ...account.rsu!, grants: [{ ...grant, ...changes }] } });
function rejected(value: unknown, field: string, recordId = account.id, code?: string): void {
  const result = validatePlan(makePlan({ accounts: [value as Account] }));
  expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ recordId, field, severity: 'error', ...(code ? { code } : {}) }));
}

describe('RSU account and nested grant validation', () => {
  const withTargets = (priceTargets: unknown) => ({ ...account, rsu: { ...account.rsu!, priceTargets } }) as Account;
  it('preserves valid ordered price targets and freezes their saved inputs', () => {
    const priceTargets = [
      { date: '2030-01-01', sharePriceCents: 17000 },
      { date: '2031-06-15', sharePriceCents: 16000 },
    ];
    const result = validatePlan(makePlan({ accounts: [withTargets(priceTargets)] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const saved = result.plan.accounts[0]?.rsu as unknown as { priceTargets: unknown[] };
    expect(saved.priceTargets).toEqual(priceTargets);
    expect(Object.isFrozen(saved.priceTargets[0])).toBe(true);
  });
  it('accepts an empty target list for the constant-growth path', () => {
    expect(validatePlan(makePlan({ accounts: [withTargets([])] })).ok).toBe(true);
  });
  it.each([null, {}, 'targets'])('rejects a non-array price target list: %s', priceTargets => {
    rejected(withTargets(priceTargets), 'rsu.priceTargets');
  });
  it.each([null, 'target', 17000])('rejects a non-object target: %s', target => {
    rejected(withTargets([target]), 'rsu.priceTargets[0]');
  });
  it.each(['2030-02-29', '2030-01', '', '2026-01-01', '2025-12-31'])('rejects invalid or nonfuture target date: %s', date => {
    rejected(withTargets([{ date, sharePriceCents: 17000 }]), 'rsu.priceTargets[0].date');
  });
  it.each(['2030-01-01', '2029-12-31'])('rejects duplicate or unordered target dates: %s', date => {
    rejected(withTargets([
      { date: '2030-01-01', sharePriceCents: 17000 },
      { date, sharePriceCents: 18000 },
    ]), 'rsu.priceTargets[1].date');
  });
  it.each([0, -1, 0.5, MAX_CENTS + 1, '17000'])('rejects an invalid target share price: %s', sharePriceCents => {
    rejected(withTargets([{ date: '2030-01-01', sharePriceCents }]), 'rsu.priceTargets[0].sharePriceCents');
  });
  it('accepts multiple grants with independent terms and preserves explicit unknown basis', () => {
    const result = validatePlan(makePlan({ accounts: [{ ...account, rsu: { ...account.rsu!, grants: [grant, { ...grant, id: 'refresher', name: 'Refresher', startDate: '2027-02-01', vestingMonths: 14, cliffMonths: 0, vestingFrequency: 'monthly', awardedShares: 99.123456, openingHeldShares: 0, openingBasis: { known: true, value: 0 } }] } }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.plan.accounts[0]?.rsu?.grants[0]?.openingBasis).toEqual({ known: false });
    expect(Object.isFrozen(result.plan.accounts[0]?.rsu?.grants[0])).toBe(true);
  });
  it.each(['monthly', 'quarterly', 'annual'])('accepts %s vesting', vestingFrequency => {
    expect(validatePlan(makePlan({ accounts: [withGrant({ vestingFrequency })] })).ok).toBe(true);
  });
  it.each([0, -1, 0.5, MAX_CENTS + 1, Infinity])('rejects invalid current price %s', currentSharePriceCents => {
    rejected({ ...account, rsu: { ...account.rsu, currentSharePriceCents } }, 'rsu.currentSharePriceCents');
  });
  it.each(['grantValueCents', 'grantSharePriceCents'])('requires positive cents for %s', field => {
    rejected(withGrant({ [field]: 0 }), `rsu.grants[0].${field}`);
    rejected(withGrant({ [field]: 0.5 }), `rsu.grants[0].${field}`);
    rejected(withGrant({ [field]: MAX_CENTS + 1 }), `rsu.grants[0].${field}`);
  });
  it.each([0, 601, 1.5])('rejects unsupported term %s', vestingMonths => {
    rejected(withGrant({ vestingMonths }), 'rsu.grants[0].vestingMonths');
  });
  it.each([-1, 49, 0.5])('rejects invalid cliff %s', cliffMonths => {
    rejected(withGrant({ cliffMonths }), 'rsu.grants[0].cliffMonths');
  });
  it.each([-1, 10001, 0.5])('rejects invalid withholding percentage %s', withholdingBps => {
    rejected(withGrant({ withholdingBps }), 'rsu.grants[0].withholdingBps');
  });
  it.each([0, 10000])('accepts withholding boundary %s', withholdingBps => {
    expect(validatePlan(makePlan({ accounts: [withGrant({ withholdingBps })] })).ok).toBe(true);
  });
  it.each([0, -1, 1.1234567, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid actual awarded shares %s', awardedShares => {
    rejected(withGrant({ awardedShares }), 'rsu.grants[0].awardedShares');
  });
  it.each([-1, 1.1234567, Infinity, '1.5'])('rejects invalid opening shares %s', openingHeldShares => {
    rejected(withGrant({ openingHeldShares }), 'rsu.grants[0].openingHeldShares');
  });
  it('rejects opening holdings above the actual award override', () => {
    rejected(withGrant({ awardedShares: 100, openingHeldShares: 101 }), 'rsu.grants[0].openingHeldShares');
  });
  it('rejects opening holdings above the units derived from award value and price', () => {
    rejected(withGrant({ openingHeldShares: 1200.000001 }), 'rsu.grants[0].openingHeldShares');
  });
  it('rejects opening holdings on a grant starting at or after forecast start', () => {
    rejected(withGrant({ startDate: '2026-01-01', openingHeldShares: 1 }), 'rsu.grants[0].openingHeldShares');
    rejected(withGrant({ startDate: '2027-01-01', openingHeldShares: 1 }), 'rsu.grants[0].openingHeldShares');
  });
  it.each([
    { name: 'an unexpired cliff', startDate: '2025-07-01', vestingMonths: 48, vestingFrequency: 'monthly', cliffMonths: 12, awardedShares: 48, maximumHeld: 0, invalidHeld: 1 },
    { name: 'a monthly vest on forecast January 1', startDate: '2025-01-01', vestingMonths: 48, vestingFrequency: 'monthly', cliffMonths: 0, awardedShares: 48, maximumHeld: 11, invalidHeld: 12 },
    { name: 'a quarterly schedule anchored to January 31', startDate: '2025-01-31', vestingMonths: 14, vestingFrequency: 'quarterly', cliffMonths: 0, awardedShares: 14, maximumHeld: 9, invalidHeld: 10 },
    { name: 'a completed cliff followed by monthly vests', startDate: '2024-01-01', vestingMonths: 48, vestingFrequency: 'monthly', cliffMonths: 12, awardedShares: 48, maximumHeld: 23, invalidHeld: 24 },
    { name: 'a completed final partial quarterly interval', startDate: '2024-07-31', vestingMonths: 14, vestingFrequency: 'quarterly', cliffMonths: 0, awardedShares: 14, maximumHeld: 14, invalidHeld: 14.000001 },
  ])('bounds actual opening holdings by service vesting before forecast start: $name', ({ name: _name, maximumHeld, invalidHeld, ...schedule }) => {
    expect(validatePlan(makePlan({ accounts: [withGrant({ ...schedule, openingHeldShares: maximumHeld })] })).ok).toBe(true);
    rejected(withGrant({ ...schedule, openingHeldShares: invalidHeld }), 'rsu.grants[0].openingHeldShares');
  });
  it('compares the precise cumulative award quantity rather than rounded event share totals', () => {
    const schedule = { startDate: '2025-08-31', vestingMonths: 3, vestingFrequency: 'monthly', cliffMonths: 0, awardedShares: 1, openingHeldShares: 1 };
    expect(validatePlan(makePlan({ accounts: [withGrant(schedule)] })).ok).toBe(true);
  });
  it('allows the default derived share count to have more than six decimals', () => {
    expect(validatePlan(makePlan({ accounts: [withGrant({ grantValueCents: 100, grantSharePriceCents: 3, openingHeldShares: 0 })] })).ok).toBe(true);
  });
  it('rejects a vesting end outside the supported calendar', () => {
    rejected(withGrant({ startDate: '9999-12-31', vestingMonths: 1, cliffMonths: 0, openingHeldShares: 0 }), 'rsu.grants[0].vestingMonths');
  });
  it('requires valid grant dates, frequency and settlement treatment', () => {
    rejected(withGrant({ startDate: '2026-02-29' }), 'rsu.grants[0].startDate');
    rejected(withGrant({ vestingFrequency: 'weekly' }), 'rsu.grants[0].vestingFrequency');
    rejected(withGrant({ taxTreatment: 'unknown' }), 'rsu.grants[0].taxTreatment');
    expect(validatePlan(makePlan({ accounts: [withGrant({ taxTreatment: 'deferred', openingHeldShares: 0 })] })).ok).toBe(true);
  });
  it('does not call the scheduler with an invalid nonstring frequency', () => {
    const invalid = withGrant({ vestingFrequency: { toString: () => { throw new Error('Do not coerce unvalidated frequency'); } } });
    expect(() => rejected(invalid, 'rsu.grants[0].vestingFrequency')).not.toThrow();
  });
  it('rejects deferred opening holdings whose prior delivery and withholding history cannot be inferred', () => {
    const deferred = withGrant({ startDate: '2020-01-01', awardedShares: 120, vestingMonths: 12, cliffMonths: 0, taxTreatment: 'deferred', openingHeldShares: 90 });
    const result = validatePlan(makePlan({ accounts: [deferred] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ recordId: account.id, field: 'rsu.grants[0].openingHeldShares', explanation: expect.stringMatching(/prior settlement history/i) }));
  });
  it('validates opening basis history without inventing a value', () => {
    rejected(withGrant({ openingBasis: { known: true } }), 'rsu.grants[0].openingBasis.value');
    rejected(withGrant({ openingBasis: { known: false, value: 0 } }), 'rsu.grants[0].openingBasis');
  });
  it('requires named globally unique grants and routes errors to their parent account', () => {
    rejected(withGrant({ id: account.id }), 'rsu.grants[0].id', account.id, 'duplicate-id');
    rejected(withGrant({ id: 'owner-a' }), 'rsu.grants[0].id', account.id, 'duplicate-id');
    rejected(withGrant({ id: 'synthetic-plan' }), 'rsu.grants[0].id', account.id, 'duplicate-id');
    rejected(withGrant({ name: '' }), 'rsu.grants[0].name');
    rejected({ ...account, rsu: { ...account.rsu!, grants: [grant, grant] } }, 'rsu.grants[1].id', account.id, 'duplicate-id');
  });
  it('routes a grant collision with a nested property loan to the grant input', () => {
    const result = validatePlan(makePlan({ accounts: [account], properties: [{
      id: 'home', name: 'Home', role: 'primary', purchaseDate: '2020-01-01', purchasePriceCents: 10000000, downPaymentCents: 2000000,
      openingValueCents: 10000000, appreciationBps: 0, appreciationOverrides: [], loans: [{
        id: grant.id, name: 'Mortgage', originalPrincipalCents: 8000000, aprBps: 400, originationDate: '2020-01-01', acquisitionDate: '2020-01-01',
        termMonths: 360, firstPaymentDate: '2020-02-01', openingBalance: { known: true, value: 7000000 }, openingPayment: { known: true, value: 40000 },
        collateralPropertyId: 'home', proceedsQualification: { kind: 'acquisition', qualifiedAcquisitionDebt: { known: true, value: true },
          qualifiedPrincipalCents: { known: true, value: 8000000 }, historyComplete: { known: true, value: true } },
        proceedsAllocations: [{ propertyId: 'home', use: 'personal', share: { numerator: 1, denominator: 1 } }], financingAtRiskQualification: { known: true, value: true },
      }],
    }] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ recordId: account.id, field: 'rsu.grants[0].id', code: 'duplicate-id' }));
  });
  it('requires RSU data, a valid owner and an employer', () => {
    rejected({ ...account, rsu: undefined }, 'rsu');
    rejected({ ...account, ownerId: 'missing' }, 'ownerId');
    rejected({ ...account, rsu: { ...account.rsu, employerId: '' } }, 'rsu.employerId');
    rejected({ ...account, rsu: { ...account.rsu, grants: null } }, 'rsu.grants');
  });
  it('requires zero ordinary opening balance and unknown IRA basis for RSUs', () => {
    rejected({ ...account, openingBalanceCents: 1 }, 'openingBalanceCents');
    rejected({ ...account, openingIraBasis: { known: true, value: 0 } }, 'openingIraBasis');
  });
  it('forbids RSU data on ordinary account types', () => {
    rejected({ ...account, type: 'taxable-brokerage' }, 'rsu');
  });
  it('rejects generic contributions to an RSU account', () => {
    const result = validatePlan(makePlan({ accounts: [account], contributions: [{ id: 'deposit', accountId: account.id, priority: 1, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 1000 } }] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ recordId: 'deposit', field: 'accountId', severity: 'error' }));
  });
  it('rejects opening held value outside the monetary range', () => {
    rejected({ ...account, rsu: { ...account.rsu!, currentSharePriceCents: MAX_CENTS, grants: [{ ...grant, openingHeldShares: 2 }] } }, 'rsu.grants[0].openingHeldShares', account.id, 'monetary-overflow');
  });
  it('includes independently valid RSU opening holdings in aggregate asset range checks', () => {
    const rsu = { ...account, rsu: { ...account.rsu!, currentSharePriceCents: MAX_CENTS, grants: [{ ...grant, openingHeldShares: 1 }] } };
    const ordinary: Account = { id: 'broker', name: 'Broker', ownerId: 'owner-b', type: 'taxable-brokerage', openingBalanceCents: 1, annualGrowthBps: 0, openingIraBasis: { known: false } };
    const result = validatePlan(makePlan({ accounts: [rsu, ordinary] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ recordId: 'synthetic-plan', field: 'accounts.openingBalanceCents', code: 'monetary-overflow' }));
  });
  it('rejects an account subtotal overflow across multiple grants without throwing', () => {
    const overflowing = { ...account, rsu: { ...account.rsu!, currentSharePriceCents: MAX_CENTS, grants: [{ ...grant, openingHeldShares: 1 }, { ...grant, id: 'grant-b', openingHeldShares: 1 }] } };
    let result: ReturnType<typeof validatePlan> | undefined;
    expect(() => { result = validatePlan(makePlan({ accounts: [overflowing] })); }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.issues).toContainEqual(expect.objectContaining({ code: 'monetary-overflow', field: 'accounts.openingBalanceCents' }));
  });
});
