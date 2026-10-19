import {describe,expect,it} from 'vitest';
import type {PropertyLoan,RentalUnit,ValidatedPlan} from '../../src/engine/model/plan';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {checkCoverage} from '../../src/engine/coverage';
import {resolveCashYear} from '../../src/engine/cash/income';
import {buildPropertyFacts,type PropertyYearFacts} from '../../src/engine/property/facts';
import {calculateLoanSchedule} from '../../src/engine/property/loans';
import {resolveHouseholdYear} from '../../src/engine/tax/comparison';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {calculateProjection} from '../../src/engine/projection';
import type {YearRules} from '../../src/engine/rules/types';
import type {PlanDocument} from '../../src/engine/model/plan';
import {loadReferences} from '../helpers/references';
import {mustValidate} from '../helpers/plans';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';

const seed=loadReferences<{plan:PlanDocument;rules:YearRules},PropertyYearFacts>('property-2026')[0]!.input;
const resolved=resolveYearRules(loadRuleSet(),2026,seed.plan.taxPolicy);
if(resolved.status!=='available')throw new Error('Missing sourced rules');
const rules=resolved.value;
const unknown={known:false} as const;
const futureLoan:PropertyLoan={
  id:'future-loan',name:'Purchase loan',originalPrincipalCents:120000,
  aprBps:600,termMonths:360,originationDate:'2028-06-15',acquisitionDate:'2028-06-15',
  firstPaymentDate:'2028-07-31',openingBalance:unknown,openingPayment:unknown,
  collateralPropertyId:seed.plan.properties[0]!.id,
  proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:unknown,
    qualifiedPrincipalCents:unknown,historyComplete:unknown},
  proceedsAllocations:[],financingAtRiskQualification:unknown,
};
function futurePlan():ValidatedPlan{
  const original=mustValidate(seed.plan),unit=original.rentals[0]!;
  const rental:RentalUnit={...unit,rentStartDate:'2028-06-15',availableDate:'2028-06-15',
    activeParticipation:unknown,qualifications:Object.fromEntries(Object.keys(unit.qualifications).map(key=>[key,unknown])) as unknown as RentalUnit['qualifications'],
    taxHistory:Object.fromEntries(Object.keys(unit.taxHistory).map(key=>[key,unknown])) as unknown as RentalUnit['taxHistory'],
    qbi:{qualification:unknown,wagesCents:unknown,ubiaCents:unknown,openingLossVintages:unknown}};
  // Exercise the property/tax boundary independently of draft validation.
  return {...original,horizonYears:4,properties:[{...original.properties[0]!,
    purchaseDate:'2028-06-15',loans:[futureLoan]}],rentals:[rental]};
}
function facts(plan:ValidatedPlan,year:number){
  return buildPropertyFacts(plan,resolveCashYear(plan,year),
    [calculateLoanSchedule(futureLoan,year,1,{plannedOrigination:true})],initialTaxState(plan),rules);
}
function supportedPurchasePlan(overrides:Partial<PlanDocument>={}):PlanDocument{
  const base=makeFuturePurchasePlan(),property=base.properties[0]!,loan=property.loans[0]!;
  const unit=futurePlan().rentals[0]!;
  return {...base,properties:[{...property,role:'rental',purchaseTaxEstimation:{mode:'simple',buildingShareBps:8000},
    loans:[{...loan,aprBps:0,proceedsAllocations:[]}]}],
    rentals:[{...unit,id:'future-rental',propertyId:property.id,availableDate:property.purchaseDate,rentStartDate:property.purchaseDate,monthlyRentCents:0}],
    ...overrides};
}

