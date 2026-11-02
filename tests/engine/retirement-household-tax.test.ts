import {expect,it,vi} from 'vitest';
import {buildRetirementTaxFacts,type RetirementTaxYearInput} from '../../src/engine/retirement/tax-facts';
import {attributeRetirementTax} from '../../src/engine/retirement/tax-attribution';
import * as comparison from '../../src/engine/tax/comparison';
import {calculateCapitalGainWorksheet,calculateAmtCapitalGainWorksheet} from '../../src/engine/tax/federal';
import {resolveCashYear} from '../../src/engine/cash/income';
import {buildPropertyFacts} from '../../src/engine/property/facts';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {makeRetirementPlan} from '../helpers/retirement';
import {aduValue} from '../helpers/adu';
import {resolveRetirementDistributions} from '../../src/engine/retirement/distributions';
import {loadReferences,assertReference} from '../helpers/references';
import type {PlanDocument} from '../../src/engine/model/plan';
function setup(overrides:Partial<PlanDocument>={}):RetirementTaxYearInput {
 const plan=makeRetirementPlan(overrides),opening=initialTaxState(plan),cash=resolveCashYear(plan,2026),rules=aduValue(resolveYearRules(loadRuleSet(),2026,plan.taxPolicy)),property=buildPropertyFacts(plan,cash,[],opening,rules);
 const distributions=resolveRetirementDistributions({year:2026,rules,openingAccounts:[{accountId:'ira',ownerId:'owner-a',type:'traditional-ira',balanceExact:'10000000',basis:{known:true,value:0}}],proposedLegs:[{eventId:'recurring',accountId:'ira',date:'2026-01-01',grossCents:8_000_000,purpose:'recurring'}],openingTaxState:opening,iraBasisByOwner:{'owner-a':{federal:{known:true,value:0},california:{known:true,value:0}}},yearEndIraValuesByOwner:{'owner-a':{status:'available',value:2_000_000}},ownerBirthDates:{'owner-a':{known:true,value:'1960-01-01'}}});
 return {plan,cash,property,loans:[],opening,rules,distributions,scope:'transition',noFederalSaltBenefitForCaliforniaAdditionalTax:true};
}
it('adds IRA income to four books and affected MAGIs once without adding wages or NIIT',()=>{
 const input=setup(),r=buildRetirementTaxFacts(input);
 for(const key of ['federalAgiCents','californiaAgiCents','federalAmtIncomeCents','californiaAmtIncomeCents','saltMagiCents','niitMagiCents','traditionalIraMagiCents','rothIraMagiCents','passiveAllowanceMagiCents'] as const)expect(r.facts[key]).toEqual({status:'available',value:8_000_000});
 expect(r.facts.preIra.grossWagesCents).toBe(0);expect(r.facts.niitOtherIncomeCents).toEqual({status:'available',value:0});expect(r.payroll.annual.totalCents).toBe(0);
 const evaluated=comparison.evaluateFixedHouseholdTaxYear(r);expect(evaluated.candidates).toHaveLength(4);expect(aduValue(evaluated.tax).federal.totalCents).toBe(524_300);
 expect(input.opening).toEqual(initialTaxState(input.plan));
});
it('attributes signed increments using the accepted schedule and commits only complete-C state',()=>{
 const input=setup(),resolveOnce=vi.fn(()=>input.distributions),schedule=resolveOnce(),views=['recurring','mandatory-excess','transition'].map(scope=>buildRetirementTaxFacts({...input,distributions:schedule,scope:scope as RetirementTaxYearInput['scope']}));
 const real=comparison.evaluateFixedHouseholdTaxYear(views[0]!),states=[{...real.closingTaxState,year:1},{...real.closingTaxState,year:2},{...real.closingTaxState,year:3}],spy=vi.spyOn(comparison,'evaluateFixedHouseholdTaxYear');
 [1000,900,1500].forEach((total,i)=>spy.mockReturnValueOnce({...real,tax:{status:'available',value:{...aduValue(real.tax),combinedIncomeTaxCents:total}},closingTaxState:states[i]!}));
 const result=attributeRetirementTax({schedule,recurring:views[0]!,mandatoryExcess:views[1]!,complete:views[2]!});
 expect(result).toMatchObject({recurringCents:{status:'available',value:1000},mandatoryExcessCents:{status:'available',value:-100},transitionCents:{status:'available',value:600},totalCents:{status:'available',value:1500},closingTaxState:states[2]});
 expect(resolveOnce).toHaveBeenCalledTimes(1);expect(spy).toHaveBeenCalledTimes(3);spy.mockRestore();
});
it('keeps California additional tax separate from prospective state-paid deductions and honors actual overrides',()=>{
 const input=setup(),resolved=buildRetirementTaxFacts(input),base=comparison.evaluateFixedHouseholdTaxYear(resolved),normal=aduValue(base.tax),additional=50_000;
 const result=comparison.evaluateFixedHouseholdTaxYear({...resolved,additionalCaliforniaTaxCents:{status:'available',value:additional}}),tax=aduValue(result.tax);
 expect(tax.california.totalCents).toBe(normal.california.totalCents);expect(tax.californiaAdditionalTaxCents).toBe(additional);expect(tax.statePaid.californiaIncomeTaxPaidCents).toBe(normal.california.totalCents);expect(tax.combinedIncomeTaxCents).toBe(normal.combinedIncomeTaxCents+additional);
 expect(resolved.assumptions).toContain('No federal SALT benefit modeled for California early-distribution additional tax');
 const override={...input.plan,taxPolicy:{...input.plan.taxPolicy,actualStateTaxPaidByYear:[{year:2026,californiaIncomeTaxPaidCents:123_400,sdiPaidCents:0}]}};
 expect(aduValue(comparison.evaluateFixedHouseholdTaxYear({...resolved,plan:override}).tax).statePaid).toMatchObject({source:'actual-override',californiaIncomeTaxPaidCents:123_400});
});
it('retains unrelated household coverage and prior minimum-tax-credit limits',()=>{
 const base=makeRetirementPlan();
 const unsupported=setup({household:{...base.household,coverageAnswers:{...base.household.coverageAnswers,additionalIncome:{known:true,value:true}}}});
 expect(comparison.evaluateFixedHouseholdTaxYear(buildRetirementTaxFacts(unsupported)).tax.status).toBe('unsupported-case');
 const input=setup(),opening={...input.opening,minimumTaxCreditCoverage:{...input.opening.minimumTaxCreditCoverage,federal:{known:false as const}}};
 expect(comparison.evaluateFixedHouseholdTaxYear(buildRetirementTaxFacts({...input,opening})).tax.status).toBe('needs-data');
});
it('isolates an unavailable California distribution book',()=>{
 const input=setup(),distributions={...input.distributions,taxFacts:input.distributions.taxFacts.map(f=>({...f,californiaTaxableCents:{status:'needs-data' as const,issues:[]}}))},facts=buildRetirementTaxFacts({...input,distributions}).facts;
 expect(facts.federalAgiCents).toEqual({status:'available',value:8_000_000});expect(facts.californiaAgiCents.status).toBe('needs-data');expect(facts.federalAmtIncomeCents.status).toBe('available');
});
const cases=loadReferences<{taxableCents:number;preferredGainCents:number;unrecaptured1250Cents:number;amtBaseCents:number;amtPreferredGainCents:number;amtUnrecaptured1250Cents:number},{regularTaxCents:number;amtTaxCents:number}>('retirement-household-tax');
it.each(cases)('$id',c=>{
 const {rules}=setup(),v=c.input,regular=calculateCapitalGainWorksheet(v.taxableCents,v.preferredGainCents,v.unrecaptured1250Cents,rules);
 const amt=calculateAmtCapitalGainWorksheet(v.amtBaseCents,v.amtPreferredGainCents,v.amtUnrecaptured1250Cents,regular,rules);
 assertReference({regularTaxCents:regular.taxCents,amtTaxCents:amt},c.expected,c.toleranceCents);
});
import {calculatePropertyDisposition,type PropertyDispositionInput} from '../../src/engine/retirement/property-disposition';
import {zeroAduBook} from '../helpers/adu';
const taxBooks=['federal','california','federal-amt','california-amt'] as const;
function sale(propertyId:string,gain:number,lookback=0){
 const b={adjustedBasisCents:10_000_000,depreciationCents:gain>0?5_000_000:0,additionalDepreciationCents:0,disposalDepreciationCents:0};
 return aduValue(calculatePropertyDisposition({eventId:`sale:${propertyId}`,propertyId,activityId:propertyId,date:'2026-01-01',use:'rental',dispositionType:'whole',holdingPeriod:'long-term',grossPriceCents:10_000_000+gain,sellingCostsCents:0,settlementPrincipalCents:0,homeExclusionEligible:{known:true,value:false},unrelatedBuyer:{known:true,value:true},lookback1231LossCents:{known:true,value:lookback},activityMembers:[{propertyId,rentalId:propertyId}],disposedPropertyIds:[propertyId],books:Object.fromEntries(taxBooks.map(book=>[book,{status:'available',value:b}])) as PropertyDispositionInput['books']})).taxFacts;
}
function withoutDraws(input:RetirementTaxYearInput):RetirementTaxYearInput{return {...input,distributions:{...input.distributions,taxFacts:[],acceptedSchedule:{year:2026,legs:[]},closingTaxState:input.opening}};}
it('nets section1231 once per household book before consuming lookback and capping1250',()=>{
 const input=withoutDraws(setup()),state={...zeroAduBook,atRiskCents:10_000_000},book=Object.fromEntries(taxBooks.map(b=>[b,{status:'available' as const,value:state}])) as unknown as typeof input.opening.rentals[string],opening={...input.opening,rentals:{gain:book,loss:book}};
 const r=buildRetirementTaxFacts({...input,opening,dispositions:[sale('gain',10_000_000,1_500_000),sale('loss',-6_000_000,1_500_000)]});
 expect(r.facts).toMatchObject({federalAgiCents:{status:'available',value:4_000_000},longTermCapitalGainCents:0,unrecaptured1250GainCents:2_500_000});
 expect(r.facts.niitOtherIncomeCents).toEqual({status:'available',value:4_000_000});
});
it('allocates limited at-risk capacity pro rata between operating carry and current1231 loss, then releases eligible PAL once',()=>{
 const input=withoutDraws(setup()),state={...zeroAduBook,atRiskCents:9_000_000,atRiskSuspendedCents:4_000_000,passiveSuspendedCents:1_000_000,lossVintages:[{year:2025,source:'at-risk' as const,amountCents:4_000_000,qbiQualification:{known:true as const,value:false}},{year:2025,source:'passive' as const,amountCents:1_000_000,qbiQualification:{known:true as const,value:false}}]},book=Object.fromEntries(taxBooks.map(b=>[b,{status:'available' as const,value:state}])) as unknown as typeof input.opening.rentals[string],opening={...input.opening,rentals:{loss:book},qbiLossVintages:{loss:{known:true as const,value:[]}}};
 const r=buildRetirementTaxFacts({...input,opening,dispositions:[sale('loss',-6_000_000)]});
 expect(r.facts.federalAgiCents).toEqual({status:'available',value:-6_000_000});
 expect(r.facts.federalRentalCents).toEqual({status:'available',value:-3_000_000});
 expect(r.facts.rental.closing.rentals.loss!.federal).toMatchObject({status:'available',value:{atRiskCents:0,atRiskSuspendedCents:5_000_000,passiveSuspendedCents:0}});
});
it('pins the explicit state-paid estimate independently of ordinary liability amount',()=>{
 expect(comparison.prospectiveCaliforniaStatePaid(1_000_000,{status:'available',value:50_000},true)).toBe(1_000_000);
 expect(comparison.prospectiveCaliforniaStatePaid(1_000_000,{status:'available',value:50_000},false)).toBe(1_050_000);
});
it('matches a sourced complete household A/B/C worksheet with one accepted distribution schedule',()=>{
 const reference=loadReferences<{recurringIraCents:number;mandatoryExcessIraCents:number;transitionGainCents:number},{recurringCents:number;mandatoryExcessCents:number;transitionCents:number;totalCents:number}>('retirement-household-attribution')[0]!,v=reference.input;
 const input=setup(),distribution=resolveRetirementDistributions({year:2026,rules:input.rules,openingAccounts:[{accountId:'ira',ownerId:'owner-a',type:'traditional-ira',balanceExact:'10000000',basis:{known:true,value:0}},{accountId:'broker',ownerId:'owner-a',type:'taxable-brokerage',balanceExact:'10000000',basis:{known:true,value:0}}],proposedLegs:[{eventId:'a',accountId:'ira',date:'2026-01-01',grossCents:8_000_000,purpose:'recurring'},{eventId:'b',accountId:'ira',date:'2026-12-01',grossCents:2_000_000,purpose:'mandatory-excess'},{eventId:'c',accountId:'broker',date:'2026-01-01',grossCents:10_000_000,purpose:'transition'}],openingTaxState:input.opening,iraBasisByOwner:{'owner-a':{federal:{known:true,value:0},california:{known:true,value:0}}},yearEndIraValuesByOwner:{'owner-a':{status:'available',value:0}},ownerBirthDates:{'owner-a':{known:true,value:'1960-01-01'}}});
 const view=(scope:RetirementTaxYearInput['scope'])=>buildRetirementTaxFacts({...input,distributions:distribution,scope}),r=attributeRetirementTax({schedule:distribution,recurring:view('recurring'),mandatoryExcess:view('mandatory-excess'),complete:view('transition')});
 // 2026 MFJ: A federal5243/CA1097; B federal7643/CA1946; C federal17978/CA9822.
 expect(distribution.taxFacts.map(f=>aduValue(f.grossCents)).sort((a,b)=>a-b)).toEqual([v.recurringIraCents,v.mandatoryExcessIraCents,v.transitionGainCents].sort((a,b)=>a-b));
 assertReference({recurringCents:aduValue(r.recurringCents),mandatoryExcessCents:aduValue(r.mandatoryExcessCents),transitionCents:aduValue(r.transitionCents),totalCents:aduValue(r.totalCents)},reference.expected,reference.toleranceCents);
 expect(r.closingTaxState.retirementAccountState).toEqual(distribution.closingTaxState.retirementAccountState);
});
it('uses independent regular and AMT sale gain books without losing a known federal result to a missing California book',()=>{
 const input=withoutDraws(setup()),s=sale('personal',10_000_000),fed=s.books.federal;if(fed.status!=='available')throw Error('book');
 const r=buildRetirementTaxFacts({...input,dispositions:[{...s,use:'personal',activityMembers:[],releasesEntireActivity:{status:'available',value:false},books:{...s.books,california:{status:'needs-data',issues:[]},'federal-amt':{status:'available',value:{...fed.value,gainCents:15_000_000,longTerm1231GainCents:10_000_000}}}}]});
 expect(r.facts.federalAgiCents).toEqual({status:'available',value:10_000_000});expect(r.facts.federalAmtIncomeCents).toEqual({status:'available',value:15_000_000});expect(r.facts.federalAmtLongTermCapitalGainCents).toBe(10_000_000);expect(r.facts.californiaAgiCents.status).toBe('needs-data');
 const result=comparison.evaluateFixedHouseholdTaxYear(r);expect(result.candidates.filter(c=>c.federalMethod==='standard').every(c=>c.federal.status==='available')).toBe(true);expect(result.tax.status).toBe('needs-data');
});
it('suppresses only satisfied current derived RMD omissions, retaining explicit source circumstances',()=>{
 const base=makeRetirementPlan(),plan=makeRetirementPlan({household:{...base.household,filers:base.household.filers.map(f=>f.id==='owner-a'?{...f,birthDate:{known:true as const,value:'1950-01-01'}}:f) as unknown as typeof base.household.filers},accounts:[{id:'ira',name:'IRA',ownerId:'owner-a',type:'traditional-ira',openingBalanceCents:10_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}]}),r=buildRetirementTaxFacts(setup(plan));
 const a=comparison.evaluateFixedHouseholdTaxYear(r),b=comparison.evaluateFixedHouseholdTaxYear({...r,generatedRetirementCoverage:{rmdSatisfiedOwnerIds:['owner-a']}});
 expect(a.coverage.issues.some(i=>i.code==='omitted-distributions')).toBe(true);expect(b.coverage.issues.some(i=>i.code==='omitted-distributions')).toBe(false);
 const reported={...r.plan,household:{...r.plan.household,coverageAnswers:{...r.plan.household.coverageAnswers,retirementDistributions:{known:true as const,value:true}}}};
 expect(comparison.evaluateFixedHouseholdTaxYear({...r,plan:reported,generatedRetirementCoverage:{rmdSatisfiedOwnerIds:['owner-a']}}).coverage.issues.some(i=>i.field==='household.coverageAnswers.retirementDistributions')).toBe(true);
});
it('labels the conservative whole-property1250 ceiling when building consideration has not been allocated',()=>{
 const ref=loadReferences<PropertyDispositionInput,unknown>('retirement-property-dispositions').find(c=>c.id==='rental-sale-gain')!,r=aduValue(calculatePropertyDisposition(ref.input));
 expect(r.provenance.assumptions).toContain('No separate building-gain allocation entered; total gain is a conservative unrecaptured1250 ceiling.');
});
it('includes special-gain and additional-distribution tax sources in the selected household provenance',()=>{
 const input=setup(),resolved=buildRetirementTaxFacts({...input,distributions:{...input.distributions,taxFacts:input.distributions.taxFacts.map(f=>({...f,additionalFederalTaxCents:{status:'available',value:100_000},additionalCaliforniaTaxCents:{status:'available',value:25_000}}))}}),tax=aduValue(comparison.evaluateFixedHouseholdTaxYear(resolved).tax);
 expect(tax.provenance.sources).toContain('https://www.irs.gov/pub/irs-prior/p590b--2025.pdf');expect(tax.provenance.sources).toContain('https://www.ftb.ca.gov/forms/2025/2025-3805p-instructions.html');
});
import {makeAduPlan} from '../helpers/adu';
import {resolveRentalQbi} from '../../src/engine/tax/federal';
it.each([[-6_000_000,0,-6_000_000],[10_000_000,1_500_000,1_500_000]])('preserves ordinary business disposition character in QBI for gain %i', (gain,lookback,expected)=>{
 const input=withoutDraws(setup()),template=makeAduPlan().rentals[0]!,unit={...template,id:'sold',propertyId:'sold',qbi:{...template.qbi,qualification:{known:true as const,value:true}}},book=Object.fromEntries(taxBooks.map(b=>[b,{status:'available' as const,value:{...zeroAduBook,atRiskCents:10_000_000}}])) as unknown as typeof input.opening.rentals[string],opening={...input.opening,rentals:{sold:book},qbiLossVintages:{sold:{known:true as const,value:[]}}},r=buildRetirementTaxFacts({...input,opening,dispositions:[sale('sold',gain,lookback)],disposedRentalUnits:[unit]});
 const qbi=aduValue(resolveRentalQbi(r.facts,r.opening,r.rules));expect(qbi.provenance.sources).toContain('https://www.irs.gov/irb/2019-09_IRB');expect(qbi.units[0]!.qualifiedIncomeCents).toBe(expected);
 if(expected<0)expect(qbi.closingLossVintagesByRental.sold).toEqual({known:true,value:[{year:2026,amountCents:-expected}]});
});
it('rejects counterfactual views resolved from a different distribution schedule',()=>{
 const input=setup(),a=buildRetirementTaxFacts({...input,scope:'recurring'}),b=buildRetirementTaxFacts({...input,scope:'mandatory-excess'}),c=buildRetirementTaxFacts({...input,scope:'transition',distributions:structuredClone(input.distributions)});
 expect(()=>attributeRetirementTax({schedule:input.distributions,recurring:a,mandatoryExcess:b,complete:c})).toThrow(/accepted distribution schedule/);
});
