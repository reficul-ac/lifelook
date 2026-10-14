import {describe,expect,it} from 'vitest';
import {resolveCashYear} from '../../src/engine/cash/income';
import {aduValue,makeAduPlan,makeAduTreatments} from '../helpers/adu';
import {mustValidate,makePlan} from '../helpers/plans';
import type {AduProject} from '../../src/engine/model/plan';
async function context(year:number,overrides:Partial<AduProject>={}){const {resolveAduYear}=await import('../../src/engine/property/adu-lifecycle');return resolveAduYear(mustValidate(makeAduPlan({},overrides)),year);}
describe('monthly project cash and distinct lifecycle dates',()=>{
  it('posts stages once and leaves entered-zero tax payments independent of estimates',async()=>{
    const ctx=await context(2027),p=ctx.projects[0]!;expect(p.months).toHaveLength(12);expect(p.months[6]!.constructionCostCents).toBe(30_000_000);expect(p.months.filter(m=>m.constructionCostCents!==0)).toHaveLength(1);expect(p.months.every(m=>m.projectTaxPaidCents===0)).toBe(true);expect(p.months[5]!.marketValueComplete).toBe(false);expect(p.months[6]!.completionValueAddedCents).toEqual({status:'available',value:22_000_000});expect(p.months[7]!.completionValueAddedCents).toEqual({status:'available',value:0});expect(ctx.cashComplete).toEqual({status:'available',value:true});
    const cash=resolveCashYear(mustValidate(makeAduPlan()),2027);expect(cash.months[6]!.expensesCents).toBe(30_000_000);expect(cash.annual.expensesCents).toBe(30_000_000);expect(cash.streams.find(s=>s.id==='building-stage')).toMatchObject({kind:'expense',propertyId:'home',aduProjectId:'adu-project'});
  });
  it('keeps preproject periods independent of unknown future tax qualifications and schedules',async()=>{
    const p=makeAduPlan().properties[0]!.aduProject!;const ctx=await context(2026,{taxQualifications:{...p.taxQualifications,federal:{known:false}},propertyTax:{...p.propertyTax,paymentYears:[]}});expect(ctx.cashComplete).toEqual({status:'available',value:true});expect(ctx.projects[0]!.months.every(m=>m.marketValueComplete&&m.constructionCostCents===0)).toBe(true);
  });
  it('marks a relevant missing payment schedule unknown while retaining its known individual rows',async()=>{
    const p=makeAduPlan().properties[0]!.aduProject!;const payment={id:'tax-paid',month:'2027-11',amountCents:264_000,kind:'supplemental' as const,treatments:makeAduTreatments(264_000,'currentDeductionCents')};const ctx=await context(2027,{propertyTax:{...p.propertyTax,paymentYears:[{year:2027,complete:{known:false},payments:[payment]}]}});expect(ctx.cashComplete.status).toBe('needs-data');expect(ctx.projects[0]!.months[10]!.projectTaxPaidCents).toBe(264_000);
    const cash=resolveCashYear(mustValidate(makeAduPlan({},{propertyTax:{...p.propertyTax,paymentYears:[{year:2027,complete:{known:false},payments:[payment]}]}})),2027);expect(cash.months[10]!.expensesCents).toBe(264_000);expect(cash.streams.filter(s=>s.id==='tax-paid')).toHaveLength(1);
  });
  it('requires original-bill overlap confirmation when the project is relevant',async()=>{const p=makeAduPlan().properties[0]!.aduProject!;expect((await context(2027,{propertyTax:{...p.propertyTax,originalExpenseExcludesAdu:{known:false}}})).cashComplete.status).toBe('needs-data');});
  it('retains known cash when a tax-only basis split is unknown',async()=>{const p=makeAduPlan().properties[0]!.aduProject!;expect((await context(2027,{costs:[{...p.costs[0]!,treatments:{...p.costs[0]!.treatments,federal:{known:false}}}]})).cashComplete).toEqual({status:'available',value:true});});
  it('omits project effects when no project exists',async()=>{const {resolveAduYear}=await import('../../src/engine/property/adu-lifecycle');expect(resolveAduYear(mustValidate(makePlan()),2026)).toEqual({year:2026,projects:[],cashComplete:{status:'available',value:true}});});
  it('reduces expected collected rent by vacancy only after the separately entered lease begins',()=>{
    const p=makeAduPlan();const v=mustValidate({...p,rentals:[{...p.rentals[0]!,monthlyRentCents:200_000,vacancyBps:1000}]});const cash=resolveCashYear(v,2027);expect(cash.months[7]!.rentCents).toBe(0);expect(cash.months[8]!.rentCents).toBe(180_000);expect(cash.annual.rentCents).toBe(720_000);
  });
  it('settles partial vacancy-adjusted rent cumulatively with entered rent growth',()=>{
    const p=makeAduPlan(),unit={...p.rentals[0]!,rentStartDate:'2027-09-16',monthlyRentCents:200_000,rentGrowthBps:1000,vacancyBps:1000};const v=mustValidate({...p,rentals:[unit]});expect(resolveCashYear(v,2027).annual.rentCents).toBe(630_000);expect(resolveCashYear(v,2028).annual.rentCents).toBe(2_376_000);
  });
  it('conserves fractional vacancy cents over the year instead of rounding each month separately',()=>{
    const p=makeAduPlan();const valid=mustValidate({...p,rentals:[{...p.rentals[0]!,monthlyRentCents:101,vacancyBps:1000}]});const cash=resolveCashYear(valid,2028);
    expect(cash.annual.rentCents).toBe(1091);expect(cash.months.map(m=>m.rentCents)).toEqual([91,91,91,91,91,90,91,91,91,91,91,91]);
  });

});
