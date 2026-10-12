import { describe,expect,it } from 'vitest';
import type { ResolvedTaxFacts } from '../../../src/engine/tax/facts';
import type { DeductionChoice } from '../../../src/engine/tax/itemized';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import { loadReferences,assertReference } from '../../helpers/references';
import { makePlan } from '../../helpers/plans';
import { loadRuleSet } from '../../../src/engine/rules/registry';
import { resolveYearRules } from '../../../src/engine/rules/projection';
import { calculateFederalTax,resolveRentalQbi } from '../../../src/engine/tax/federal';
type Input={facts:ResolvedTaxFacts;deductions:DeductionChoice;opening:HouseholdTaxState};
type Expected={readonly status:string;readonly fields?:Readonly<Record<string,unknown>>};
function at(v:unknown,path:string):unknown{return path.split('.').reduce<unknown>((n,k)=>(n as Record<string,unknown>)[k],v);}
function rules(year:number){const r=resolveYearRules(loadRuleSet(),year,makePlan().taxPolicy);if(r.status!=='available')throw new Error('No rules');return r.value;}
describe('federal annual liability',()=>{
  it.each(loadReferences<Input,Expected>('federal-2026'))('$id',c=>{
    const r=calculateFederalTax(c.input.facts,c.input.deductions,c.input.opening,rules(c.taxYear));
    expect(r.status).toBe(c.expected.status);
    if(r.status!=='available'){expect(r).not.toHaveProperty('value');return;}
    for(const [path,e]of Object.entries(c.expected.fields??{}))assertReference(at(r.value,path),e,c.toleranceCents);
    expect(r.value.totalCents).toBe(r.value.ordinaryTaxCents+r.value.amtCents+r.value.niitCents);
  });
  it('retains income-dependent missing AMT data without a numeric total',()=>{
    const c=loadReferences<Input,Expected>('federal-2026')[0]!;
    const r=calculateFederalTax({...c.input.facts,federalAmtIncomeCents:{status:'needs-data',issues:[]}},c.input.deductions,c.input.opening,rules(2026));
    expect(r.status).toBe('needs-data');expect(r).not.toHaveProperty('value');
  });
  it('does not label unpublished tax-table assumptions fully verified',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='table-low-salary-80000')!;
    const r=calculateFederalTax(c.input.facts,c.input.deductions,c.input.opening,rules(2026));
    expect(r.status).toBe('available');if(r.status==='available')expect(r.value.provenance.status).toBe('provisional');
  });
  it('retains chosen itemized candidate payment provenance in the federal total',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-taxable-cap-before-section68')!;
    const detail=c.input.deductions.detail!;
    const deductions={...c.input.deductions,detail:{...detail,provenance:{...detail.provenance,status:'projected' as const,assumptions:['Derived future state payment scenario.']}}};
    const r=calculateFederalTax(c.input.facts,deductions,c.input.opening,rules(2026));
    expect(r.status).toBe('available');if(r.status!=='available')return;
    expect(r.value.provenance.status).toBe('projected');
    expect(r.value.provenance.assumptions).toContain('Derived future state payment scenario.');
  });
  it('flags a later minimum-tax-credit coverage boundary after deferral AMT',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='amt-separate-rental-book')!;
    const first=calculateFederalTax(c.input.facts,c.input.deductions,c.input.opening,rules(2026));
    expect(first.status).toBe('available');if(first.status!=='available')return;
    expect(first.value.closingState.minimumTaxCreditCoverage.federal).toEqual({known:true,value:true});
    const next=calculateFederalTax({...c.input.facts,year:2027},c.input.deductions,first.value.closingState,rules(2027));
    expect(next.status).toBe('unsupported-case');expect(next).not.toHaveProperty('value');
  });
  it('keeps explicitly unqualified rental QBI at zero',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-explicitly-unqualified')!;
    const r=resolveRentalQbi(c.input.facts,c.input.opening,rules(2026));
    expect(r.status).toBe('available');if(r.status==='available')expect(r.value.potentialDeductionCents).toBe(0);
  });
  it('requires carried QBI history instead of restarting declared plan history',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-qualified-low')!;
    const r=resolveRentalQbi(c.input.facts,{...c.input.opening,qbiLossVintages:{}},rules(2026));
    expect(r.status).toBe('needs-data');expect(r).not.toHaveProperty('value');
  });
  it('excludes pre2018 released losses from QBI and requires later origin qualification',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-qualified-low')!;
    const fed=c.input.facts.rental.federal;if(fed.status!=='available')throw new Error('Reference rental unavailable');
    const record=fed.value.rentals[0]!;
    const pre2018={...c.input.facts,rental:{...c.input.facts.rental,federal:{status:'available' as const,value:{...fed.value,rentals:[{...record,releasedLossVintages:[{year:2017,source:'passive' as const,amountCents:1000000,activeParticipation:{known:true as const,value:true}}]}]}}}};
    const before=resolveRentalQbi(pre2018,c.input.opening,rules(2026));
    expect(before.status).toBe('available');if(before.status==='available')expect(before.value.potentialDeductionCents).toBe(600000);
    const unknownOrigin={...pre2018,rental:{...pre2018.rental,federal:{status:'available' as const,value:{...fed.value,rentals:[{...record,releasedLossVintages:[{year:2020,source:'passive' as const,amountCents:1000000,activeParticipation:{known:true as const,value:true}}]}]}}}};
    expect(resolveRentalQbi(unknownOrigin,c.input.opening,rules(2026)).status).toBe('needs-data');
    const qualifiedOrigin={...unknownOrigin,rental:{...unknownOrigin.rental,federal:{status:'available' as const,value:{...fed.value,rentals:[{...record,releasedLossVintages:[{year:2020,source:'passive' as const,amountCents:1000000,activeParticipation:{known:true as const,value:true},qbiQualification:{known:true as const,value:true}}]}]}}}};
    const after=resolveRentalQbi(qualifiedOrigin,c.input.opening,rules(2026));
    expect(after.status).toBe('available');if(after.status==='available')expect(after.value.potentialDeductionCents).toBe(400000);
  });
  it('requires wage and UBIA data only above the selected taxable-income threshold',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-qualified-low')!;
    const unit=c.input.facts.preIra.rentalFacts[0]!;
    const changed={...c.input.facts,preIra:{...c.input.facts.preIra,rentalFacts:[{...unit,unit:{...unit.unit,qbi:{...unit.unit.qbi,wagesCents:{known:false as const},ubiaCents:{known:false as const}}}}]}};
    expect(calculateFederalTax(changed,c.input.deductions,c.input.opening,rules(2026)).status).toBe('available');
    const high={...changed,federalAgiCents:{status:'available' as const,value:70000000},federalAmtIncomeCents:{status:'available' as const,value:70000000},niitMagiCents:{status:'available' as const,value:70000000}};
    const r=calculateFederalTax(high,c.input.deductions,c.input.opening,rules(2026));
    expect(r.status).toBe('needs-data');expect(r).not.toHaveProperty('value');
  });
  it('carries unused negative qualified income and releases it in a later year',()=>{
    const c=loadReferences<Input,Expected>('federal-2026').find(c=>c.id==='qbi-qualified-low')!;
    const fed=c.input.facts.rental.federal;if(fed.status!=='available')throw new Error('Reference rental unavailable');
    const record=fed.value.rentals[0]!;
    const f={...c.input.facts,rental:{...c.input.facts.rental,federal:{status:'available' as const,value:{...fed.value,rentals:[{...record,taxableProfitCents:-1000000,allowedRentalCents:-1000000,releasedLossVintages:[{year:2026,source:'passive' as const,amountCents:1000000,activeParticipation:{known:true as const,value:true},qbiQualification:{known:true as const,value:true}}]}]}}}};
    const first=resolveRentalQbi(f,c.input.opening,rules(2026));expect(first.status).toBe('available');if(first.status!=='available')return;
    expect(first.value.potentialDeductionCents).toBe(0);expect(first.value.closingLossVintagesByRental.rent).toEqual({known:true,value:[{year:2026,amountCents:1000000}]});
    const next=resolveRentalQbi({...c.input.facts,year:2027},{...c.input.opening,year:2026,qbiLossVintages:first.value.closingLossVintagesByRental},rules(2027));
    expect(next.status).toBe('available');if(next.status==='available'){expect(next.value.potentialDeductionCents).toBe(400000);expect(next.value.closingLossVintagesByRental.rent).toEqual({known:true,value:[]});}
  });
});
