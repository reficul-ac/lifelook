import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/engine/validation';
import { makeAduPlan, makeAduTreatments } from '../helpers/adu';
import { makePlan } from '../helpers/plans';

type Raw = any;
function edited(edit: (p: Raw) => void): Raw { const p = structuredClone(makeAduPlan()); edit(p); return p; }
function financed(p: Raw): void {
  p.properties[0].aduProject.financing = { id: 'build-loan', name: 'Build loan', aprBps: 600, firstAmortizingPaymentMonth: '2027-08', termMonths: 120, collateralPropertyId: 'home', draws: [{id:'draw',month:'2027-06',amountCents:20_000_000,costAllocations:[{costId:'building-stage',amountCents:20_000_000}]}], interestTaxRows: [], proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true} };
}
describe('owned new ADU contracts', () => {
  it('accepts a future project but preserves existing-property restrictions', () => {
    const doc = makeAduPlan(); expect(validatePlan(doc).ok).toBe(true);
    expect(validatePlan({...doc, properties:doc.properties.map(({aduProject,...p})=>p)}).ok).toBe(false);
  });
  it('accepts direct value without primary area and keeps old plans additive', () => {
    const doc=makeAduPlan({}, {valuation:{kind:'value-added',valueAddedCents:22_000_000}});
    const {primaryArea,...property}=doc.properties[0]!;
    expect(validatePlan({...doc,properties:[property]}).ok).toBe(true); expect(validatePlan(makePlan()).ok).toBe(true);
  });
  it('resolves nested record and direct expense ownership without changing inputs', async () => {
    const {getAduProjects,findAduOwner}=await import('../../src/engine/property/adu-ownership');
    const p=edited(p=>{ financed(p); p.expenses.push({id:'adu-upkeep',name:'Upkeep',propertyId:'home',rentalId:'new-adu',amountCents:100,frequency:'monthly',startDate:'2027-08-01',annualGrowthBps:0,use:'rental',taxCategory:'operating'}); });
    const before=JSON.stringify(p); const projects=getAduProjects(p);
    expect(projects.map(x=>[x.property.id,x.project.id,x.rental.id])).toEqual([['home','adu-project','new-adu']]);
    for(const id of ['adu-project','building-stage','build-loan','draw','new-adu','adu-upkeep']) expect(findAduOwner(p,id)).toEqual({propertyId:'home',projectId:'adu-project'});
    expect(findAduOwner(p,'home')).toBeUndefined(); expect(JSON.stringify(p)).toBe(before);
  });
  it('keeps record IDs scoped to each scenario document',()=>{ expect(validatePlan(makeAduPlan()).ok).toBe(true); expect(validatePlan({...makeAduPlan(),id:'fork'}).ok).toBe(true); });
  it('accepts dates beyond the forecast and unknown future treatment',()=>{ const p=edited(p=>{p.properties[0].aduProject.completionDate='2032-07-31'; p.rentals[0].availableDate='2032-08-01';p.rentals[0].rentStartDate='2032-09-01';p.properties[0].aduProject.taxQualifications.federal={known:false};});expect(validatePlan(p).ok).toBe(true); });
  it('rejects an imported project with its required completion date omitted',()=>{
    const imported=JSON.parse(JSON.stringify(makeAduPlan()));delete imported.properties[0].aduProject.completionDate;
    const result=validatePlan(imported);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({recordId:'adu-project',field:'completionDate',severity:'error'})]));
  });
  const cases: readonly [string,(p:Raw)=>void][] = [
    ['completion before start',p=>p.properties[0].aduProject.completionDate='2026-12-31'],
    ['start before forecast',p=>p.properties[0].aduProject.constructionStartDate='2025-12-31'],
    ['payment before forecast',p=>p.properties[0].aduProject.costs[0].paymentDate='2025-12-31'],
    ['payment after completion',p=>p.properties[0].aduProject.costs[0].paymentDate='2027-08-01'],
    ['readiness before completion',p=>p.rentals[0].availableDate='2027-07-01'],
    ['rent before readiness',p=>p.rentals[0].rentStartDate='2027-07-01'],
    ['second rental on project property',p=>p.rentals.push({...p.rentals[0],id:'second'})],
    ['duplicate nested identity',p=>p.properties[0].aduProject.costs[0].id='new-adu'],
    ['negative money',p=>p.properties[0].aduProject.costs[0].amountCents=-1],
    ['unsafe money',p=>p.properties[0].aduProject.valuation.valuePerSquareFootCents=Number.MAX_SAFE_INTEGER+1],
    ['negative vacancy',p=>p.rentals[0].vacancyBps=-1], ['excess vacancy',p=>p.rentals[0].vacancyBps=10_001],
    ['zero added area',p=>p.properties[0].aduArea=0], ['nonfinite area',p=>p.properties[0].aduArea=Infinity],
    ['extra unknown history keys',p=>p.properties[0].aduProject.taxQualifications.federal={known:false,value:false}],
    ['extra known history keys',p=>p.properties[0].aduProject.taxQualifications.federal={known:true,value:true,extra:1}],
    ['preforecast depreciation',p=>p.rentals[0].taxHistory.federal.value.cumulativeDepreciationCents=1],
    ['preforecast basis',p=>p.rentals[0].taxHistory.california.value.recoveryBasisCents=1],
    ['preforecast suspended loss',p=>{p.rentals[0].taxHistory.federal.value.passiveSuspendedCents=1;p.rentals[0].taxHistory.federal.value.lossVintages=[{year:2025,source:'passive',amountCents:1}];}],
    ['preforecast QBI vintage',p=>p.rentals[0].qbi.openingLossVintages={known:true,value:[{year:2025,amountCents:1}]}],
    ['personal-use conversion',p=>p.rentals[0].convertedFromPersonalUse=true],
    ['nonconserving treatment',p=>p.properties[0].aduProject.costs[0].treatments=makeAduTreatments(1)],
    ['nonconserving draw',p=>{financed(p);p.properties[0].aduProject.financing.draws[0].costAllocations[0].amountCents=1;}],
    ['foreign cost allocation',p=>{financed(p);p.properties[0].aduProject.financing.draws[0].costAllocations[0].costId='foreign';}],
    ['draw after paid cost',p=>{financed(p);p.properties[0].aduProject.financing.draws[0].month='2027-08';}],
    ['foreign expense override',p=>p.properties[0].aduProject.sharedExpenseOverrides=[{id:'override',expenseId:'foreign'}]],
    ['shared override stored on new rental',p=>p.rentals[0].sharedAllocation={numerator:1,denominator:3}],
    ['known personal-use project',p=>p.rentals[0].qualifications.noPersonalUse={known:true,value:false}],
  ];
  it.each(cases)('rejects %s',(_,edit)=>expect(validatePlan(edited(edit)).ok).toBe(false));
  it('rejects original mortgage tracing to the future rental',()=>{
    const p=edited(p=>p.properties[0].loans=[{id:'original-loan',name:'Original loan',originalPrincipalCents:100000,aprBps:0,originationDate:'2024-01-01',acquisitionDate:'2024-01-01',termMonths:360,firstPaymentDate:'2024-02-01',openingBalance:{known:true,value:100000},openingPayment:{known:true,value:100},collateralPropertyId:'home',proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:true,value:true},qualifiedPrincipalCents:{known:true,value:100000},historyComplete:{known:true,value:true}},proceedsAllocations:[{propertyId:'home',rentalId:'new-adu',use:'rental',share:{numerator:1,denominator:1}}],financingAtRiskQualification:{known:true,value:true}}]);
    expect(validatePlan(p).ok).toBe(false);
  });
  it('rejects duplicate nested IDs and cross-project references across two owned bundles',()=>{
    const p=edited(p=>{
      const property=structuredClone(p.properties[0]); property.id='second-home';property.name='Second home';property.aduProject.id='second-project';property.aduProject.rentalId='second-unit';property.aduProject.costs[0].id='second-stage';p.properties.push(property);
      p.rentals.push({...structuredClone(p.rentals[0]),id:'second-unit',propertyId:'second-home'});
    });
    expect(validatePlan(p).ok).toBe(true);
    const duplicate=structuredClone(p);duplicate.properties[1].aduProject.costs[0].id='building-stage';expect(validatePlan(duplicate).ok).toBe(false);
    const foreign=structuredClone(p);financed(foreign);foreign.properties[0].aduProject.financing.draws[0].costAllocations[0].costId='second-stage';expect(validatePlan(foreign).ok).toBe(false);
    const expense=structuredClone(p);expense.expenses.push({id:'other-original',name:'Other cost',propertyId:'second-home',amountCents:100,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'operating'});expense.properties[0].aduProject.sharedExpenseOverrides=[{id:'override',expenseId:'other-original'}];expect(validatePlan(expense).ok).toBe(false);
  });

  it('rejects prospective original-expense shares stored outside the owned project',()=>{
    const p=edited(p=>p.expenses=[{id:'home-cost',name:'Original home cost',propertyId:'home',amountCents:100,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'shared',taxCategory:'operating',allocationOverride:{numerator:1,denominator:3}}]);
    expect(validatePlan(p).ok).toBe(false);
  });

});
