import {describe,expect,it} from 'vitest';
import type {Available} from '../../src/engine/model/results';
import {calculateProjection} from '../../src/engine/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {makeAllocationPolicy} from '../helpers/allocations';
import {makeAduPlan} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';

/** A new project with its required amounts entered and tax answers still unknown. */
function incompleteAdu(horizonYears:number){
 const unknown={known:false} as const;
 const source=makeAduPlan({horizonYears,cashFlowAllocation:makeAllocationPolicy()});
 const property=source.properties[0]!,project=property.aduProject!,rental=source.rentals[0]!;
 return mustValidate({...source,properties:[{...property,aduProject:{...project,
  taxEstimation:{mode:'detailed'},
  constructionStartDate:'2026-01-01',completionDate:'2026-12-31',
  costs:project.costs.map(cost=>({...cost,paymentDate:'2026-12-31',treatments:{federal:unknown,california:unknown,'federal-amt':unknown,'california-amt':unknown}})),
  propertyTax:{...project.propertyTax,addedAssessedValueCents:unknown,marginalRateBps:unknown,paymentYears:[{year:2026,complete:unknown,payments:[]}],originalExpenseExcludesAdu:unknown},
  taxQualifications:{federal:unknown,california:unknown,'federal-amt':unknown,'california-amt':unknown},productionPeriod:unknown,supportOperatingDeficits:unknown,
 }}],rentals:[{...rental,availableDate:'2027-01-01',rentStartDate:'2027-01-01',monthlyRentCents:200_000,
  activeParticipation:unknown,conversionBuildingFmv:unknown,
  qualifications:{longTermFairMarketLease:unknown,noPersonalUse:unknown,noSubstantialTenantServices:unknown,ordinaryResidential:unknown,advancedBasisAdjustments:unknown,californiaSmallBusinessQualification:unknown},
  qbi:{...rental.qbi,qualification:unknown,wagesCents:unknown,ubiaCents:unknown},
 }]});
}

function reasons(value:Available<unknown>){
 expect(value.status).toBe('needs-data');
 if(value.status==='available')throw new Error('Expected unresolved ADU inputs.');
 return value.issues;
}

describe('incomplete ADU projection inputs',()=>{
 it('keeps missing-input reasons distinct when cash totals share dependencies',()=>{
  const result=calculateProjection(incompleteAdu(1),loadRuleSet()),month=result.months[11]!;
  for(const amount of [month.cashFlowCents,month.reserveCents,month.adu!.allocationCashFlowCents]){
   const issues=reasons(amount);
   expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'required-adu-tax-payments'}),expect.objectContaining({code:'required-adu-original-tax-scope'})]));
   expect(issues).toHaveLength(new Set(issues.map(issue=>JSON.stringify(issue))).size);
  }
 });

 it('projects twenty years with unanswered ADU histories and an allocation policy',()=>{
  const result=calculateProjection(incompleteAdu(20),loadRuleSet());
  expect(result.months).toHaveLength(240);
  expect(result.years).toHaveLength(20);
  expect(result.months[11]!.adu!.constructionCostCents).toEqual({status:'available',value:30_000_000});
  expect(result.months[12]!.rentCents).toEqual({status:'available',value:200_000});
  expect(result.years[19]!.propertyValueCents).toEqual({status:'available',value:122_000_000});
  expect(reasons(result.years[19]!.cashFlowCents)).toEqual(expect.arrayContaining([expect.objectContaining({code:'required-adu-tax-payments',year:2045})]));
 });
});
