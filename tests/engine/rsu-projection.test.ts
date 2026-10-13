import { describe, expect, it } from 'vitest';
import { calculateProjection } from '../../src/engine/projection';
import { loadRuleSet } from '../../src/engine/rules/registry';
import { MAX_CENTS } from '../../src/engine/money';
import type { Account, PlanDocument, RsuGrant } from '../../src/engine/model/plan';
import { makePlan, mustValidate } from '../helpers/plans';

const grant=(overrides:Partial<RsuGrant>={}):RsuGrant=>({id:'initial',name:'Initial grant',startDate:'2025-12-01',grantValueCents:12000000,grantSharePriceCents:10000,vestingMonths:12,vestingFrequency:'monthly',cliffMonths:0,withholdingBps:3000,taxTreatment:'settle-at-vest',openingHeldShares:0,openingBasis:{known:true,value:0},...overrides});
const account=(grants:readonly RsuGrant[]= [grant()],overrides:Partial<Account>={}):Account=>({id:'equity',name:'Private employer RSUs',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false},rsu:{employerId:'employer',currentSharePriceCents:10000,grants},...overrides});
const project=(overrides:Partial<PlanDocument>={})=>calculateProjection(mustValidate(makePlan({accounts:[account()],...overrides})),loadRuleSet());
function money(value:{status:string;value?:number}):number {expect(value.status).toBe('available');return value.value!;}

