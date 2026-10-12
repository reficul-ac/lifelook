import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/engine/validation';
import { makePlan } from '../helpers/plans';
import { loadReferences } from '../helpers/references';
import type { PlanDocument } from '../../src/engine/model/plan';
import { checkCoverage } from '../../src/engine/coverage';

const propertyPlan=()=>structuredClone(loadReferences<{plan:PlanDocument},unknown>('property-2026')[0]!.input.plan);
describe('source-required tax qualification histories',()=>{
  it('validates senior deduction eligibility confirmation without storing an identifier',()=>{
    const p=makePlan();const raw={...p,household:{...p.household,filers:[{...p.household.filers[0],seniorDeductionSsnEligible:{known:true,value:'yes'}},p.household.filers[1]]}};
    const result=validatePlan(raw);expect(result.ok).toBe(false);
    expect(result.issues.some(i=>i.field==='seniorDeductionSsnEligible.value')).toBe(true);
  });
  it('requires adulthood on January 1 instead of a later birthday in the forecast year',()=>{
    const p=makePlan();const raw={...p,household:{...p.household,filers:[{...p.household.filers[0],birthDate:{known:true,value:'2008-12-31'}},p.household.filers[1]]}};
    expect(validatePlan(raw).ok).toBe(false);
  });
  it('a rental without the California business exclusion remains in ordinary rental scope',()=>{
    const p=propertyPlan();const raw={...p,rentals:p.rentals.map(r=>({...r,qualifications:{...r.qualifications,californiaSmallBusinessQualification:{known:true as const,value:false}}}))};
    const result=validatePlan(raw);if(!result.ok)throw new Error(JSON.stringify(result.issues));
    expect(checkCoverage(result.plan,2026).issues.some(i=>i.field==='qualifications.californiaSmallBusinessQualification')).toBe(false);
  });
  it('rejects malformed mortgage-insurance qualification instead of retaining an unchecked input',()=>{
    const raw={...makePlan(),expenses:[{id:'mip',name:'Mortgage insurance',amountCents:10000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'mortgage-insurance',mortgageInsuranceQualification:{known:true,value:'yes'}}]};
    const result=validatePlan(raw);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({recordId:'mip',field:'mortgageInsuranceQualification.value'})]));
  });
  it('validates California business qualification independently from QBI',()=>{
    const p=propertyPlan();
    const raw={...p,rentals:p.rentals.map(r=>({...r,qualifications:{...r.qualifications,californiaSmallBusinessQualification:{known:true,value:123}}}))};
    const result=validatePlan(raw);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i=>i.field==='qualifications.californiaSmallBusinessQualification.value')).toBe(true);
  });
  it('validates participation at the loss origin separately from current participation',()=>{
    const p=propertyPlan();const r=p.rentals[0]!;const h=r.taxHistory.federal;
    if(!h.known)throw new Error('Synthetic fixture must have known history');
    const raw={...p,rentals:[{...r,taxHistory:{...r.taxHistory,federal:{known:true,value:{...h.value,passiveSuspendedCents:100,lossVintages:[{year:2025,source:'passive',amountCents:100,activeParticipation:{known:true,value:'yes'}}]}}}}]};
    const result=validatePlan(raw);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i=>i.field?.endsWith('lossVintages[0].activeParticipation.value'))).toBe(true);
  });
  it('validates historical QBI qualification instead of reusing current qualification',()=>{
    const p=propertyPlan(),r=p.rentals[0]!,h=r.taxHistory.federal;
    if(!h.known)throw new Error('Known synthetic history required');
    const raw={...p,rentals:[{...r,taxHistory:{...r.taxHistory,federal:{known:true,value:{...h.value,passiveSuspendedCents:100,lossVintages:[{year:2025,source:'passive',amountCents:100,qbiQualification:{known:true,value:'yes'}}]}}}}]};
    const result=validatePlan(raw);expect(result.ok).toBe(false);
    expect(result.issues.some(i=>i.field?.endsWith('lossVintages[0].qbiQualification.value'))).toBe(true);
  });
});
