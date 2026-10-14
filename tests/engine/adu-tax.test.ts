import {describe,expect,it} from 'vitest';
import type {AduFinancing,AduProject,AduTaxSplit,PlanDocument,TaxBook} from '../../src/engine/model/plan';
import type {HouseholdTaxState} from '../../src/engine/model/tax-state';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {resolveCashYear} from '../../src/engine/cash/income';
import {resolveAduYear} from '../../src/engine/property/adu-lifecycle';
import {buildPropertyFacts} from '../../src/engine/property/facts';
import {calculateLoanSchedule} from '../../src/engine/property/loans';
import {buildItemizedCandidate} from '../../src/engine/tax/itemized';
import {calculateMortgageDeduction} from '../../src/engine/tax/mortgage';
import {resolveHouseholdYear} from '../../src/engine/tax/comparison';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {aduBooks,aduValue,makeAduPlan,makeAduTreatments} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';
import {makeEstimatedMortgagePlan} from '../helpers/estimated-mortgage';
import {loadReferences,assertReference} from '../helpers/references';
const salary={id:'salary',name:'Synthetic wage',ownerId:'owner-a',employerId:'employer',annualGrossCents:20_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]} as const;
function carryPlan():PlanDocument {
  const p=makeAduPlan({salaries:[salary]},{constructionStartDate:'2026-01-01',completionDate:'2027-07-14',productionPeriod:{known:true,value:{startDate:'2026-01-01',endDate:'2027-07-14',uninterrupted:true}},costs:[
    {id:'early-deduction',name:'Qualified deduction',paymentDate:'2026-06-01',amountCents:100_000,category:'building',treatments:makeAduTreatments(100_000,'currentDeductionCents')},
    {id:'building-stage',name:'Building basis',paymentDate:'2027-07-01',amountCents:33_000_000,category:'building',treatments:makeAduTreatments(33_000_000)},
  ]});return {...p,rentals:[{...p.rentals[0]!,availableDate:'2027-07-15'}]};
}
function loan(overrides:Partial<AduFinancing>={}):AduFinancing {
  return {id:'construction-loan',name:'Dedicated financing',aprBps:0,firstAmortizingPaymentMonth:'2028-01',termMonths:120,collateralPropertyId:'home',draws:[{id:'draw',month:'2027-06',amountCents:20_000_000,costAllocations:[{costId:'building-stage',amountCents:20_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true},...overrides};
}
function run(p:PlanDocument,year:number,opening?:HouseholdTaxState){
  const plan=mustValidate(p),state=opening??initialTaxState(plan),context=resolveAduYear(plan,year),rules=aduValue(resolveYearRules(loadRuleSet(),year,plan.taxPolicy));
  const cash=resolveCashYear(plan,year),loans=plan.properties.flatMap(p=>p.loans.map(l=>calculateLoanSchedule(l,plan.startYear,year-plan.startYear+1)));
  const property=buildPropertyFacts(plan,cash,loans,state,rules,context);
  return {context,property,loans,result:resolveHouseholdYear(plan,cash,[],property,loans,state,rules),rules,plan};
}
function withProject(p:PlanDocument,overrides:Partial<AduProject>):PlanDocument{return{...p,properties:[{...p.properties[0]!,aduProject:{...p.properties[0]!.aduProject!,...overrides}}]};}
describe('pending ADU capital and independent four-book loss carry',()=>{
  it.each(loadReferences<{kind:string},{pendingPassiveCents:number;readyOpeningPassiveCents:number;readyDepreciationCents:number;readyClosingPassiveCents:number;readyClosingRiskCents:number}>('adu-loss-carry'))('$id',c=>{
    const p=carryPlan(),pending=run(p,2026),ready=run(p,2027,pending.result.closingTaxState),rental=ready.property.rentals[0]!;
    for(const book of aduBooks){const pendingBook=aduValue(pending.result.closingTaxState.rentals['new-adu']![book]);const readyOpening=aduValue(ready.property.adu!.opening.rentals['new-adu']![book]);const closing=aduValue(ready.result.closingTaxState.rentals['new-adu']![book]);assertReference({pendingPassiveCents:pendingBook.passiveSuspendedCents,readyOpeningPassiveCents:readyOpening.passiveSuspendedCents,readyDepreciationCents:aduValue(rental.depreciation[book]).depreciationCents,readyClosingPassiveCents:closing.passiveSuspendedCents,readyClosingRiskCents:closing.atRiskCents},c.expected,0);expect(aduValue(ready.result.closingTaxState.aduProjects!['adu-project']![book]).recoveryActivated).toBe(true);expect(aduValue(pending.result.closingTaxState.aduProjects!['adu-project']![book]).recoveryActivated).toBe(false);expect(closing.lossVintages.map(v=>[v.year,v.amountCents,v.activeParticipation,v.qbiQualification])).toEqual([[2026,100_000,{known:true,value:true},{known:true,value:false}],[2027,550_000,{known:true,value:true},{known:true,value:false}]]);}
    expect(aduValue(ready.result.rental.federal).allowedRentalCents).toBe(0);
  });
  it('transfers prior funded capital into recovery basis without adding risk twice',()=>{
    const p=withProject(carryPlan(),{costs:[{id:'building-stage',name:'Building',paymentDate:'2026-07-01',amountCents:33_000_000,category:'building',treatments:makeAduTreatments(33_000_000)}]});const pending=run(p,2026),ready=run(p,2027,pending.result.closingTaxState);expect(aduValue(pending.result.closingTaxState.rentals['new-adu']!.federal).recoveryBasisCents).toBe(0);expect(aduValue(pending.result.closingTaxState.rentals['new-adu']!.federal).atRiskCents).toBe(33_000_000);expect(aduValue(ready.property.rentals[0]!.aduRiskMovements!.federal).ownerCapitalCents).toBe(0);expect(aduValue(ready.result.closingTaxState.rentals['new-adu']!.federal).atRiskCents).toBe(32_450_000);
  });
  it('keeps California capital and cash known when only federal treatment is missing',()=>{
    const p=carryPlan(),project=p.properties[0]!.aduProject!,changed=withProject(p,{costs:project.costs.map(c=>({...c,treatments:{...c.treatments,federal:{known:false}}}))});const y=run(changed,2026);expect(y.result.closingTaxState.aduProjects!['adu-project']!.federal.status).toBe('needs-data');expect(y.result.closingTaxState.aduProjects!['adu-project']!.california.status).toBe('available');expect(y.result.rental.california.status).toBe('available');expect(resolveCashYear(y.plan,2026).annual.expensesCents).toBe(100_000);
  });
  it('counts borrowing and its spent cost once in activity capital',()=>{
    const y=run(makeAduPlan({salaries:[salary]},{financing:loan()}),2027),r=y.property.rentals[0]!;expect(aduValue(r.aduRiskMovements!.federal)).toEqual({ownerCapitalCents:10_000_000,qualifiedBorrowingCents:20_000_000,ownerSupportCents:0,nondeductibleExpenseCents:0});expect(aduValue(r.books.federal).closingState.recoveryBasisCents).toBe(30_000_000);expect(aduValue(y.result.closingTaxState.rentals['new-adu']!.federal).atRiskCents).toBe(29_590_909);
  });
  it('supports the exact monthly cash deficit including principal without adding another household debit',()=>{
    const p=makeAduPlan({}, {costs:[{id:'building-stage',name:'Building',paymentDate:'2027-07-01',amountCents:10000,category:'building',treatments:makeAduTreatments(10000)}],financing:loan({draws:[{id:'draw',month:'2027-07',amountCents:10000,costAllocations:[{costId:'building-stage',amountCents:10000}]}],firstAmortizingPaymentMonth:'2027-08',termMonths:3})});const y=run(p,2027),r=y.property.rentals[0]!;expect(r.principalPaidCents).toBe(10000);expect(aduValue(r.aduRiskMovements!.federal).ownerSupportCents).toBe(10000);expect(aduValue(y.result.closingTaxState.rentals['new-adu']!.federal).atRiskCents).toBe(9864);expect(resolveCashYear(y.plan,2027).annual.expensesCents).toBe(10000);
    const unanswered=run(withProject(p,{supportOperatingDeficits:{known:false}}),2027);expect(unanswered.result.rental.federal.status).toBe('needs-data');
  });
  it('reduces risk for confirmed nondeductible spending',()=>{
    const y=run(makeAduPlan({}, {costs:[{id:'building-stage',name:'Nondeductible cost',paymentDate:'2027-07-01',amountCents:10000,category:'other',treatments:makeAduTreatments(10000,'nondeductibleExpenseCents')}]}),2027);expect(aduValue(y.property.rentals[0]!.aduRiskMovements!.federal).nondeductibleExpenseCents).toBe(10000);expect(aduValue(y.result.closingTaxState.rentals['new-adu']!.federal).atRiskCents).toBe(0);
  });
  const unsupportedCategories:readonly ["land"|"other",keyof AduTaxSplit,string][]=[
    ['land','buildingBasisCents','unsupported-adu-land-recovery'],
    ['land','currentDeductionCents','unsupported-adu-land-recovery'],
    ['other','buildingBasisCents','unsupported-adu-component-recovery'],
    ['other','currentDeductionCents','unsupported-adu-component-recovery'],
    ['other','nondepreciableBasisCents','unsupported-adu-component-recovery'],
  ];
  it.each(unsupportedCategories)('keeps a confirmed %s %s split unsupported without obscuring paid construction', (category,kind,code)=>{
    const y=run(makeAduPlan({}, {costs:[{id:'building-stage',name:'Separate cost',paymentDate:'2027-07-01',amountCents:30_000_000,category,treatments:makeAduTreatments(30_000_000,kind)}]}),2027);
    for(const book of aduBooks){
      expect(y.property.rentals[0]!.books[book]).toMatchObject({status:'unsupported-case',issues:expect.arrayContaining([expect.objectContaining({code})])});
      expect(y.result.closingTaxState.aduProjects!['adu-project']![book].status).toBe('unsupported-case');
    }
    expect(y.result.rental.federal.status).toBe('unsupported-case');
    expect(y.result.rental.california.status).toBe('unsupported-case');
    expect(y.context.cashComplete).toEqual({status:'available',value:true});
    expect(resolveCashYear(y.plan,2027).annual.expensesCents).toBe(30_000_000);
    expect(aduValue(y.property.rentals[0]!.aduCash!.capitalExpenseCents)).toBe(30_000_000);
  });
  it('keeps supported nondepreciable land basis separate from building recovery',()=>{
    const y=run(makeAduPlan({}, {costs:[{id:'building-stage',name:'Land acquisition',paymentDate:'2027-07-01',amountCents:30_000_000,category:'land',treatments:makeAduTreatments(30_000_000,'nondepreciableBasisCents')}]}),2027);
    for(const book of aduBooks){
      expect(aduValue(y.result.closingTaxState.aduProjects!['adu-project']![book])).toMatchObject({capitalizedBuildingCents:0,nondepreciableBasisCents:30_000_000});
      expect(aduValue(y.property.rentals[0]!.books[book])).toMatchObject({operatingExpenseCents:0,depreciationCents:0,taxableProfitCents:0});
    }
  });
  it('localizes a contradictory land deduction to its tax book',()=>{
    const treatments=makeAduTreatments(30_000_000,'nondepreciableBasisCents'),contradictory=makeAduTreatments(30_000_000,'currentDeductionCents');
    const y=run(makeAduPlan({}, {costs:[{id:'building-stage',name:'Land acquisition',paymentDate:'2027-07-01',amountCents:30_000_000,category:'land',treatments:{...treatments,federal:contradictory.federal}}]}),2027);
    expect(y.result.rental.federal.status).toBe('unsupported-case');
    for(const book of aduBooks.filter(book=>book!=='federal'))expect(y.property.rentals[0]!.books[book].status).toBe('available');
  });
  it('retains the negative-risk recapture boundary when principal lacks owner support',()=>{
    const p=makeAduPlan({}, {supportOperatingDeficits:{known:true,value:false},costs:[{id:'building-stage',name:'Building',paymentDate:'2027-07-01',amountCents:10000,category:'building',treatments:makeAduTreatments(10000)}],financing:loan({draws:[{id:'draw',month:'2027-07',amountCents:10000,costAllocations:[{costId:'building-stage',amountCents:10000}]}],firstAmortizingPaymentMonth:'2028-01',termMonths:1})});const first=run(p,2027),next=run(p,2028,first.result.closingTaxState);expect(next.result.rental.federal).toMatchObject({status:'unsupported-case',issues:expect.arrayContaining([expect.objectContaining({code:'unsupported-at-risk-recapture'})])});
  });
  it('preserves qualified loss vintages when readiness activates a low-MAGI recovery book',()=>{
    const original=carryPlan(),p={...original,salaries:[{...salary,annualGrossCents:6_000_000}],rentals:[{...original.rentals[0]!,qbi:{...original.rentals[0]!.qbi,qualification:{known:true as const,value:true}}}]};const pending=run(p,2026),ready=run(p,2027,pending.result.closingTaxState);expect(pending.result.closingTaxState.qbiLossVintages['new-adu']).toEqual({known:true,value:[{year:2026,amountCents:100_000}]});expect(ready.property.adu!.opening.qbiLossVintages['new-adu']).toEqual(pending.result.closingTaxState.qbiLossVintages['new-adu']);expect(ready.result.closingTaxState.qbiLossVintages['new-adu']).toEqual({known:true,value:[{year:2026,amountCents:100_000},{year:2027,amountCents:550_000}]});
  });
  it('ignores unanswered future qualifications before any project tax or funding event',()=>{
    const p=makeAduPlan();const changed={...p,rentals:[{...p.rentals[0]!,qualifications:{...p.rentals[0]!.qualifications,ordinaryResidential:{known:false as const}},activeParticipation:{known:false as const},qbi:{...p.rentals[0]!.qbi,qualification:{known:false as const}}}]};const y=run(changed,2026);expect(y.result.tax.status).toBe('available');expect(y.result.coverage.completeForModeledScope).toBe(true);expect(y.property.rentals).toEqual([]);expect(y.result.closingTaxState.rentals['new-adu']).toBeDefined();
  });
  it('requires current activity qualification for a deductible pre-readiness interest payment',()=>{
    const p=makeAduPlan({}, {financing:loan({aprBps:600,draws:[{id:'early-draw',month:'2026-12',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}],interestTaxRows:[{id:'interest-row',month:'2026-12',treatments:makeAduTreatments(50_000,'currentDeductionCents')}]})});const changed={...p,rentals:[{...p.rentals[0]!,qualifications:{...p.rentals[0]!.qualifications,longTermFairMarketLease:{known:false as const}}}]};expect(run(changed,2026).result.rental.federal.status).toBe('needs-data');
  });
  it('keeps mismatched pre-service interest treatment unavailable instead of dropping cash interest',()=>{
    const y=run(makeAduPlan({}, {financing:loan({aprBps:600,interestTaxRows:[{id:'june-interest',month:'2027-06',treatments:makeAduTreatments(1,'currentDeductionCents')}]})}),2027);expect(y.property.rentals[0]!.cashInterestCents).toBe(700_000);expect(y.result.rental.federal.status).toBe('needs-data');
  });
  it('marks new capital after readiness unsupported instead of changing original recovery basis',()=>{
    const p=makeAduPlan({expenses:[{id:'later-capital',name:'Later improvement',propertyId:'home',rentalId:'new-adu',amountCents:10000,frequency:'annual',startDate:'2028-01-01',annualGrowthBps:0,use:'rental',taxCategory:'capital'}]});const ready=run(p,2027),later=run(p,2028,ready.result.closingTaxState);expect(later.result.rental.federal.status).toBe('unsupported-case');expect(aduValue(later.result.closingTaxState.aduProjects!['adu-project']!.federal).capitalizedBuildingCents).toBe(30_000_000);
  });
  it('keeps a traced personal mortgage known when only a prospective default expense share lacks area',()=>{
    const p=makeAduPlan({expenses:[{id:'home-tax',name:'Original property tax',propertyId:'home',amountCents:10000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'property-tax'}]}, {valuation:{kind:'value-added',valueAddedCents:22_000_000},sharedExpenseOverrides:[{id:'prospective-share',expenseId:'home-tax'}]});const {primaryArea,...home}=p.properties[0]!;const withMortgage={...p,properties:[{...home,downPaymentCents:32_000_000,loans:makeEstimatedMortgagePlan().properties[0]!.loans}]};const y=run(withMortgage,2027);expect(y.property.personal.mortgageInterestCents.status).toBe('available');expect(y.result.rental.federal.status).toBe('needs-data');
  });
  it('keeps a missing original tax allocation unavailable even with independently known AGI and mortgage facts',()=>{
    const p=makeAduPlan({expenses:[{id:'home-tax',name:'Original property tax',propertyId:'home',amountCents:10000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'property-tax'}]},{valuation:{kind:'value-added',valueAddedCents:22_000_000},sharedExpenseOverrides:[{id:'prospective-share',expenseId:'home-tax'}]});const {primaryArea,...home}=p.properties[0]!;const y=run({...p,properties:[home]},2027);
    const known={status:'available' as const,value:20_000_000};const candidate=buildItemizedCandidate({...y.result.facts,federalAgiCents:known,californiaAgiCents:known,saltMagiCents:known,niitMagiCents:known},y.property,{federal:calculateMortgageDeduction(y.property,y.loans,'federal',y.rules),california:calculateMortgageDeduction(y.property,y.loans,'california',y.rules)},{status:'available',value:{californiaIncomeTaxPaidCents:0,sdiPaidCents:0,source:'actual-override'}},y.rules);
    expect(y.property.expenses[0]!.allocation!.status).toBe('needs-data');expect(candidate.federal.status).toBe('needs-data');expect(candidate.california.status).toBe('needs-data');
  });
  it('deducts qualified post-readiness project interest once without passing it to the personal mortgage',()=>{
    const p=makeAduPlan({salaries:[salary]},{financing:loan({aprBps:600,firstAmortizingPaymentMonth:'2029-01',draws:[{id:'draw',month:'2027-07',amountCents:12_000_000,costAllocations:[{costId:'building-stage',amountCents:12_000_000}]}],interestTaxRows:[{id:'construction-interest',month:'2027-07',treatments:makeAduTreatments(60_000,'currentDeductionCents')}]})});const financed={...p,properties:[{...p.properties[0]!,downPaymentCents:32_000_000,loans:makeEstimatedMortgagePlan().properties[0]!.loans}]};const first=run(financed,2027),next=run(financed,2028,first.result.closingTaxState);
    const {aduProject,...home}=financed.properties[0]!;const baseline=run({...financed,properties:[{...home,role:'primary'}],rentals:[]},2028);
    expect(next.property.personal.mortgageInterestCents).toEqual(baseline.property.personal.mortgageInterestCents);expect(next.property.personal.loans.map(l=>l.loanId)).toEqual(['home-loan']);expect(next.property.rentals[0]!.cashInterestCents).toBe(720_000);expect(aduValue(next.property.rentals[0]!.books.federal).eligibleInterestCents).toBe(720_000);
  });

  it('keeps pre-readiness basis unknown until the potential capitalized tax-payment schedule is complete',()=>{
    const p=makeAduPlan(),tax=p.properties[0]!.aduProject!.propertyTax,changed=withProject(p,{propertyTax:{...tax,paymentYears:tax.paymentYears.map(row=>row.year===2027?{...row,complete:{known:false as const}}:row)}});const y=run(changed,2027);
    expect(y.result.closingTaxState.aduProjects!['adu-project']!.federal.status).toBe('needs-data');expect(y.property.rentals[0]!.depreciation.federal.status).toBe('needs-data');
  });
  it('preserves activated original recovery basis when a later current tax-payment schedule is incomplete',()=>{
    const p=makeAduPlan(),first=run(p,2027),tax=p.properties[0]!.aduProject!.propertyTax,next=run(withProject(p,{propertyTax:{...tax,paymentYears:tax.paymentYears.map(row=>row.year===2028?{...row,complete:{known:false as const}}:row)}}),2028,first.result.closingTaxState);
    expect(aduValue(next.result.closingTaxState.aduProjects!['adu-project']!.federal).capitalizedBuildingCents).toBe(30_000_000);expect(aduValue(next.property.rentals[0]!.depreciation.federal).depreciationCents).toBe(1_090_909);expect(next.result.rental.federal.status).toBe('needs-data');
  });

  it('selects wage cash before unrelated expense arithmetic while retaining prospective ownership references',async()=>{
    const p=makeAduPlan({salaries:[salary],expenses:[{id:'shared-home-cost',name:'Original shared cost',propertyId:'home',amountCents:100,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'operating'},{id:'huge-unrelated',name:'Unrelated spending',amountCents:99_999_999_999_999,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}]},{sharedExpenseOverrides:[{id:'prospective',expenseId:'shared-home-cost'}]});const plan=mustValidate(p);
    const selected=resolveCashYear(plan,2027,{streamIds:new Set(['salary'])});expect(selected.annual.salaryCents).toBe(20_000_000);expect(selected.streams.map(s=>s.id)).toEqual(['salary']);
    const {prepareAduTaxYear}=await import('../../src/engine/property/adu-tax');const prepared=prepareAduTaxYear(plan,resolveAduYear(plan,2027),initialTaxState(plan),aduValue(resolveYearRules(loadRuleSet(),2027,plan.taxPolicy)));expect(prepared.rentalFacts[0]!.books.federal.status).toBe('available');expect(plan.properties[0]!.aduProject!.sharedExpenseOverrides[0]!.expenseId).toBe('shared-home-cost');
  });

  it('keeps loan origination recovery outside the building schedule even with a confirmed ordinary-use answer',()=>{
    const p=makeAduPlan({}, {costs:[{id:'fee',name:'Loan origination fee',paymentDate:'2027-07-01',amountCents:10000,category:'financing-fee',treatments:makeAduTreatments(10000)}]});const y=run(p,2027);expect(y.result.rental.federal.status).toBe('unsupported-case');expect(y.context.cashComplete).toEqual({status:'available',value:true});expect(resolveCashYear(y.plan,2027).annual.expensesCents).toBe(10000);
  });
  it('cannot bypass an unqualified treatment by labeling its cash category building',()=>{
    const p=makeAduPlan(),q=p.properties[0]!.aduProject!.taxQualifications,y=run(withProject(p,{taxQualifications:{...q,federal:{known:true,value:false}}}),2027);expect(y.result.rental.federal.status).toBe('unsupported-case');expect(y.result.closingTaxState.aduProjects!['adu-project']!.california.status).toBe('available');
  });

});
