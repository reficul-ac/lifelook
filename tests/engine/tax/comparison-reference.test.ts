import { describe,expect,it } from 'vitest';
import type { CashYear } from '../../../src/engine/cash/income';
import type { ContributionRequest } from '../../../src/engine/cash/contribution-requests';
import type { PlanDocument } from '../../../src/engine/model/plan';
import type { Available } from '../../../src/engine/model/results';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import type { PropertyYearFacts } from '../../../src/engine/property/facts';
import type { LoanSchedule } from '../../../src/engine/property/loans';
import type { YearRules } from '../../../src/engine/rules/types';
import { buildPropertyFacts } from '../../../src/engine/property/facts';
import { resolveHouseholdYear,type HouseholdYear } from '../../../src/engine/tax/comparison';
import { assertReference,loadReferences } from '../../helpers/references';
import { mustValidate } from '../../helpers/plans';

/** The seven exact public arguments; the stored plan is validated before use. */
interface ComparisonReferenceInput {
  readonly plan:PlanDocument;readonly cash:CashYear;readonly requests:readonly ContributionRequest[];
  readonly property:PropertyYearFacts;readonly loans:readonly LoanSchedule[];
  readonly opening:HouseholdTaxState;readonly rules:YearRules;
}
type Expected=Readonly<Record<string,unknown>>;
const references=loadReferences<ComparisonReferenceInput,Expected>('comparison-2026');
function resolve(input:ComparisonReferenceInput):HouseholdYear {
  return resolveHouseholdYear(mustValidate(input.plan),input.cash,input.requests,input.property,input.loans,input.opening,input.rules);
}
function knownValue<T,V>(result:Available<T>,extract:(v:T)=>V):{status:string;value?:V} {
  return result.status==='available'?{status:result.status,value:extract(result.value)}:{status:result.status};
}
function referenceView(result:HouseholdYear):unknown {
  const tax=result.tax;
  const accountIds=[...new Set(result.contributions.map(c=>c.accountId))].sort();
  const total=(accountId:string,field:'eligibleCents'|'deductibleCents'|'preventedCents')=>{
    const values=result.contributions.filter(c=>c.accountId===accountId).map(c=>c[field]);
    const missing=values.filter(v=>v.status!=='available');
    return missing.length?{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data'}:{status:'available',value:values.reduce((sum,v)=>sum+(v.status==='available'?v.value:0),0)};
  };
  return {
    tax:tax.status==='available'?{status:tax.status,federalMethod:tax.value.selectedMethods.federal,californiaMethod:tax.value.selectedMethods.california,federalCents:tax.value.federal.totalCents,californiaCents:tax.value.california.totalCents,combinedCents:tax.value.combinedIncomeTaxCents}:{status:tax.status},
    payroll:{totalCents:result.payroll.annual.totalCents,sdiCents:result.payroll.annual.sdiCents},
    candidateOrder:result.candidates.map(c=>c.id),
    candidates:Object.fromEntries(result.candidates.map(c=>[c.id,{
      federal:knownValue(c.federal,v=>v.totalCents),california:knownValue(c.california,v=>v.totalCents),combined:knownValue(c.combinedIncomeTaxCents,v=>v),
      statePaid:c.statePaid.status==='available'?{status:c.statePaid.status,californiaIncomeTaxPaidCents:c.statePaid.value.californiaIncomeTaxPaidCents,sdiPaidCents:c.statePaid.value.sdiPaidCents,source:c.statePaid.value.source}:{status:c.statePaid.status},
    }])),
    candidateFederalCreditMarkers:Object.fromEntries(result.candidates.map(c=>[c.id,c.federal.status==='available'?c.federal.value.closingState.minimumTaxCreditCoverage.federal:undefined])),
    selectedDeduction:tax.status==='available'?{federalCents:tax.value.deductions.federal.allowedItemizedCents,standardFederalCents:tax.value.deductions.federal.standardCents}:undefined,
    closing:result.closingTaxState,
    contributionsByAccount:Object.fromEntries(accountIds.map(id=>[id,{eligibleCents:total(id,'eligibleCents'),deductibleCents:total(id,'deductibleCents'),preventedCents:total(id,'preventedCents')}])),
    facts:{federalAgiCents:knownValue(result.facts.federalAgiCents,v=>v),californiaAgiCents:knownValue(result.facts.californiaAgiCents,v=>v)},
    ira:{federalDeductibleCents:knownValue(result.ira.federalDeductibleCents,v=>v)},
  };
}
function at(value:unknown,path:string):unknown {
  return path.split('.').reduce<unknown>((node,key)=>(node as Record<string,unknown>)[key],value);
}

describe('independent whole-household comparison references',()=>{
  it.each(references)('$id',c=>{
    const before=JSON.stringify(c.input);
    const result=resolve(c.input),view=referenceView(result);
    for(const [path,expected]of Object.entries(c.expected))assertReference(at(view,path),expected,c.toleranceCents);
    expect(JSON.stringify(c.input)).toBe(before);
    if(result.tax.status!=='available')expect(result.tax).not.toHaveProperty('value');
    for(const candidate of result.candidates)if(candidate.combinedIncomeTaxCents.status==='available'&&candidate.federal.status==='available'&&candidate.california.status==='available'){
      expect(candidate.combinedIncomeTaxCents.value).toBe(candidate.federal.value.totalCents+candidate.california.value.totalCents);
    }
  });
  it('retains prospective California and payroll assumptions in each paid-tax and federal itemized result',()=>{
    const c=references.find(c=>c.id==='all-four-paid-tax-low-income-method-mismatch')!;
    const result=resolve(c.input);
    for(const candidate of result.candidates){
      expect(candidate.statePaid.status).toBe('available');if(candidate.statePaid.status!=='available')continue;
      expect(candidate.statePaid.value.provenance?.status).toBe('provisional');
      expect(candidate.statePaid.value.provenance?.sources).toContain('https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/');
      if(candidate.federalMethod==='itemized'&&candidate.federal.status==='available'){
        expect(candidate.federal.value.provenance.status).toBe('provisional');
        expect(candidate.federal.value.provenance.sources).toContain('https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html');
      }
    }
  });
  it('carries the selected first-year minimum-tax-credit boundary into the next actual resolution',()=>{
    const first=references.find(c=>c.id==='amt-lower-itemization-beats-larger-standard')!;
    const next=references.find(c=>c.id==='second-year-established-minimum-tax-credit-boundary')!;
    const initial=resolve(first.input);
    expect(initial.closingTaxState.minimumTaxCreditCoverage.federal).toEqual({known:true,value:true});
    const plan=mustValidate(next.input.plan);
    const property=buildPropertyFacts(plan,next.input.cash,next.input.loans,initial.closingTaxState,next.input.rules);
    const subsequent=resolve({...next.input,property,opening:initial.closingTaxState});
    expect(subsequent.tax.status).toBe('unsupported-case');
    expect(subsequent.tax).not.toHaveProperty('value');
    expect(subsequent.closingTaxState.minimumTaxCreditCoverage.federal).toEqual({known:true,value:true});
  });
  it('carries qualified rental losses once while an unrelated deduction remains unknown',()=>{
    const first=references.find(c=>c.id==='qbi-state-carries-despite-unrelated-personal-unknown')!;
    const next=references.find(c=>c.id==='second-year-independent-qbi-loss-release')!;
    const initial=resolve(first.input);
    expect(initial.tax.status).toBe('needs-data');
    expect(initial.closingTaxState.qbiLossVintages.rent).toEqual({known:true,value:[{year:2024,amountCents:1000000}]});
    const plan=mustValidate(next.input.plan);
    const property=buildPropertyFacts(plan,next.input.cash,next.input.loans,initial.closingTaxState,next.input.rules);
    const subsequent=resolve({...next.input,property,opening:initial.closingTaxState});
    expect(subsequent.tax.status).toBe('needs-data');
    expect(subsequent.closingTaxState.qbiLossVintages.rent).toEqual({known:true,value:[]});
  });
  it('uses finalized IRA funding once in monthly priority order and carries only traditional nondeductible basis',()=>{
    const c=references.find(c=>c.id==='final-ira-funding-order-precedes-tax-comparison')!;
    const result=resolve(c.input);
    expect(result.contributions).toHaveLength(24);
    for(const record of result.contributions){
      expect(record.eligibleCents).toEqual({status:'available',value:record.month<=6?62500:0});
      if(record.accountId==='traditional')expect(record.deductibleCents).toEqual({status:'available',value:record.month<=5?62500:record.month===6?25500:0});
    }
    expect(result.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:37000});
  });
  it('retains the contribution tax scenario when known retirement distributions make household liability incomplete',()=>{
    const c=references.find(c=>c.id==='final-ira-funding-order-precedes-tax-comparison')!;
    const plan={...c.input.plan,household:{...c.input.plan.household,coverageAnswers:{...c.input.plan.household.coverageAnswers,retirementDistributions:{known:true as const,value:true}}}};
    const result=resolve({...c.input,plan});
    expect(result.tax.status).toBe('available');if(result.tax.status!=='available')return;
    expect(result.tax.value.combinedIncomeTaxCents).toBe(1665600);
    expect(result.payroll.annual.totalCents).toBe(1253000);
    expect(result.contributions.reduce((sum,c)=>sum+(c.eligibleCents.status==='available'?c.eligibleCents.value:0),0)).toBe(750000);
    expect(result.facts.federalAgiCents).toEqual({status:'available',value:13662000});
    expect(result.coverage.completeForModeledScope).toBe(true);
    expect(result.coverage.completeHouseholdLiability).toBe(false);
    expect(result.coverage.issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'household.coverageAnswers.retirementDistributions'})]));
  });
  it('merges the selected California small-business AMT carry override into joint closing state',()=>{
    const c=references.find(c=>c.id==='amt-lower-itemization-beats-larger-standard')!;
    const unit=c.input.plan.rentals[0]!;
    const plan={...c.input.plan,rentals:[{...unit,qualifications:{...unit.qualifications,californiaSmallBusinessQualification:{known:true as const,value:true}},taxHistory:{...unit.taxHistory,'california-amt':unit.taxHistory['federal-amt']}}]};
    const prior=c.input.opening.rentals.rent!;
    const opening={...c.input.opening,rentals:{...c.input.opening.rentals,rent:{...prior,'california-amt':prior['federal-amt']}}};
    const property=buildPropertyFacts(mustValidate(plan),c.input.cash,c.input.loans,opening,c.input.rules);
    const result=resolve({...c.input,plan,opening,property});
    expect(result.tax.status).toBe('available');if(result.tax.status!=='available')return;
    expect(result.tax.value.selectedMethods).toEqual({federal:'itemized',california:'itemized'});
    expect(result.tax.value.combinedIncomeTaxCents).toBe(4187700);
    // The annual rental resolver knows a physical AMT book, but ScheduleP's
    // separately confirmed business exclusion changes future deduction history.
    expect(result.rental.closing.rentals.rent?.['california-amt'].status).toBe('available');
    const carried=result.closingTaxState.rentals.rent?.['california-amt'];
    expect(carried?.status).toBe('unsupported-case');
    if(carried?.status!=='available')expect(carried?.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'unsupported-california-business-amt-carry',recordId:'rent'})]));
    expect(result.closingTaxState.rentals.rent?.california.status).toBe('available');
  });
});
