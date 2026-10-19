import {describe,expect,it} from 'vitest';
import type {AduProject,PlanDocument} from '../../src/engine/model/plan';
import {calculateProjection} from '../../src/engine/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {validatePlan} from '../../src/engine/validation';
import {MAX_CENTS} from '../../src/engine/money';
import {aduEstimateProvenance,resolveAduPlanningEstimates,usesAduPlanningEstimates} from '../../src/engine/property/adu-planning-estimates';
import {aduBooks,aduValue,makeAduPlan,makeAduTreatments} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';

const unknown=()=>({known:false as const});
const unknownTreatments=()=>Object.fromEntries(aduBooks.map(book=>[book,unknown()])) as AduProject['costs'][number]['treatments'];
const unknownQualifications=()=>Object.fromEntries(aduBooks.map(book=>[book,unknown()])) as AduProject['taxQualifications'];
function basicPlan(mode:'simple'|'detailed'|'legacy'='simple'):PlanDocument {
  const original=makeAduPlan({horizonYears:20});
  const property=original.properties[0]!,project=property.aduProject!,unit=original.rentals[0]!;
  return {...original,properties:[{...property,aduArea:400,aduProject:{...project,
    ...(mode==='legacy'?{}:{taxEstimation:mode==='simple'?{mode,propertyTaxRateBps:120}:{mode}}),
    constructionStartDate:'2026-01-01',completionDate:'2028-06-01',
    costs:[{id:'building-stage',name:'Building',category:'building',paymentDate:'2028-06-01',amountCents:10_000_000,treatments:unknownTreatments()}],
    taxQualifications:unknownQualifications(),productionPeriod:unknown(),supportOperatingDeficits:unknown(),
    propertyTax:{...project.propertyTax,addedAssessedValueCents:unknown(),marginalRateBps:unknown(),completedValueEnrollmentYear:2029,
      originalExpenseExcludesAdu:unknown(),paymentYears:[{year:2026,complete:unknown(),payments:[]}]},
  }}],rentals:[{...unit,availableDate:'2028-07-01',rentStartDate:'2028-07-01',monthlyRentCents:200_000,activeParticipation:unknown(),
    qualifications:{ordinaryResidential:unknown(),longTermFairMarketLease:unknown(),noPersonalUse:unknown(),noSubstantialTenantServices:unknown(),advancedBasisAdjustments:unknown(),californiaSmallBusinessQualification:unknown()},
    qbi:{...unit.qbi,qualification:unknown(),wagesCents:unknown(),ubiaCents:unknown()},
  }]};
}
function projectOf(plan:PlanDocument):AduProject{return plan.properties[0]!.aduProject!;}
function changedProject(plan:PlanDocument,change:Partial<AduProject>):PlanDocument {
  return {...plan,properties:[{...plan.properties[0]!,aduProject:{...projectOf(plan),...change}}]};
}

