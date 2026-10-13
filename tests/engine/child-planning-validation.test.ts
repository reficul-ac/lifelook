import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/engine';
import { makePlan } from '../helpers/plans';

const child = { id: 'child-a', name: 'First child', birthMonth: '2028-07', includeAge18: false };

describe('child planning input validation', () => {
  it('accepts old plans without children and past or future birth months', () => {
    expect(validatePlan(makePlan()).ok).toBe(true);
    for (const birthMonth of ['2000-02', '2028-07', '9999-12']) {
      expect(validatePlan({ ...makePlan(), children: [{ ...child, birthMonth }] }).ok).toBe(true);
    }
  });
  it.each([
    ['birthMonth', '2028-13'], ['birthMonth', '2028-7'], ['birthMonth', '2028-07-01'],
    ['birthMonth', '0000-01'], ['birthMonth', ''], ['name', ''],
    ['includeAge18', 'false'], ['includeAge18', undefined],
  ])('rejects invalid %s: %s instead of silently ignoring the child', (field, value) => {
    const result = validatePlan({ ...makePlan(), children: [{ ...child, [field]: value }] });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ recordId: 'child-a', field }));
  });
  it.each([null, {}, 'child'])('rejects a malformed children collection: %s', children => {
    expect(validatePlan({ ...makePlan(), children }).ok).toBe(false);
  });
  it('rejects child identities duplicated across children or other records', () => {
    const repeated = validatePlan({ ...makePlan(), children: [child, child] });
    expect(repeated.ok).toBe(false);
    expect(repeated.issues).toContainEqual(expect.objectContaining({ code: 'duplicate-id', recordId: 'child-a' }));
    expect(validatePlan({ ...makePlan(), children: [{ ...child, id: 'owner-a' }] }).ok).toBe(false);
  });
});