describe('future property tax activation',()=>{
  it('keeps future rental books and property deductions out of earlier tax years',()=>{
    const plan=futurePlan(),property=facts(plan,2026);
    expect(property.rentals).toEqual([]);
    expect(property.expenses).toEqual([]);
    expect(property.personal.loans).toEqual([]);
    expect(property.personal.mortgageInterestCents).toEqual({status:'available',value:0});
    expect(property.closingRentalState).toEqual({});
    const result=resolveHouseholdYear(plan,resolveCashYear(plan,2026),[],property,[],initialTaxState(plan),rules);
    expect(result.tax.status).toBe('available');
  });

  it('does not request future loan and rental history before the purchase year',()=>{
    const plan=futurePlan(),coverage=checkCoverage(plan,2026);
    const futureIds=new Set([futureLoan.id,plan.rentals[0]!.id]);
    expect(coverage.issues.filter(issue=>issue.recordId&&futureIds.has(issue.recordId))).toEqual([]);
    expect(coverage.completeForModeledScope).toBe(true);
  });

  it('activates explicitly detailed rental history requirements in the purchase year',()=>{
    const plan=futurePlan(),property=facts(plan,2028);
    expect(property.rentals).toHaveLength(1);
    expect(property.rentals[0]!.books.federal.status).toBe('needs-data');
    expect(checkCoverage(plan,2028).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({recordId:plan.rentals[0]!.id,field:'taxHistory.federal'}),
      expect.objectContaining({recordId:futureLoan.id,field:'proceedsQualification.historyComplete'}),
    ]));
  });

  it('labels future-purchase tax and brokerage assumptions without marking modeled calculations incomplete',()=>{
    const source=futurePlan(),plan:ValidatedPlan={...source,rentals:[],expenses:[],properties:[{
      ...source.properties[0]!,loans:[],purchaseTaxEstimation:{mode:'simple',buildingShareBps:8000},
      purchaseFunding:{kind:'taxable-brokerage',accountId:'funding-account'},
    }]};
    const earlier=checkCoverage(plan,2026),purchaseYear=checkCoverage(plan,2028);
    expect(earlier.completeHouseholdLiability).toBe(true);
    expect(purchaseYear.completeForModeledScope).toBe(true);
    expect(purchaseYear.completeHouseholdLiability).toBe(false);
    expect(purchaseYear.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({code:'property-purchase-estimate',field:'purchaseTaxEstimation',severity:'info'}),
      expect.objectContaining({code:'purchase-funding-estimate',field:'purchaseFunding',severity:'info'}),
    ]));
  });

  it('treats simple purchase principal paid from household cash as supported capital once',()=>{
    const result=calculateProjection(mustValidate(supportedPurchasePlan()),loadRuleSet());
    const closing=result.taxStates.find(state=>state.year===2027)!.closing.rentals['future-rental']!.federal;
    expect(closing).toMatchObject({status:'available',value:{
      atRiskCents:78_739_394,cumulativeDepreciationCents:1_260_606,
    }});
    expect(result.years[1]!.totalTaxCents.status).toBe('available');
    expect(result.years[1]!.conditionalOnGap).toBe(false);
  });

  it('funds monthly rental deficits independently of later rental surpluses',()=>{
    const base=supportedPurchasePlan(),unit=base.rentals[0]!;
    const plan=supportedPurchasePlan({rentals:[{...unit,monthlyRentCents:1_000_000,rentStartDate:'2027-12-01'}],
      expenses:[{id:'rental-operating',name:'Rental operating cost',propertyId:'future-home',rentalId:'future-rental',
        amountCents:100_000,frequency:'monthly',startDate:'2027-09-01',annualGrowthBps:0,use:'rental',taxCategory:'operating'}]});
    const household=calculateProjection(mustValidate(plan),loadRuleSet()).years[1]!.household;
    expect(household.status).toBe('available');
    if(household.status!=='available')return;
    // July/August each need 177,778; September-November each need 277,778.
    expect(household.value.facts.preIra.rentalFacts[0]).toMatchObject({purchaseOwnerSupportCents:1_188_890});
  });

  it('offsets supported nondeductible rental spending instead of inflating the amount at risk',()=>{
    const plan=supportedPurchasePlan({expenses:[{id:'rental-personal',name:'Nondeductible rental cost',
      propertyId:'future-home',rentalId:'future-rental',amountCents:10_000,frequency:'monthly',startDate:'2027-09-01',
      annualGrowthBps:0,use:'rental',taxCategory:'personal'}]});
    const result=calculateProjection(mustValidate(plan),loadRuleSet());
    expect(result.taxStates.find(state=>state.year===2027)!.closing.rentals['future-rental']!.federal)
      .toMatchObject({status:'available',value:{atRiskCents:78_739_394}});
    const household=result.years[1]!.household;
    if(household.status!=='available')throw new Error('Missing household facts');
    expect(household.value.facts.preIra.rentalFacts[0]).toMatchObject({
      purchaseOwnerSupportCents:1_106_668,purchaseNondeductibleExpenseCents:40_000,
    });
  });
});