describe('explicit simple ADU planning estimates',()=>{
  it('derives nonzero incremental taxes for the full horizon without changing the saved inputs',()=>{
    const plan=mustValidate(basicPlan()),before=structuredClone(plan),resolved=resolveAduPlanningEstimates(plan),project=projectOf(resolved);
    const paid=(year:number)=>project.propertyTax.paymentYears.find(row=>row.year===year)!.payments.reduce((sum,payment)=>sum+payment.amountCents,0);
    expect([2026,2027,2028,2029,2030,2045].map(paid)).toEqual([0,0,60_000,120_000,122_400,164_734]);
    expect(project.propertyTax.paymentYears).toHaveLength(20);
    expect(project.propertyTax.paymentYears.every(row=>row.complete.known&&row.complete.value)).toBe(true);
    expect(project.propertyTax.addedAssessedValueCents).toEqual({known:true,value:10_000_000});
    expect(project.propertyTax.marginalRateBps).toEqual({known:true,value:120});
    expect(project.propertyTax.paymentYears.find(row=>row.year===2028)!.payments[0]).toMatchObject({month:'2028-12',kind:'regular',amountCents:60_000});
    expect(resolved.rentals[0]).toMatchObject({activeParticipation:{known:true,value:false},qbi:{qualification:{known:true,value:false}},qualifications:{ordinaryResidential:{known:true,value:true},advancedBasisAdjustments:{known:true,value:false},californiaSmallBusinessQualification:{known:true,value:false}}});
    expect(plan).toEqual(before);
    expect(resolveAduPlanningEstimates(resolved)).toEqual(resolved);
    expect(validatePlan(resolved).ok).toBe(true);
  });

  it('feeds the existing four-book depreciation and household tax arithmetic through twenty years',()=>{
    const plan=resolveAduPlanningEstimates(mustValidate(basicPlan()));
    const projection=calculateProjection(plan,loadRuleSet());
    expect(projection.years.every(year=>year.tax.status==='available'&&year.totalTaxCents.status==='available'&&year.cashFlowCents.status==='available')).toBe(true);
    const facts=(year:number)=>aduValue(projection.years.find(row=>row.year===year)!.household).facts.preIra.rentalFacts[0]!;
    expect(aduValue(facts(2028).books.federal)).toMatchObject({rentCents:1_200_000,operatingExpenseCents:60_000,depreciationCents:166_667,taxableProfitCents:973_333});
    expect(aduValue(facts(2029).books.federal)).toMatchObject({rentCents:2_400_000,operatingExpenseCents:120_000,depreciationCents:363_636,taxableProfitCents:1_916_364});
    for(const book of aduBooks)expect(aduValue(facts(2029).books[book]).depreciationCents).toBe(363_636);
  });

  it('preserves explicit tax answers, existing bills and incomplete entered schedules',()=>{
    const original=basicPlan(),project=projectOf(original),unit=original.rentals[0]!;
    const plan=mustValidate({...changedProject(original,{
      taxQualifications:{...project.taxQualifications,federal:{known:true,value:false}},supportOperatingDeficits:{known:true,value:false},
      costs:[{...project.costs[0]!,treatments:{...project.costs[0]!.treatments,federal:makeAduTreatments(10_000_000,'nondeductibleExpenseCents').federal}}],
      propertyTax:{...project.propertyTax,addedAssessedValueCents:{known:true,value:20_000_000},marginalRateBps:{known:true,value:150},originalExpenseExcludesAdu:{known:true,value:false},
        paymentYears:[{year:2028,complete:{known:true,value:false},payments:[]},{year:2029,complete:{known:true,value:true},payments:[]},{year:2030,complete:unknown(),payments:[{id:'entered-bill',month:'2030-11',kind:'regular',amountCents:50_000,treatments:unknownTreatments()}]}]},
    }),rentals:[{...unit,activeParticipation:{known:true,value:true},qualifications:{...unit.qualifications,ordinaryResidential:{known:true,value:false},californiaSmallBusinessQualification:{known:true,value:true}},qbi:{...unit.qbi,qualification:{known:true,value:true}}}]});
    const resolved=resolveAduPlanningEstimates(plan),result=projectOf(resolved);
    expect(result.taxQualifications.federal).toEqual({known:true,value:false});
    expect(result.costs[0]!.treatments.federal).toEqual(projectOf(plan).costs[0]!.treatments.federal);
    expect(result.supportOperatingDeficits).toEqual({known:true,value:false});
    expect(result.propertyTax.addedAssessedValueCents).toEqual({known:true,value:20_000_000});
    expect(result.propertyTax.marginalRateBps).toEqual({known:true,value:150});
    expect(result.propertyTax.originalExpenseExcludesAdu).toEqual({known:true,value:false});
    expect(result.propertyTax.paymentYears.find(row=>row.year===2028)).toEqual(projectOf(plan).propertyTax.paymentYears[0]);
    expect(result.propertyTax.paymentYears.find(row=>row.year===2029)).toEqual(projectOf(plan).propertyTax.paymentYears[1]);
    expect(result.propertyTax.paymentYears.find(row=>row.year===2030)).toMatchObject({complete:{known:false},payments:[{id:'entered-bill',amountCents:50_000,treatments:{federal:{known:true,value:{currentDeductionCents:50_000}}}}]});
    expect(resolved.rentals[0]!.activeParticipation).toEqual({known:true,value:true});
    expect(resolved.rentals[0]!.qualifications.ordinaryResidential).toEqual({known:true,value:false});
    expect(resolved.rentals[0]!.qbi.qualification).toEqual({known:true,value:true});
  });

  it('uses a configured planning rate and the independent entered assessment',()=>{
    const original=basicPlan(),project=projectOf(original);
    const plan=mustValidate(changedProject(original,{taxEstimation:{mode:'simple',propertyTaxRateBps:200},propertyTax:{...project.propertyTax,addedAssessedValueCents:{known:true,value:15_000_000}}}));
    const resolved=projectOf(resolveAduPlanningEstimates(plan));
    expect(resolved.propertyTax.paymentYears.find(row=>row.year===2028)!.payments[0]!.amountCents).toBe(150_000);
    expect(resolved.propertyTax.paymentYears.find(row=>row.year===2029)!.payments[0]!.amountCents).toBe(300_000);
  });

  it('preserves entered assessment enrollment growth while anchoring a cost proxy after completion',()=>{
    const original=basicPlan(),project=projectOf(original);
    const entered=mustValidate(changedProject(original,{propertyTax:{...project.propertyTax,addedAssessedValueCents:{known:true,value:10_000_000},marginalRateBps:{known:true,value:120},completedValueEnrollmentYear:2028}}));
    const resolved=resolveAduPlanningEstimates(entered),enteredYear=projectOf(resolved).propertyTax.paymentYears.find(row=>row.year===2029)!;
    expect(enteredYear.payments[0]!.amountCents).toBe(122_400);
    expect(projectOf(resolved).propertyTax.completedValueEnrollmentYear).toBe(2028);
    const proxy=mustValidate(changedProject(original,{propertyTax:{...project.propertyTax,completedValueEnrollmentYear:2027}}));
    const resolvedProxy=resolveAduPlanningEstimates(proxy);
    expect(projectOf(resolvedProxy).propertyTax.paymentYears.find(row=>row.year===2029)!.payments[0]!.amountCents).toBe(120_000);
    expect(projectOf(proxy).propertyTax.completedValueEnrollmentYear).toBe(2027);
    expect(resolveAduPlanningEstimates(resolvedProxy)).toEqual(resolvedProxy);
  });

  it('never assigns building recovery to land, borrowing fees or unclassified components',()=>{
    for(const category of ['land','financing-fee','other'] as const){
      const original=basicPlan(),stage=projectOf(original).costs[0]!;
      const plan=mustValidate(changedProject(original,{costs:[{...stage,category}]}));
      expect(projectOf(resolveAduPlanningEstimates(plan)).costs[0]!.treatments).toEqual(unknownTreatments());
    }
  });

  it.each([false,true])('keeps an unknown assessment unresolved with positive land costs (building costs present: %s)',includeBuilding=>{
    const original=basicPlan(),stage=projectOf(original).costs[0]!;
    const land={...stage,id:'land-stage',category:'land' as const,amountCents:2_500_000,treatments:makeAduTreatments(2_500_000,'nondepreciableBasisCents')};
    const plan=mustValidate(changedProject(original,{costs:includeBuilding?[stage,land]:[land]}));
    const resolved=resolveAduPlanningEstimates(plan),project=projectOf(resolved),year=project.propertyTax.paymentYears.find(row=>row.year===2029)!;
    expect(project.propertyTax.addedAssessedValueCents).toEqual({known:false});
    expect(year.complete).toEqual({known:false});
    expect(calculateProjection(resolved,loadRuleSet()).years.find(row=>row.year===2029)!.tax.status).not.toBe('available');
    const explicit=resolveAduPlanningEstimates(mustValidate(changedProject(plan,{propertyTax:{...projectOf(plan).propertyTax,addedAssessedValueCents:{known:true,value:10_000_000}}})));
    expect(projectOf(explicit).propertyTax.paymentYears.find(row=>row.year===2029)!.payments[0]!.amountCents).toBe(120_000);
  });

  it('uses collision-free stable identities for generated tax payments',()=>{
    const original=basicPlan(),first=projectOf(resolveAduPlanningEstimates(mustValidate(original))).propertyTax.paymentYears.find(row=>row.year===2028)!.payments[0]!.id;
    const plan=mustValidate({...original,expenses:[{id:first,name:'Existing personal expense',amountCents:100,frequency:'annual',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}]});
    const resolved=resolveAduPlanningEstimates(plan),generated=projectOf(resolved).propertyTax.paymentYears.find(row=>row.year===2028)!.payments[0]!.id;
    expect(generated).not.toBe(first);
    expect(validatePlan(resolved).ok).toBe(true);
    expect(resolveAduPlanningEstimates(resolved)).toEqual(resolved);
  });

  it('keeps overflowing estimates unavailable without throwing or substituting zero tax',()=>{
    const original=basicPlan(),project=projectOf(original);
    const plan=mustValidate(changedProject(original,{taxEstimation:{mode:'simple',propertyTaxRateBps:100_000},propertyTax:{...project.propertyTax,addedAssessedValueCents:{known:true,value:MAX_CENTS}}}));
    const resolved=resolveAduPlanningEstimates(plan),row=projectOf(resolved).propertyTax.paymentYears.find(item=>item.year===2029);
    expect(row?.complete.known??false).toBe(false);
    expect(calculateProjection(resolved,loadRuleSet()).years.find(year=>year.year===2029)!.tax.status).not.toBe('available');
    expect(validatePlan(resolved).ok).toBe(true);
  });

  it('leaves unrelated unknown household history unresolved',()=>{
    const original=basicPlan(),plan=mustValidate({...original,household:{...original.household,coverageAnswers:{...original.household.coverageAnswers,additionalIncome:unknown()}}});
    const resolved=resolveAduPlanningEstimates(plan);
    expect(resolved.household).toEqual(plan.household);
    expect(resolved.household.coverageAnswers.additionalIncome).toEqual({known:false});
    expect(calculateProjection(resolved,loadRuleSet()).years[0]!.tax.status).toBe('needs-data');
  });

  it('reports the assumption-derived nature independently of verified tax rules',()=>{
    const provenance=aduEstimateProvenance(2028);
    expect(provenance.status).toBe('provisional');
    expect(provenance.applicableYear).toBe(2028);
    expect(provenance.assumptions.join(' ')).toMatch(/cost.*proxy|proxy.*cost/i);
    expect(provenance.assumptions.join(' ')).toMatch(/payment|December/i);
    expect(provenance.sources).toContain('https://www.irs.gov/publications/p527');
    expect(provenance.sources).toContain('https://www.boe.ca.gov/proptaxes/newconstructionproperty.htm');
  });
});