describe('RSU compensation, tax funding and asset integration',()=>{
  it('uses a target vest price for wages, withholding, tax funding and retained assets',()=>{
    const initial=grant({startDate:'2026-06-01',vestingMonths:1,grantValueCents:1000000});
    const equity=project({accounts:[account([initial],{rsu:{employerId:'employer',currentSharePriceCents:10000,grants:[initial],priceTargets:[{date:'2026-07-01',sharePriceCents:20000}]}})]});
    const wages=calculateProjection(mustValidate(makePlan({otherIncome:[{id:'wages',name:'Wages',amountCents:2000000,frequency:'annual',startDate:'2026-07-01',annualGrowthBps:0,classification:'wage',ownerId:'owner-a',employerId:'employer'}]})),loadRuleSet());
    const year=equity.years[0]!;
    expect(year.tax).toEqual(wages.years[0]!.tax);
    expect(money(equity.months[6]!.grossIncomeCents)).toBe(2000000);
    expect(money(year.grossIncomeCents)).toBe(2000000);
    if(year.rsu?.status!=='available')throw new Error('RSU summary missing');
    expect(year.rsu.value).toMatchObject({taxableIncomeCents:2000000,withholdingCents:600000,unvestedValueCents:0});
    expect(year.rsu.value.grants[0]).toMatchObject({heldShares:70,basis:{known:true,value:1400000}});
    expect(money(year.accountBalanceCents)).toBe(1400000);
    expect(money(year.cashFlowCents)).toBe(600000-money(year.totalTaxCents));
    expect(money(year.netWorthCents)).toBe(2000000-money(year.totalTaxCents));
  });
  it('records sourced settlement and forecast assumptions in RSU scenario provenance',()=>{
    const equity=project();
    expect(equity.years[0]!.provenance).toContainEqual(expect.objectContaining({ruleVersion:'rsu-settle-at-vest.1',sources:expect.arrayContaining(['https://www.irs.gov/pub/irs-pdf/p5992.pdf']),assumptions:expect.arrayContaining(['RSU shares are delivered at each vest; deferred settlement tax timing requires a separate model.'])}));
  });
  it('taxes RSU compensation like equal cash wages without turning delivered shares into cash',()=>{
    const equity=project();
    const wages=calculateProjection(mustValidate(makePlan({otherIncome:[{id:'wages',name:'Wages',amountCents:1000000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,classification:'wage',ownerId:'owner-a',employerId:'employer'}]})),loadRuleSet());
    const year=equity.years[0]!,cash=wages.years[0]!;
    expect(year.tax).toEqual(cash.tax);
    for(const key of ['federalIncomeTaxCents','californiaIncomeTaxCents','socialSecurityCents','medicareCents','additionalMedicareCents','sdiCents','grossIncomeCents'] as const)expect(year[key]).toEqual(cash[key]);
    expect(year.rsu?.status).toBe('available');
    if(year.rsu?.status!=='available')throw new Error('RSU summary missing');
    expect(year.rsu.value.taxableIncomeCents).toBe(12000000);
    expect(year.rsu.value.withholdingCents).toBe(3600000);
    expect(money(year.accountBalanceCents)).toBe(8400000);
    expect(money(year.eligibleContributionCents)).toBe(0);
    expect(money(year.cashFlowCents)).toBe(3600000-money(year.totalTaxCents));
    expect(money(year.netWorthCents)).toBe(12000000-money(year.totalTaxCents));
    expect(money(cash.reserveCents)-money(year.reserveCents)).toBe(8400000);
  });
  it('combines salary and both grants under one owner Social Security cap',()=>{
    const equity=project({salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:18000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],accounts:[account([grant(),grant({id:'refresh',name:'Refresher',grantValueCents:6000000})])]});
    expect(money(equity.years[0]!.socialSecurityCents)).toBe(1143900);
    expect(money(equity.years[0]!.grossIncomeCents)).toBe(36000000);
    expect(money(equity.years[0]!.additionalMedicareCents)).toBe(99000);
  });
  it('reserves taxes in vesting months for an RSU-only household',()=>{
    const equity=project({accounts:[account([grant({startDate:'2026-01-01',vestingMonths:6,vestingFrequency:'quarterly'})])]});
    expect(money(equity.months[0]!.totalTaxCents)).toBe(0);
    expect(money(equity.months[1]!.reserveCents)).toBe(0);
    expect(money(equity.months[3]!.grossIncomeCents)).toBe(6000000);
    expect(money(equity.months[6]!.grossIncomeCents)).toBe(6000000);
  });
  it('keeps historical net holdings without repeating preforecast compensation',()=>{
    const equity=project({accounts:[account([grant({startDate:'2024-01-01',vestingMonths:12,openingHeldShares:500,openingBasis:{known:true,value:4000000}})])]});
    expect(money(equity.years[0]!.grossIncomeCents)).toBe(0);
    expect(money(equity.years[0]!.accountBalanceCents)).toBe(5000000);
    expect(money(equity.years[0]!.reserveCents)).toBe(0);
  });
  it('counts only retained vested equity in net worth and leaves unvested paper value separate',()=>{
    const equity=project({accounts:[account([grant({startDate:'2026-01-01',vestingMonths:24})])]});
    const year=equity.years[0]!;
    expect(money(year.accountBalanceCents)).toBe(3850000);
    if(year.rsu?.status!=='available')throw new Error('RSU summary missing');
    expect(year.rsu.value.unvestedValueCents).toBe(6500000);
    expect(year.rsu.value.grants[0]?.heldShares).toBe(385);
    expect(year.rsu.value.grants[0]?.basis).toEqual({known:true,value:3850000});
  });
  it('preserves share schedules while deferred-settlement tax and cash are unsupported',()=>{
    const equity=project({accounts:[account([grant({taxTreatment:'deferred'})])]});
    const year=equity.years[0]!;
    expect(year.tax.status).toBe('unsupported-case');
    expect(year.coverage.completeHouseholdLiability).toBe(false);
    expect(year.cashFlowCents.status).toBe('unsupported-case');
    expect(year.rsu?.status).toBe('available');
    if(year.rsu?.status!=='available')throw new Error('RSU summary missing');
    expect(year.rsu.value.grants[0]?.unsettledShares).toBe(1200);
    expect(money(year.accountBalanceCents)).toBe(0);
    expect(equity.issues).toContainEqual(expect.objectContaining({code:'unsupported-rsu-deferred-settlement',recordId:'equity'}));
  });
  it('preserves prior-year RSU values and unrelated accounts after future price growth overflows',()=>{
    const equity=project({horizonYears:3,accounts:[account([grant({grantValueCents:100,grantSharePriceCents:100,startDate:'2024-01-01',vestingMonths:12,openingHeldShares:1})],{annualGrowthBps:10000,rsu:{employerId:'employer',currentSharePriceCents:Math.floor(MAX_CENTS/5),grants:[grant({grantValueCents:100,grantSharePriceCents:100,startDate:'2024-01-01',vestingMonths:12,openingHeldShares:1})]}}),{id:'broker',name:'Brokerage',ownerId:'owner-b',type:'taxable-brokerage',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:false}}]});
    expect(equity.years[0]!.accounts.find(a=>a.accountId==='equity')!.closingCents.status).toBe('available');
    expect(equity.years[2]!.accounts.find(a=>a.accountId==='equity')!.closingCents.status).toBe('unsupported-case');
    expect(money(equity.years[2]!.accounts.find(a=>a.accountId==='broker')!.closingCents)).toBe(10000);
  });
  it('keeps cash and wages independent of an overflowing unvested paper-value total',()=>{
    const initial=grant({grantValueCents:60000000000000,grantSharePriceCents:1,startDate:'2026-01-01',vestingMonths:48,cliffMonths:48,vestingFrequency:'annual'});
    const first=account([initial],{rsu:{employerId:'employer',currentSharePriceCents:1,grants:[initial]}});
    const second={...first,id:'second-equity',rsu:{...first.rsu!,grants:[{...initial,id:'second-grant'}]}};
    const result=project({openingCashCents:10000,accounts:[first,second]});
    expect(result.months[0]!.rsu?.status).toBe('unsupported-case');
    expect(result.years[0]!.tax.status).toBe('available');
    expect(money(result.months[0]!.grossIncomeCents)).toBe(0);
    expect(money(result.months[0]!.cashFlowCents)).toBe(0);
    expect(money(result.months[0]!.reserveCents)).toBe(10000);
    expect(money(result.years[0]!.netWorthCents)).toBe(10000);
    expect(result.rsuSchedules?.every(s=>s.schedule.status==='available')).toBe(true);
  });
  it('keeps zero compensation and held assets when one grant paper valuation overflows',()=>{
    const initial=grant({grantValueCents:60000000000000,grantSharePriceCents:1,startDate:'2026-01-01',vestingMonths:48,cliffMonths:48,vestingFrequency:'annual'});
    const result=project({openingCashCents:10000,accounts:[account([initial],{rsu:{employerId:'employer',currentSharePriceCents:2,grants:[initial]}})]});
    expect(result.months[0]!.rsu?.status).toBe('unsupported-case');
    expect(result.years[0]!.tax.status).toBe('available');
    expect(money(result.months[0]!.grossIncomeCents)).toBe(0);
    expect(money(result.months[0]!.cashFlowCents)).toBe(0);
    expect(money(result.months[0]!.reserveCents)).toBe(10000);
    expect(money(result.years[0]!.accountBalanceCents)).toBe(0);
    expect(money(result.years[0]!.netWorthCents)).toBe(10000);
    expect(result.rsuSchedules?.every(s=>s.schedule.status==='available')).toBe(true);
  });
  it('does not reject valid annual tax flows because unreported lifetime vesting exceeds the money range',()=>{
    const initial=grant({grantValueCents:25000000000000,grantSharePriceCents:1,startDate:'2025-12-01',vestingMonths:48,vestingFrequency:'annual',withholdingBps:10000});
    const result=project({horizonYears:4,accounts:[account([initial],{annualGrowthBps:10000,rsu:{employerId:'employer',currentSharePriceCents:1,grants:[initial]}})]});
    expect(result.years.map(y=>y.tax.status)).toEqual(Array(4).fill('available'));
    // Carry grant-level fractional cents across months, including prior annual vests.
    expect(result.years.map(y=>money(y.grossIncomeCents))).toEqual([11798428908521,23596857817043,47193715634084,94387431268170]);
    expect(money(result.years[3]!.accountBalanceCents)).toBe(0);
    expect(result.years[3]!.reserveCents.status).toBe('available');
    expect(result.rsuSchedules?.every(s=>s.schedule.status==='available')).toBe(true);
  });
});
