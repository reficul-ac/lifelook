import { describe, expect, it } from 'vitest';
import { makePlan } from '../../helpers/plans';
import { loadReferences, assertReference } from '../../helpers/references';
import { loadRuleSet } from '../../../src/engine/rules/registry';
import { resolveYearRules } from '../../../src/engine/rules/projection';
import { calculateMortgageDeduction } from '../../../src/engine/tax/mortgage';
import { standardDeduction, federalSaltDeduction, limitFederalItemized, buildItemizedCandidate, type ItemizedFacts } from '../../../src/engine/tax/itemized';
import type { PropertyYearFacts } from '../../../src/engine/property/facts';
import type { LoanSchedule } from '../../../src/engine/property/loans';
import type { Available } from '../../../src/engine/model/results';
import type { StateTaxPaid } from '../../../src/engine/tax/itemized';
const resolved = resolveYearRules(loadRuleSet(), 2026, makePlan().taxPolicy);
if (resolved.status !== 'available') throw new Error('Missing sourced rules');
const rules = resolved.value;
type Input = { kind: 'salt'|'restriction'|'standard'|'mortgage'|'candidate'; paidCents?:number;magiCents?:number; itemizedCents?:number;taxableCents?:number;birthDates?: (string|null)[]; jurisdiction?:'federal'|'california'; property?:PropertyYearFacts; loans?:LoanSchedule[];facts?:ItemizedFacts;statePaid?:Available<StateTaxPaid> };
describe('qualified personal deductions', () => {
  it.each(loadReferences<Input,unknown>('itemized-2026'))('$id', c => {
    const i=c.input;
    let actual:unknown;
    if(i.kind==='salt') actual=federalSaltDeduction(i.paidCents!,i.magiCents!,rules);
    else if(i.kind==='restriction') actual=limitFederalItemized(i.itemizedCents!,i.taxableCents!,rules);
    else if(i.kind==='standard') {
      const filers=makePlan().household.filers.map((f,n)=>({...f,birthDate:i.birthDates![n]===null?{known:false as const}:{known:true as const,value:i.birthDates![n]!}}));
      actual=standardDeduction(filers,2026,i.jurisdiction!,rules);
    } else if(i.kind==='candidate'){
      const p=i.property!;
      const c=buildItemizedCandidate(i.facts!,p,{federal:calculateMortgageDeduction(p,i.loans!,'federal',rules),california:calculateMortgageDeduction(p,i.loans!,'california',rules)},i.statePaid!,rules);
      const extract=(v:typeof c.federal)=>v.status==='available'?{status:v.status,allowedCents:v.value.allowedCents,mortgageInsuranceCents:v.value.mortgageInsuranceCents,niitDeductionCents:v.value.niitDeductionCents,amtAllowedCents:v.value.amtAllowedCents}:{status:v.status};
      actual={federal:extract(c.federal),california:extract(c.california)};
    } else {
      const r=calculateMortgageDeduction(i.property!,i.loans!,i.jurisdiction!,rules);
      actual=r.status==='available'?{status:r.status,paidInterestCents:r.value.paidInterestCents,allowedInterestCents:r.value.allowedInterestCents,averageQualifiedDebtCents:r.value.averageQualifiedDebtCents,applicableLimitCents:r.value.applicableLimitCents}:r;
    }
    assertReference(actual,c.expected,c.toleranceCents);
  });
  it('does not turn unavailable mortgage history into zero', () => {
    const reference=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!;
    const input=reference.input;
    const property={...input.property!,personal:{...input.property!.personal,loans:input.property!.personal.loans.map(l=>{const {qualification:_q,...rest}=l;return rest;})}};
    const r=calculateMortgageDeduction(property,input.loans!,'federal',rules);
    expect(r.status).toBe('needs-data');
    expect(r).not.toHaveProperty('value');
    expect(input.loans![0]!.months[0]!.paymentCents).toBe(500000);
  });
  it.each(['federal', 'california'] as const)('uses qualified schedule-estimated balances for %s forecast deductions', jurisdiction => {
    const input=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!.input;
    const loans=input.loans!.map(loan=>({...loan,openingProvenance:'estimated' as const}));
    const r=calculateMortgageDeduction(input.property!,loans,jurisdiction,rules);
    expect(r.status).toBe('available');
    if(r.status!=='available')return;
    expect(r.value.averageQualifiedDebtCents).toBe(100000000);
    expect(r.value.allowedInterestCents).toBe(jurisdiction==='federal'?4500000:6000000);
    expect(r.value.issues).toContainEqual(expect.objectContaining({code:'estimated-mortgage-deduction',severity:'info',recordId:loans[0]!.loanId,field:'openingBalance'}));
    expect(r.value.provenance.assumptions.some(a=>a.includes('loan schedule'))).toBe(true);
    const confirmed=calculateMortgageDeduction(input.property!,input.loans!,jurisdiction,rules);
    expect(confirmed.status).toBe('available');
    if(confirmed.status==='available')expect(r.value.provenance.status).toBe(confirmed.value.provenance.status);
  });
  it('keeps payment-only estimates visible without replacing a known opening balance', () => {
    const input=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!.input;
    const loans=input.loans!.map(loan=>({...loan,paymentProvenance:'estimated' as const}));
    const r=calculateMortgageDeduction(input.property!,loans,'federal',rules);
    expect(r.status).toBe('available');
    if(r.status!=='available')return;
    expect(r.value.allowedInterestCents).toBe(4500000);
    expect(r.value.issues).toContainEqual(expect.objectContaining({code:'estimated-mortgage-deduction',field:'openingPayment'}));
    expect(loans[0]!.openingProvenance).toBe('known');
  });
  it('still requires annual balance evidence for an estimated qualified mortgage', () => {
    const input=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!.input;
    const loans=input.loans!.map(loan=>({...loan,openingProvenance:'estimated' as const,averageBalanceEvidence:[]}));
    const r=calculateMortgageDeduction(input.property!,loans,'federal',rules);
    expect(r.status).toBe('needs-data');
    expect(r).not.toHaveProperty('value');
    if(r.status!=='available')expect(r.issues).toContainEqual(expect.objectContaining({code:'required-mortgage-average-balance'}));
  });
  it('does not label confirmed loan inputs as estimated', () => {
    const input=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!.input;
    const r=calculateMortgageDeduction(input.property!,input.loans!,'federal',rules);
    expect(r.status).toBe('available');
    if(r.status==='available')expect(r.value.issues.some(i=>i.code==='estimated-mortgage-deduction')).toBe(false);
  });
  it('California standard is independent of unknown filer ages', () => {
    const filers=makePlan().household.filers.map(f=>({...f,birthDate:{known:false as const}}));
    expect(standardDeduction(filers,2026,'california',rules)).toEqual({status:'available',value:1180000});
  });
  it('blocks federal age-dependent standard addition while retaining California',()=>{
    const filers=makePlan().household.filers.map(f=>({...f,birthDate:{known:false as const}}));
    const r=standardDeduction(filers,2026,'federal',rules);
    expect(r.status).toBe('needs-data');expect(r).not.toHaveProperty('value');
  });
});

