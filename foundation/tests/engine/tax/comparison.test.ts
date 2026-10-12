import { describe, expect, it } from 'vitest';
import { resolveHouseholdYear } from '../../../src/engine/tax/comparison';
import { resolveCashYear } from '../../../src/engine/cash/income';
import { requestContributions } from '../../../src/engine/cash/contribution-requests';
import { buildPropertyFacts } from '../../../src/engine/property/facts';
import { calculateLoanSchedule } from '../../../src/engine/property/loans';
import { initialTaxState } from '../../../src/engine/model/tax-state';
import { loadRuleSet } from '../../../src/engine/rules/registry';
import { resolveYearRules } from '../../../src/engine/rules/projection';
import { makePlan, mustValidate } from '../../helpers/plans';
import type { PlanDocument } from '../../../src/engine/model/plan';

function resolve(doc:PlanDocument){
  const p=mustValidate(doc),cash=resolveCashYear(p,p.startYear),opening=initialTaxState(p);
  const rules=resolveYearRules(loadRuleSet(),p.startYear,p.taxPolicy);if(rules.status!=='available')throw new Error('Missing input rules');
  const loans=[...p.debts.map(d=>calculateLoanSchedule(d,p.startYear,p.horizonYears)),...p.properties.flatMap(property=>property.loans.map(l=>calculateLoanSchedule(l,p.startYear,p.horizonYears)))];
  return resolveHouseholdYear(p,cash,requestContributions(p,cash),buildPropertyFacts(p,cash,loans,opening,rules.value),loans,opening,rules.value);
}
function wages(cents:number,propertyTaxCents=0):PlanDocument {
  return makePlan({salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:cents,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],...(propertyTaxCents?{properties:[{id:'home',name:'Home',role:'primary' as const,purchaseDate:'2020-01-01',purchasePriceCents:50000000,downPaymentCents:50000000,openingValueCents:50000000,appreciationBps:0,appreciationOverrides:[],loans:[]}],expenses:[{id:'property-tax',name:'Property tax paid',propertyId:'home',amountCents:propertyTaxCents,frequency:'annual' as const,startDate:'2026-01-01',annualGrowthBps:0,use:'personal' as const,taxCategory:'property-tax' as const}]}:{})});
}
describe('coupled legal deduction choices',()=>{
  it('finalizes each taxable request once without doubling the reserve transfer',()=>{
    const p=makePlan({accounts:[{id:'brokerage',name:'Brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:20000}}]});
    const r=resolve(p);
    expect(r.contributions.filter(c=>c.accountId==='brokerage')).toHaveLength(12);
    expect(r.contributions.reduce((s,c)=>s+(c.eligibleCents.status==='available'?c.eligibleCents.value:0),0)).toBe(240000);
  });
  it('ties prefer standard treatment in both jurisdictions',()=>{
    const r=resolve(makePlan());expect(r.tax.status).toBe('available');
    if(r.tax.status!=='available')throw new Error(JSON.stringify(r.tax));
    expect(r.tax.value.selectedMethods).toEqual({federal:'standard',california:'standard'});
    expect(r.tax.value.combinedIncomeTaxCents).toBe(0);
    expect(r.candidates).toHaveLength(4);
  });
  it('selects federal standard and California itemized by resulting liability',()=>{
    const r=resolve(wages(8000000,1300000));if(r.tax.status!=='available')throw new Error(JSON.stringify(r.tax));
    // IRS MFJ midpoint $47,825 -> $5,243. FTB midpoint $67,000 -> $1,365 less $316 credit.
    expect(r.tax.value.selectedMethods).toEqual({federal:'standard',california:'itemized'});
    expect(r.tax.value.federal.totalCents).toBe(524300);
    expect(r.tax.value.california.totalCents).toBe(104900);
    expect(r.tax.value.combinedIncomeTaxCents).toBe(629200);
    expect(r.tax.value.statePaid).toMatchObject({californiaIncomeTaxPaidCents:104900,sdiPaidCents:104000,source:'prospective-assumption'});
    expect(r.tax.value.statePaid.provenance?.status).toBe('provisional');
    expect(r.tax.value.statePaid.provenance?.sources).toEqual(expect.arrayContaining([...r.tax.value.california.provenance.sources]));
  });
  it('selects federal itemized and California standard with independently coupled paid tax',()=>{
    const r=resolve(wages(40000000));if(r.tax.status!=='available')throw new Error(JSON.stringify(r.tax));
    // FTB $388,200 -> $28,738 before $316 credit. SALT=$28,422+$5,200; IRS taxable=$366,378.
    expect(r.tax.value.selectedMethods).toEqual({federal:'itemized',california:'standard'});
    expect(r.tax.value.federal.totalCents).toBe(7312700);
    expect(r.tax.value.california.totalCents).toBe(2842200);
    expect(r.tax.value.combinedIncomeTaxCents).toBe(10154900);
    expect(r.payroll.annual.totalCents).toBe(2378900);
  });
  it('state-payment overrides change deductions while preserving assessed state tax and payroll',()=>{
    const p=wages(40000000),normal=resolve(p);
    const override=resolve({...p,taxPolicy:{...p.taxPolicy,actualStateTaxPaidByYear:[{year:2026,californiaIncomeTaxPaidCents:0,sdiPaidCents:0}]}});
    if(override.tax.status!=='available'||normal.tax.status!=='available')throw new Error('Unavailable fixture');
    expect(override.tax.value.selectedMethods).toEqual({federal:'standard',california:'standard'});
    expect(override.tax.value.federal.totalCents).toBe(7346800);
    expect(override.tax.value.california.totalCents).toBe(normal.tax.value.california.totalCents);
    expect(override.payroll).toEqual(normal.payroll);
    expect(override.tax.value.statePaid.source).toBe('actual-override');
  });
  it('reported outside-scope material tax inputs prevent a fabricated total',()=>{
    const p=makePlan();const r=resolve({...p,household:{...p.household,coverageAnswers:{...p.household.coverageAnswers,additionalIncome:{known:true,value:true}}}});
    expect(r.tax.status).toBe('unsupported-case');expect(r.tax).not.toHaveProperty('value');
    expect(r.payroll.annual.totalCents).toBe(0);
  });
});
