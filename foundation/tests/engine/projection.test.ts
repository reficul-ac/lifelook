import { describe, expect, it } from 'vitest';
import { allocateAnnualTax, calculateProjection } from '../../src/engine/projection';
import { MAX_CENTS } from '../../src/engine/money';
import { makePlan, mustValidate } from '../helpers/plans';
import { loadRuleSet } from '../../src/engine/rules/registry';
import type { PlanDocument } from '../../src/engine/model/plan';
import fixtureRows from '../../fixtures/math/projection.json';
import { numericProjectionView } from '../helpers/projection';

function frozen<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;
}
const gapPlan=()=>makePlan({openingCashCents:10000,accounts:[{id:'brokerage',name:'Brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:20000}}]});

describe('annual income-tax reserve allocation',()=>{
  it('allocates annual tax with exact cumulative remainders',()=>{
    expect(allocateAnnualTax(100,Array(12).fill(0))).toEqual([8,9,8,8,9,8,8,9,8,8,9,8]);
    expect(allocateAnnualTax(101,[1,2,...Array(10).fill(0)])).toEqual([34,67,...Array(10).fill(0)]);
  });
  it('uses positive household income weights rather than payroll withholding dates',()=>{
    expect(allocateAnnualTax(120000,[...Array(6).fill(0),...Array(6).fill(100)])).toEqual([...Array(6).fill(0),...Array(6).fill(20000)]);
    expect(allocateAnnualTax(0,Array(12).fill(100))).toEqual(Array(12).fill(0));
  });
  it('rejects aggregate monetary overflow without an approximate denominator',()=>{
    expect(()=>allocateAnnualTax(100,Array(12).fill(MAX_CENTS))).toThrow('monetary-overflow');
  });
  it.each([-1,NaN,1.5])('rejects invalid annual liability %s',value=>{
    expect(()=>allocateAnnualTax(value,Array(12).fill(0))).toThrow();
  });
});

describe('chronological household projection and reconciliation',()=>{
  it('keeps a fixed taxable deposit when an income stream overflows',()=>{
    const plan=gapPlan();
    const result=calculateProjection(mustValidate({...plan,otherIncome:[{id:'overflowing-income',name:'Income',amountCents:MAX_CENTS,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,classification:'ordinary-taxable',niitTreatment:'included'}]}),loadRuleSet());
    expect(result.months[0]?.accounts[0]?.contributionCents).toEqual({status:'available',value:20000});
    expect(result.months[11]?.accounts[0]?.closingCents).toEqual({status:'available',value:240000});
    expect(result.months[0]?.grossIncomeCents.status).toBe('unsupported-case');
  });
  it('isolates an overflowing percentage request from another fixed account and independent income tax',()=>{
    const result=calculateProjection(mustValidate(makePlan({salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:90000000000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],accounts:[{id:'bad-account',name:'Bad account',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}},{id:'fixed-account',name:'Fixed account',ownerId:'owner-b',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'bad-percent',accountId:'bad-account',priority:1,startDate:'2026-01-01',amount:{kind:'salary-percent',salaryId:'salary',percentBps:100000}},{id:'fixed-deposit',accountId:'fixed-account',priority:2,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]})),loadRuleSet());
    expect(result.months[0]?.accounts.find(a=>a.accountId==='fixed-account')?.contributionCents).toEqual({status:'available',value:10000});
    expect(result.months[0]?.accounts.find(a=>a.accountId==='bad-account')?.contributionCents.status).toBe('unsupported-case');
    expect(result.months[0]?.eligibleContributionCents.status).toBe('unsupported-case');
    expect(result.years[0]?.tax.status).toBe('available');
    expect(result.issues).toContainEqual(expect.objectContaining({code:'monetary-overflow',recordId:'bad-percent',year:2026,field:'contributionRequests'}));
  });
  it('marks omitted distributions when a newly funded deferred account reaches a later distribution year',()=>{
    const base=makePlan(),owner={...base.household.filers[0],seniorDeductionSsnEligible:{known:true as const,value:true}};
    const result=calculateProjection(mustValidate(makePlan({horizonYears:2,household:{...base.household,filers:[{...owner,birthDate:{known:true,value:'1954-01-01'},workplaceCoverage:{known:true,value:true},employerAssumptionsByYear:[2026,2027].map(year=>({year,employerId:'employer',priorYearWagesCents:{known:true,value:12000000},planCatchUpAvailable:{known:true,value:true},rothCatchUpAvailable:{known:true,value:true}}))},base.household.filers[1]]},salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:12000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],accounts:[{id:'deferred',name:'Deferred',ownerId:'owner-a',type:'traditional-401k',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'deferred',sponsoringSalaryId:'salary',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]})),loadRuleSet());
    expect(result.years[0]?.coverage.completeHouseholdLiability).toBe(true);
    expect(result.years[1]?.coverage.completeHouseholdLiability).toBe(false);
    expect(result.years[1]?.issues).toContainEqual(expect.objectContaining({code:'omitted-distributions',recordId:'owner-a',year:2027}));
    expect(result.years[1]?.accounts[0]?.closingCents).toEqual({status:'available',value:240000});
  });
  it('keeps household tax independent of an unrelated standalone debt overflow',()=>{
    const result=calculateProjection(mustValidate(makePlan({horizonYears:2,debts:[{id:'large-debt',name:'Large debt',openingBalanceCents:MAX_CENTS,aprBps:100,monthlyPaymentCents:0,firstPaymentMonth:'2026-01'}]})),loadRuleSet());
    expect(result.years.every(y=>y.tax.status==='available')).toBe(true);
    expect(result.months[0]?.federalIncomeTaxCents).toEqual({status:'available',value:0});
    expect(result.months[0]?.loanBalanceCents.status).toBe('unsupported-case');
    expect(result.months[0]?.reserveCents.status).toBe('unsupported-case');
  });
  it('preserves established prior minimum-tax credit markers across an interrupted year',()=>{
    const base=makePlan();
    const result=calculateProjection(mustValidate(makePlan({household:{...base.household,coverageAnswers:{...base.household.coverageAnswers,priorFederalMinimumTaxCredits:{known:true,value:true}}},otherIncome:[{id:'oversized-income',name:'Large income',amountCents:MAX_CENTS,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,classification:'ordinary-taxable',niitTreatment:'included'}]})),loadRuleSet());
    expect(result.closingTaxState.minimumTaxCreditCoverage.federal).toEqual({known:true,value:true});
  });
  it('preserves valid prior loan years and independently funded brokerage deposits after a linked loan fails',()=>{
    const result=calculateProjection(mustValidate(makePlan({horizonYears:10,accounts:[{id:'broker',name:'Broker',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'broker',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}],properties:[{id:'home',name:'Home',role:'primary',purchaseDate:'2025-01-01',purchasePriceCents:0,downPaymentCents:0,openingValueCents:0,appreciationBps:0,appreciationOverrides:[],loans:[]}],debts:[{id:'growing-debt',name:'Growing debt',propertyId:'home',openingBalanceCents:50000000000000,aprBps:1000,monthlyPaymentCents:0,firstPaymentMonth:'2026-01'}]})),loadRuleSet());
    expect(result.loanSchedules[0]?.schedule.status).toBe('available');
    const failed=result.loanSchedules.find(s=>s.schedule.status!=='available');expect(failed).toBeDefined();
    expect(result.months.find(m=>m.year===failed!.year)?.accounts[0]?.contributionCents).toEqual({status:'available',value:10000});
    expect(result.months.find(m=>m.year===failed!.year)?.properties[0]?.closingValueCents).toEqual({status:'available',value:0});
  });
  it('keeps known income, payroll and fixed deposits when an independent expense stream overflows',()=>{
    const result=calculateProjection(mustValidate(makePlan({horizonYears:2,salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:12000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],accounts:[{id:'broker',name:'Broker',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'broker',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}],expenses:[{id:'expense',name:'Expense',amountCents:7000000000000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:10000,use:'personal',taxCategory:'personal'}]})),loadRuleSet());
    const january=result.months.find(m=>m.date==='2027-01')!;
    expect(january.salaryCents).toEqual({status:'available',value:1000000});
    expect(january.socialSecurityCents).toEqual({status:'available',value:62000});
    expect(january.accounts[0]?.contributionCents).toEqual({status:'available',value:10000});
    expect(january.ordinaryExpensesCents.status).toBe('unsupported-case');
  });
  it.each(fixtureRows)('matches independent projection worksheet $id',fixture=>{
    const result=calculateProjection(mustValidate(fixture.input as unknown as PlanDocument),loadRuleSet());
    expect(numericProjectionView(result,fixture.comparisonMode==='selected-numeric-rows'?fixture.expected:undefined)).toEqual(fixture.expected);
    for(const code of fixture.expectedIssueCodes)expect(result.issues.map(i=>i.code)).toContain(code);
    for(const year of result.years){expect(year.household.status).toBe('available');expect(year.candidates).toHaveLength(4);}
    if(fixture.expectedDeductionMethods&&result.years[0]?.tax.status==='available')expect(result.years[0].tax.value.selectedMethods).toEqual(fixture.expectedDeductionMethods);
    if('expectedRentalStates' in fixture)for(const expected of fixture.expectedRentalStates as readonly {year:number;rentalId:string;books:unknown}[])expect(result.taxStates.find(s=>s.year===expected.year)?.closing.rentals[expected.rentalId]).toEqual(expected.books);
    if(fixture.id==='two-salaries-home-adu'){
      const first=result.months[0]!,year=result.years[0]!;
      expect(first.properties).toHaveLength(1);expect(first.loans).toHaveLength(2);
      expect(first.loanBalanceCents).toEqual({status:'available',value:29990000});
      expect(first.properties[0]?.loanBalanceCents).toEqual({status:'available',value:29900000});
      if(year.household.status!=='available')throw new Error('missing household trace');
      const rental=year.household.value.facts.preIra.rentalFacts[0]!.books.federal;
      if(rental.status!=='available')throw new Error('missing rentalbook');
      expect(rental.value.depreciationCents).toBe(115000);
      expect(year.expensesCents).toEqual({status:'available',value:520000});
    }
    if(fixture.id==='unknown-rental-history-two-years'){
      expect(result.taxStates).toHaveLength(2);
      expect(result.taxStates.every(s=>s.closing.rentals['adu']?.federal.status!=='available')).toBe(true);
      expect(result.months.every(m=>m.socialSecurityCents.status==='available'&&m.properties[0]?.closingValueCents.status==='available'&&m.accounts.every(a=>a.closingCents.status==='available'))).toBe(true);
    }
    if(fixture.id==='provisional-2027')expect(result.years[0]?.provenance.some(p=>p.status==='projected'||p.status==='provisional')).toBe(true);
  });
  it('funds a planned taxable deposit once and preserves the signed cash gap',()=>{
    const result=calculateProjection(mustValidate(gapPlan()),loadRuleSet());
    const first=result.months[0]!;
    expect(first.accounts[0]?.contributionCents).toEqual({status:'available',value:20000});
    expect(first.reserveCents).toEqual({status:'available',value:-10000});
    expect(first.netWorthCents).toEqual({status:'available',value:10000});
    expect(first.fundingStatus).toBe('conditional-on-gap');
    expect(result.months.every(month=>month.fundingStatus==='conditional-on-gap')).toBe(true);
    expect(result.years[0]?.eligibleContributionCents).toEqual({status:'available',value:240000});
    expect(result.years[0]?.netWorthCents).toEqual({status:'available',value:10000});
  });
  it('leaves residual cash in the reserve and makes cash-only opening assets appear once',()=>{
    const result=calculateProjection(mustValidate(makePlan({openingCashCents:10000})),loadRuleSet());
    expect(result.months).toHaveLength(12);
    expect(result.months.every(month=>month.reserveCents.status==='available'&&month.reserveCents.value===10000)).toBe(true);
    expect(result.years[0]?.netWorthCents).toEqual({status:'available',value:10000});
    expect(result.contributions).toEqual([]);
  });
  it('reconciles each annual flow and December balance without mutating inputs',()=>{
    const plan=mustValidate(makePlan({
      openingCashCents:1000000,
      salaries:[{id:'salary-a',name:'Salary A',ownerId:'owner-a',employerId:'employer-a',annualGrossCents:12000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],
      accounts:[{id:'account-a',name:'Account A',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:1000000,annualGrowthBps:700,openingIraBasis:{known:false}},{id:'account-b',name:'Account B',ownerId:'owner-b',type:'taxable-brokerage',openingBalanceCents:2000000,annualGrowthBps:0,openingIraBasis:{known:false}}],
      contributions:[{id:'deposit-a',accountId:'account-a',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}},{id:'deposit-b',accountId:'account-b',priority:2,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}],
      expenses:[{id:'living',name:'Living',amountCents:100000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}],
    }));
    const rules=frozen(loadRuleSet()),before=JSON.stringify({plan,rules});
    const result=calculateProjection(plan,rules),again=calculateProjection(plan,rules);
    expect(again).toEqual(result);
    expect(JSON.stringify({plan,rules})).toBe(before);
    const year=result.years[0]!,december=result.months[11]!;
    for(const key of ['grossIncomeCents','salaryCents','otherIncomeCents','rentCents','ordinaryExpensesCents','propertyExpensesCents','expensesCents','debtPaymentCents','interestCents','principalPaidCents','federalIncomeTaxCents','californiaIncomeTaxCents','socialSecurityCents','medicareCents','additionalMedicareCents','sdiCents','totalTaxCents','requestedContributionCents','eligibleContributionCents','preventedContributionCents','accountGrowthCents','propertyGrowthCents','cashFlowCents'] as const){
      const value=year[key];if(value.status!=='available')throw new Error('missing annual '+key);
      expect(result.months.reduce((sum,month)=>{const v=month[key];if(v.status!=='available')throw new Error('missing month '+key);return sum+v.value;},0)).toBe(value.value);
    }
    for(const key of ['reserveCents','netWorthCents','accountBalanceCents','propertyValueCents','loanBalanceCents','equityCents'] as const)expect(year[key]).toEqual(december[key]);
    for(const month of result.months){
      if(month.grossIncomeCents.status!=='available'||month.totalTaxCents.status!=='available'||month.expensesCents.status!=='available'||month.debtPaymentCents.status!=='available'||month.eligibleContributionCents.status!=='available')throw new Error('missing cash fields');
      expect(month.cashFlowCents).toEqual({status:'available',value:month.grossIncomeCents.value-month.totalTaxCents.value-month.expensesCents.value-month.debtPaymentCents.value-month.eligibleContributionCents.value});
    }
    expect(year.ratios.expenseRatio.status).toBe('available');
    if(year.ratios.expenseRatio.status==='available')expect(year.ratios.expenseRatio.value).toBe(0.1);
  });
  it('preserves independent account balances when their aggregate overflows in a forty-year growth forecast',()=>{
    const plan=mustValidate(makePlan({horizonYears:40,accounts:[{id:'account-a',name:'Account A',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:40000000000000,annualGrowthBps:700,openingIraBasis:{known:false}},{id:'account-b',name:'Account B',ownerId:'owner-b',type:'taxable-brokerage',openingBalanceCents:40000000000000,annualGrowthBps:700,openingIraBasis:{known:false}}]}));
    const result=calculateProjection(plan,loadRuleSet()),april=result.months.find(month=>month.date==='2029-04')!;
    expect(result.months).toHaveLength(480);
    expect(april.accounts.every(account=>account.closingCents.status==='available')).toBe(true);
    expect(april.accountBalanceCents.status).toBe('unsupported-case');
    expect(april.accountBalanceCents).not.toHaveProperty('value');
    expect(april.netWorthCents.status).toBe('unsupported-case');
    expect(april.reserveCents).toEqual({status:'available',value:0});
    expect(april.fundingStatus).toBe('funded');
    expect(result.issues).toContainEqual(expect.objectContaining({code:'monetary-overflow',recordId:'synthetic-plan',year:2029,field:'accountBalanceCents'}));
  });
  it('does not serialize Decimal internals or unsafe monetary values',()=>{
    const result=calculateProjection(mustValidate(gapPlan()),loadRuleSet());
    const serialized=JSON.stringify(result);
    expect(serialized).not.toMatch(/closingExact|"d":\[|"s":1,"e":/);
    function inspect(value:unknown,key=''):void{
      if(value&&typeof value==='object')for(const [child,entry] of Object.entries(value))inspect(entry,key==='value'?key:child==='value'&&key.endsWith('Cents')?'money':child);
      if(typeof value==='number'&&(key==='money'||key.endsWith('Cents'))){expect(Number.isSafeInteger(value)).toBe(true);expect(Math.abs(value)).toBeLessThanOrEqual(MAX_CENTS);}
    }
    inspect(JSON.parse(serialized));
  });
});