describe('legacy and detailed ADU treatments',()=>{
  it('recognizes only untouched legacy basic projects for automatic estimates',()=>{
    const plan=mustValidate(basicPlan('legacy'));
    expect(usesAduPlanningEstimates(plan.properties[0]!,plan.rentals[0]!)).toBe(true);
    const resolved=resolveAduPlanningEstimates(plan);
    expect(projectOf(resolved).taxEstimation).toEqual({mode:'simple',propertyTaxRateBps:120});
    expect(usesAduPlanningEstimates(resolved.properties[0]!,resolved.rentals[0]!)).toBe(true);
    expect(resolveAduPlanningEstimates(resolved)).toEqual(resolved);
  });

  it('retains strict treatment when a legacy or detailed project contains explicit tax decisions',()=>{
    const legacy=basicPlan('legacy'),project=projectOf(legacy);
    const decisions=[
      changedProject(legacy,{taxQualifications:{...project.taxQualifications,federal:{known:true,value:false}}}),
      changedProject(legacy,{costs:[{...project.costs[0]!,treatments:makeAduTreatments(10_000_000)}]}),
      changedProject(legacy,{propertyTax:{...project.propertyTax,paymentYears:[{year:2028,complete:{known:true,value:true},payments:[]}]}}),
      {...legacy,rentals:[{...legacy.rentals[0]!,activeParticipation:{known:true as const,value:false}}]},
      basicPlan('detailed'),makeAduPlan(),
    ];
    for(const document of decisions){const plan=mustValidate(document);expect(usesAduPlanningEstimates(plan.properties[0]!,plan.rentals[0]!)).toBe(false);expect(resolveAduPlanningEstimates(plan)).toBe(plan);}
  });

  it.each([{mode:'simple',propertyTaxRateBps:-1},{mode:'simple',propertyTaxRateBps:120.5},{mode:'simple'},{mode:'unsupported'}])('rejects invalid estimation settings %j',taxEstimation=>{
    const original=basicPlan();
    const document={...original,properties:[{...original.properties[0]!,aduProject:{...projectOf(original),taxEstimation}}]};
    expect(validatePlan(document).ok).toBe(false);
  });
});

