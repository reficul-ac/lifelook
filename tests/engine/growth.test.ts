import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/engine/money';
import { effectiveMonthlyRate, growMonth, propertyRate, type GrowthMonth } from '../../src/engine/growth';
import type { Property } from '../../src/engine/model/plan';
import { loadReferences } from '../helpers/references';

function compoundYear(opening: number, annualBps: number, deposits: readonly number[]): readonly GrowthMonth[] {
  let exact = new Decimal(opening);
  return deposits.map(deposit => { const m = growMonth(exact,annualBps,deposit); exact=m.closingExact; return m; });
}
describe('effective annual growth', () => {
  it.each(loadReferences<{openingCents:number;annualBps:number;monthlyDepositCents:number;months:number},{closingCents:number;growthCents:number}>('growth'))('$id matches independent closed form',c=>{
    const months=compoundYear(c.input.openingCents,c.input.annualBps,Array(c.input.months).fill(c.input.monthlyDepositCents));
    expect({closingCents:months.at(-1)!.closingCents,growthCents:months.reduce((s,m)=>s+m.growthCents,0)}).toEqual(c.expected);
  });
  it('reports exactly the specified 7 percent example', () => {
    const months=compoundYear(1000000,700,Array(12).fill(0));
    expect(months[11]!.closingCents).toBe(1070000);
    expect(months.reduce((s,m)=>s+m.growthCents,0)).toBe(70000);
  });
  it('deposits at month end before future growth', () => {
    const m=growMonth(new Decimal(0),700,10000);
    expect(m.closingCents).toBe(10000);expect(m.growthCents).toBe(0);
    expect(compoundYear(0,0,Array(12).fill(10000))[11]!.closingCents).toBe(120000);
  });
  it('preserves negative effective returns and fractional monthly balances', () => {
    const months=compoundYear(1000000,-5000,Array(12).fill(0));
    expect(months[11]!.closingCents).toBe(500000);
    expect(months.reduce((s,m)=>s+m.growthCents,0)).toBe(-500000);
    expect(effectiveMonthlyRate(1200).toNumber()).toBeCloseTo(0.009488792934583046,14);
  });
  it('reconciles reported monthly growth after deposits', () => {
    for(const m of compoundYear(17,700,Array(12).fill(101)))expect(m.closingCents-m.openingCents-m.depositsCents).toBe(m.growthCents);
  });
  it('agrees with independent forty-year annual closed form', () => {
    const months=compoundYear(1000000,700,Array(480).fill(0));
    expect(months[479]!.closingCents).toBe(14974458);
  });
  it('rejects projected overflow', () => {
    expect(()=>growMonth(new Decimal('99999999999999'),100000,0)).toThrow('monetary-overflow');
  });
  it.each([-10000,100001,NaN])('rejects unsupported effective rate %s', rate=>{
    expect(()=>effectiveMonthlyRate(rate)).toThrow();
  });
  it('uses per-property calendar-year overrides without changing the property', () => {
    const p:Property={id:'home',name:'Home',role:'primary',purchaseDate:'2020-01-01',purchasePriceCents:1000000,downPaymentCents:1000000,openingValueCents:1000000,appreciationBps:300,appreciationOverrides:[{year:2027,rateBps:-100}],loans:[]};
    Object.freeze(p);
    expect(propertyRate(p,2026)).toBe(300);expect(propertyRate(p,2027)).toBe(-100);expect(propertyRate(p,2028)).toBe(300);
  });
});
