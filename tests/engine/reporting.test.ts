import { describe,expect,it } from 'vitest';
import { summarizeYear,summarizeProjectionYear } from '../../src/engine/reporting';
import { MAX_CENTS } from '../../src/engine/money';
import { flowFields,balanceFields,type MonthlyProjection } from '../../src/engine/projection-types';
import type { Available,Issue } from '../../src/engine/model/results';
import { resolveHouseholdYear } from '../../src/engine/tax/comparison';
import type { CashYear } from '../../src/engine/cash/income';
import type { ContributionRequest } from '../../src/engine/cash/contribution-requests';
import type { PlanDocument } from '../../src/engine/model/plan';
import type { HouseholdTaxState } from '../../src/engine/model/tax-state';
import type { PropertyYearFacts } from '../../src/engine/property/facts';
import type { LoanSchedule } from '../../src/engine/property/loans';
import type { YearRules } from '../../src/engine/rules/types';
import { loadReferences } from '../helpers/references';
import { mustValidate } from '../helpers/plans';
const available=(value:number):Available<number>=>({status:'available',value});
const missingIssue:Issue={code:'required-income-tax',year:2026,field:'tax',severity:'warning',explanation:'Tax requires missing rental history.',resolution:'Supply the rental book.'};
const missing:Available<number>={status:'needs-data',issues:[missingIssue]};
const metadata={tax:{status:'needs-data' as const,issues:[missingIssue]},household:{status:'needs-data' as const,issues:[missingIssue]},candidates:[],coverage:{completeForModeledScope:false,completeHouseholdLiability:false,issues:[missingIssue]},provenance:[],issues:[missingIssue]};
const flows={grossIncomeCents:1000,salaryCents:700,otherIncomeCents:200,rentCents:100,ordinaryExpensesCents:120,propertyExpensesCents:30,expensesCents:150,debtPaymentCents:100,interestCents:40,principalPaidCents:60,federalIncomeTaxCents:60,californiaIncomeTaxCents:20,socialSecurityCents:10,medicareCents:5,additionalMedicareCents:3,sdiCents:2,totalTaxCents:100,requestedContributionCents:140,eligibleContributionCents:100,preventedContributionCents:40,accountGrowthCents:10,propertyGrowthCents:20,cashFlowCents:550};
function months():MonthlyProjection[]{
  return Array.from({length:12},(_,index)=>{
    const month=index+1,account=50000+month*110,property=1000000+month*20,loan=600000-month*60,equity=property-loan,reserve=10000+month*550;
    const amounts=Object.fromEntries(Object.entries(flows).map(([key,value])=>[key,available(value)])) as Pick<MonthlyProjection,typeof flowFields[number]>;
    return {...amounts,...metadata,year:2026,month,date:`2026-${String(month).padStart(2,'0')}`,fundingStatus:'funded',conditionalOnGap:false,accountBalanceCents:available(account),propertyValueCents:available(property),loanBalanceCents:available(loan),equityCents:available(equity),reserveCents:available(reserve),netWorthCents:available(account+equity+reserve),accounts:[{accountId:'account',openingCents:available(account-110),contributionCents:available(100),growthCents:available(10),closingCents:available(account)}],properties:[{propertyId:'home',openingValueCents:available(property-20),growthCents:available(20),closingValueCents:available(property),loanBalanceCents:available(loan),equityCents:available(equity)}],loans:[{loanId:'mortgage',openingPrincipalCents:available(loan+60),interestCents:available(40),paymentCents:available(100),principalPaidCents:available(60),closingPrincipalCents:available(loan)}]};
  });
}
describe('annual reporting from immutable settled monthly movements',()=>{
  it('sums each flow exactly while taking December closing balances',()=>{
    const result=summarizeProjectionYear(months());
    const expected={grossIncomeCents:12000,salaryCents:8400,otherIncomeCents:2400,rentCents:1200,ordinaryExpensesCents:1440,propertyExpensesCents:360,expensesCents:1800,debtPaymentCents:1200,interestCents:480,principalPaidCents:720,federalIncomeTaxCents:720,californiaIncomeTaxCents:240,socialSecurityCents:120,medicareCents:60,additionalMedicareCents:36,sdiCents:24,totalTaxCents:1200,requestedContributionCents:1680,eligibleContributionCents:1200,preventedContributionCents:480,accountGrowthCents:120,propertyGrowthCents:240,cashFlowCents:6600};
    for(const field of flowFields)expect(result[field]).toEqual(available(expected[field]));
    expect(result.accountBalanceCents).toEqual(available(51320));
    expect(result.propertyValueCents).toEqual(available(1000240));
    expect(result.loanBalanceCents).toEqual(available(599280));
    expect(result.equityCents).toEqual(available(400960));
    expect(result.reserveCents).toEqual(available(16600));
    expect(result.netWorthCents).toEqual(available(468880));
  });
  it('reconciles account, property and mortgage opening, flow and closing amounts',()=>{
    const result=summarizeProjectionYear(months());
    expect(result.accounts).toEqual([{accountId:'account',openingCents:available(50000),contributionCents:available(1200),growthCents:available(120),closingCents:available(51320)}]);
    expect(result.properties).toEqual([{propertyId:'home',openingValueCents:available(1000000),growthCents:available(240),closingValueCents:available(1000240),loanBalanceCents:available(599280),equityCents:available(400960)}]);
    expect(result.loans).toEqual([{loanId:'mortgage',openingPrincipalCents:available(600000),interestCents:available(480),paymentCents:available(1200),principalPaidCents:available(720),closingPrincipalCents:available(599280)}]);
  });
  it('uses aggregate income for each ratio rather than averaging monthly ratios',()=>{
    const input=months().map((row,index)=>({...row,grossIncomeCents:available(index===0?100:index===1?300:0),expensesCents:available(index===0?50:index===1?30:0),totalTaxCents:available(index===0?5:index===1?75:0),eligibleContributionCents:available(index===0?20:index===1?40:0),cashFlowCents:available(index===0?25:index===1?155:0)}));
    expect(summarizeProjectionYear(input).ratios).toEqual({expenseRatio:available(.2),taxRatio:available(.2),contributionRatio:available(.15),cashFlowMargin:available(.45)});
  });
  it('reports zero-income ratios as unavailable with a located action',()=>{
    const input=months().map(row=>({...row,grossIncomeCents:available(0)}));
    const result=summarizeProjectionYear(input);
    for(const [key,ratio]of Object.entries(result.ratios)){
      expect(ratio.status).toBe('needs-data');expect(ratio).not.toHaveProperty('value');
      if(ratio.status!=='available')expect(ratio.issues).toEqual(expect.arrayContaining([expect.objectContaining({year:2026,field:`ratios.${key}`,severity:'info'})]));
    }
    expect(result.grossIncomeCents).toEqual(available(0));
  });
  it('retains independent flows and balances when a tax flow is unavailable',()=>{
    const input=months().map((row,index)=>({...row,...(index===0?{federalIncomeTaxCents:missing,totalTaxCents:missing,cashFlowCents:missing}:{}),...(index===11?{reserveCents:missing,netWorthCents:missing}:{}),issues:[missingIssue]}));
    const result=summarizeProjectionYear(input);
    expect(result.federalIncomeTaxCents).toEqual(missing);expect(result.totalTaxCents).toEqual(missing);
    expect(result.cashFlowCents).toEqual(missing);expect(result.ratios.taxRatio).toEqual(missing);
    expect(result.salaryCents).toEqual(available(8400));expect(result.propertyValueCents).toEqual(available(1000240));
    expect(result.reserveCents).toEqual(missing);expect(result.netWorthCents).toEqual(missing);
    expect(result.issues.filter(i=>i.code===missingIssue.code)).toHaveLength(1);
  });
  it('preserves unsupported-case precedence without creating a numeric sum',()=>{
    const unsupported:Available<number>={status:'unsupported-case',issues:[{...missingIssue,code:'unsupported-tax'}]};
    const input=months().map((row,index)=>({...row,totalTaxCents:index===0?missing:index===1?unsupported:row.totalTaxCents}));
    const result=summarizeProjectionYear(input);
    expect(result.totalTaxCents.status).toBe('unsupported-case');expect(result.totalTaxCents).not.toHaveProperty('value');
    expect(result.ratios.taxRatio.status).toBe('unsupported-case');
  });
  it('locates annual sum overflow while keeping independent balances and ratios',()=>{
    const input=months().map(row=>({...row,grossIncomeCents:available(MAX_CENTS),coverage:{completeForModeledScope:true,completeHouseholdLiability:true,issues:[]},issues:[]}));
    const result=summarizeProjectionYear(input);
    expect(result.grossIncomeCents.status).toBe('unsupported-case');expect(result.grossIncomeCents).not.toHaveProperty('value');
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'monetary-overflow',year:2026,field:'grossIncomeCents'})]));
    expect(result.accountBalanceCents).toEqual(available(51320));expect(result.salaryCents).toEqual(available(8400));
    expect(result.ratios.expenseRatio.status).toBe('unsupported-case');
    expect(result.coverage.completeForModeledScope).toBe(false);expect(result.coverage.completeHouseholdLiability).toBe(false);
  });
  it('locates overflow inside an individual account flow without hiding other assets',()=>{
    const input=months().map(row=>({...row,accounts:[{...row.accounts[0]!,growthCents:available(MAX_CENTS)}]}));
    const result=summarizeProjectionYear(input);
    expect(result.accounts[0]?.growthCents.status).toBe('unsupported-case');
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'monetary-overflow',year:2026,field:'accounts.account.growthCents'})]));
    expect(result.properties[0]?.closingValueCents).toEqual(available(1000240));
  });
  it('keeps a persistent gap condition even after cash flow recovers',()=>{
    const input=months().map((row,index)=>({...row,fundingStatus:index>=2?'conditional-on-gap' as const:'funded' as const,conditionalOnGap:index>=2}));
    const result=summarizeProjectionYear(input);
    expect(result.cashFlowCents).toEqual(available(6600));
    expect(result.fundingStatus).toBe('conditional-on-gap');expect(result.conditionalOnGap).toBe(true);
  });
  it('copies December availability for every balance instead of summing assets',()=>{
    const input=months();input[11]={...input[11]!,...Object.fromEntries(balanceFields.map(field=>[field,missing]))};
    const result=summarizeProjectionYear(input);
    for(const field of balanceFields)expect(result[field]).toEqual(missing);
    expect(result.accountGrowthCents).toEqual(available(120));
  });
  it('copies the annual household and trace metadata while deduplicating monthly issues',()=>{
    const input=months();
    const reference=loadReferences<{plan:PlanDocument;cash:CashYear;requests:readonly ContributionRequest[];property:PropertyYearFacts;loans:readonly LoanSchedule[];opening:HouseholdTaxState;rules:YearRules},unknown>('comparison-2026')[0]!;
    const i=reference.input;
    const household=resolveHouseholdYear(mustValidate(i.plan),i.cash,i.requests,i.property,i.loans,i.opening,i.rules);
    const result=summarizeYear(input,household);
    expect(result.household).toEqual({status:'available',value:household});
    expect(result.tax).toBe(household.tax);expect(result.candidates).toBe(household.candidates);
    expect(result.provenance).toEqual(input[0]!.provenance);
    expect(result.issues.filter(i=>i.code===missingIssue.code)).toHaveLength(1);
  });
  it('does not mutate or depend on calendar-row input order',()=>{
    const input=months(),before=JSON.stringify(input);
    const expected=summarizeProjectionYear(input);
    expect(summarizeProjectionYear([...input].reverse())).toEqual(expected);
    expect(JSON.stringify(input)).toBe(before);
  });
});