describe('ordinary simple project financing assumptions',()=>{
  function financedPlan():PlanDocument {
    const original=basicPlan();
    return changedProject(original,{financing:{id:'adu-loan',name:'Project loan',aprBps:600,termMonths:360,collateralPropertyId:'home',firstAmortizingPaymentMonth:'2028-07',
      draws:[{id:'draw',month:'2028-06',amountCents:5_000_000,costAllocations:[{costId:'building-stage',amountCents:5_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:unknown(),rentalInterestQualified:unknown(),financingAtRiskQualification:unknown()}});
  }

  it('capitalizes supported construction-month interest and deducts post-readiness interest once',()=>{
    const plan=mustValidate(financedPlan()),resolved=resolveAduPlanningEstimates(plan),project=projectOf(resolved);
    expect(project.financing).toMatchObject({proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}});
    expect(project.productionPeriod).toEqual({known:true,value:{startDate:'2026-01-01',endDate:'2028-06-01',uninterrupted:true}});
    expect(project.financing!.interestTaxRows).toHaveLength(1);
    expect(project.financing!.interestTaxRows[0]).toMatchObject({month:'2028-06',treatments:{federal:{known:true,value:{buildingBasisCents:25_000,currentDeductionCents:0}}}});
    const projection=calculateProjection(resolved,loadRuleSet()),year=aduValue(projection.years.find(row=>row.year===2028)!.household),facts=year.facts.preIra.rentalFacts[0]!;
    expect(year.tax.status).toBe('available');
    expect(aduValue(facts.books.federal).openingState.recoveryBasisCents).toBe(10_025_000);
    expect(aduValue(facts.books.federal).eligibleInterestCents).toBeGreaterThan(0);
    expect(resolveAduPlanningEstimates(resolved)).toEqual(resolved);
  });

  it('preserves explicit financing rejections and unknown interest outside a confirmed production period',()=>{
    const original=financedPlan(),loan=projectOf(original).financing!;
    const plan=mustValidate(changedProject(original,{productionPeriod:{known:true,value:{startDate:'2026-01-01',endDate:'2028-05-31',uninterrupted:true}},financing:{...loan,rentalInterestQualified:{known:true,value:false},interestTaxRows:[{id:'entered-interest',month:'2028-06',treatments:unknownTreatments()}]}}));
    const project=projectOf(resolveAduPlanningEstimates(plan));
    expect(project.financing!.rentalInterestQualified).toEqual({known:true,value:false});
    expect(project.financing!.interestTaxRows[0]!.treatments).toEqual(unknownTreatments());
  });
});