describe('independent jurisdiction candidates',()=>{
  const seed=loadReferences<Input,unknown>('itemized-2026').find(c=>c.id==='post-2017-interest-only-federal')!.input;
  const facts:ItemizedFacts={year:2026,federalAgiCents:{status:'available',value:16000000},saltMagiCents:{status:'available',value:16000000},niitOtherIncomeCents:{status:'available',value:0},rental:{federal:{status:'available',value:{allowedRentalCents:6000000}}}};
  function property(mip=0):PropertyYearFacts{return {...seed.property!,personal:{...seed.property!.personal,propertyTaxPaidCents:1000000,homeownersInsuranceCents:200000,mortgageInsuranceCents:mip}};}
  function mortgages(p:PropertyYearFacts){return {federal:calculateMortgageDeduction(p,seed.loans!,'federal',rules),california:calculateMortgageDeduction(p,seed.loans!,'california',rules)};}
  it.each(['federal', 'california'] as const)('retains loan estimate assumptions in %s itemization', jurisdiction=>{
    const p=property();
    const loans=seed.loans!.map(loan=>({...loan,openingProvenance:'estimated' as const}));
    const mortgage={federal:calculateMortgageDeduction(p,loans,'federal',rules),california:calculateMortgageDeduction(p,loans,'california',rules)};
    const candidate=buildItemizedCandidate(facts,p,mortgage,{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:100000,source:'actual-override'}},rules)[jurisdiction];
    expect(candidate.status).toBe('available');
    if(candidate.status!=='available')return;
    expect(candidate.value.allowedCents).toBe(jurisdiction==='federal'?6600000:7000000);
    expect(candidate.value.reasons).toContainEqual(expect.objectContaining({code:'estimated-mortgage-deduction',severity:'info'}));
    expect(candidate.value.provenance.assumptions.some(a=>a.includes('loan schedule'))).toBe(true);
  });
  it('uses actual paid state taxes, excludes homeowners insurance, and allocates NIIT taxes',()=>{
    const p=property();const c=buildItemizedCandidate(facts,p,mortgages(p),{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:100000,source:'actual-override'}},rules);
    expect(c.federal.status).toBe('available');expect(c.california.status).toBe('available');
    if(c.federal.status!=='available'||c.california.status!=='available')return;
    expect(c.federal.value.allowedCents).toBe(6600000);
    expect(c.california.value.allowedCents).toBe(7000000);
    expect(c.federal.value.statePaid?.source).toBe('actual-override');
    // Form8960 reasonable allocation: rental60k/AGI160k*stateincome tax10k=3750.
    expect(c.federal.value.niitDeductionCents).toEqual({status:'available',value:375000});
    expect(c.california.value.amtAllowedCents).toBe(6000000);
  });
  it('keeps California available while state-paid facts are unknown',()=>{
    const p=property();const c=buildItemizedCandidate(facts,p,mortgages(p),{status:'needs-data',issues:[]},rules);
    expect(c.federal.status).toBe('needs-data');expect(c.federal).not.toHaveProperty('value');expect(c.california.status).toBe('available');
  });
  it('retains derived California payment provenance in federal itemization',()=>{
    const p=property();
    const provenance={status:'provisional' as const,ruleVersion:rules.ruleVersion,baselineYear:2026,applicableYear:2026,sources:['https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html'],assumptions:['Independent provisional California payment assumption.']};
    const statePaid={status:'available' as const,value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:100000,source:'prospective-assumption' as const,provenance}};
    const c=buildItemizedCandidate(facts,p,mortgages(p),statePaid,rules);
    expect(c.federal.status).toBe('available');if(c.federal.status!=='available')return;
    expect(c.federal.value.provenance.status).toBe('provisional');
    expect(c.federal.value.provenance.assumptions).toContain('Independent provisional California payment assumption.');
  });
  it('uses federal AGI for the independent California high-income reduction',()=>{
    const p=property();const c=buildItemizedCandidate({...facts,federalAgiCents:{status:'available',value:60000000}},p,mortgages(p),{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:100000,source:'prospective-assumption'}},rules);
    expect(c.california.status).toBe('available');if(c.california.status!=='available')return;
    expect(c.california.value.allowedCents).toBe(6426466);
    expect(c.california.value.amtAllowedCents).toBe(6000000);
    expect(c.california.value.provenance.status).toBe('provisional');
  });
  it('requires explicit positive personal mortgage insurance qualification',()=>{
    const p=property(100000);const c=buildItemizedCandidate(facts,p,mortgages(p),{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:0,source:'actual-override'}},rules);
    expect(c.federal.status).toBe('needs-data');expect(c.california.status).toBe('available');
  });
  it.each([[10000000,100000],[10000001,90000],[10900000,10000],[10900001,0]])('applies qualified mortgage insurance step phaseout at AGI %i',(agi,expectedMpi)=>{
    const p:PropertyYearFacts={...property(100000),expenses:[{expenseId:'mpi',propertyId:'home',taxCategory:'mortgage-insurance',paidCents:100000,personalCents:100000,rentalCentsByUnit:{},mortgageInsuranceQualification:{known:true,value:true}}]};
    const c=buildItemizedCandidate({...facts,federalAgiCents:{status:'available',value:agi}},p,mortgages(p),{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:0,source:'actual-override'}},rules);
    expect(c.federal.status).toBe('available');if(c.federal.status!=='available')return;
    expect(c.federal.value.mortgageInsuranceCents).toBe(expectedMpi);
    expect(c.federal.value.allowedCents).toBe(6500000+expectedMpi);
    expect(c.california.status).toBe('available');if(c.california.status==='available')expect(c.california.value.mortgageInsuranceCents).toBe(0);
  });
  it('disallows explicitly unqualified personal mortgage insurance without blocking other deductions',()=>{
    const p:PropertyYearFacts={...property(100000),expenses:[{expenseId:'mpi',propertyId:'home',taxCategory:'mortgage-insurance',paidCents:100000,personalCents:100000,rentalCentsByUnit:{},mortgageInsuranceQualification:{known:true,value:false}}]};
    const c=buildItemizedCandidate(facts,p,mortgages(p),{status:'available',value:{californiaIncomeTaxPaidCents:1000000,sdiPaidCents:0,source:'actual-override'}},rules);
    expect(c.federal.status).toBe('available');if(c.federal.status==='available')expect(c.federal.value.mortgageInsuranceCents).toBe(0);
  });
  it('preserves unavailable refinance history and independent loan cash',()=>{
    const p=property();const l=p.personal.loans[0]!;const q=l.qualification!;
    const changed:PropertyYearFacts={...p,personal:{...p.personal,loans:[{...l,qualification:{...q,proceedsQualification:{...q.proceedsQualification,kind:'refinance',historyComplete:{known:false}}}}]}};
    const r=calculateMortgageDeduction(changed,seed.loans!,'federal',rules);
    expect(r.status).toBe('needs-data');expect(r).not.toHaveProperty('value');expect(seed.loans![0]!.months[0]!.paymentCents).toBe(500000);
  });
});
