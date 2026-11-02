import {expect,it} from 'vitest';
import {calculatePropertyDisposition,type PropertyDispositionInput,type PropertyDispositionResult} from '../../src/engine/retirement/property-disposition';
import type {Available} from '../../src/engine/model/results';
import {loadReferences,assertReference} from '../helpers/references';
import {calculateDepreciation} from '../../src/engine/property/depreciation';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {releaseDisposedPassiveLosses} from '../../src/engine/tax/rental-losses';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {makeRetirementPlan} from '../helpers/retirement';
import {makeAduPlan,zeroAduBook,aduValue} from '../helpers/adu';
const cases=loadReferences<PropertyDispositionInput,Available<PropertyDispositionResult>>('retirement-property-dispositions');
it.each(cases)('$id',c=>{const before=structuredClone(c.input);assertReference(calculatePropertyDisposition(c.input),c.expected,c.toleranceCents);expect(c.input).toEqual(before);});
it('isolates an unavailable California book and ignores mortgage settlement in gain character',()=>{
 const base=cases[0]!.input,missing={status:'needs-data' as const,issues:[]};
 const a=aduValue(calculatePropertyDisposition({...base,settlementPrincipalCents:20_000_000,books:{...base.books,california:missing}})),b=aduValue(calculatePropertyDisposition({...base,settlementPrincipalCents:30_000_000,books:{...base.books,california:missing}}));
 expect(a.taxFacts.books).toEqual(b.taxFacts.books);expect(a.taxFacts.books.federal).toMatchObject({status:'available',value:{gainCents:30_200_000}});expect(a.taxFacts.books.california).toEqual(missing);
});
it.each(['exchange','installment','partial','reduced-exclusion'] as const)('locates unsupported %s treatment',dispositionType=>{expect(calculatePropertyDisposition({...cases[0]!.input,dispositionType})).toMatchObject({status:'unsupported-case'});});
it('releases only the completely disposed activity’s passive pools, once',()=>{
 const source=makeRetirementPlan(),opening=initialTaxState(source),book={...zeroAduBook,atRiskSuspendedCents:500,passiveSuspendedCents:100000,lossVintages:[{year:2025,source:'at-risk' as const,amountCents:500},{year:2025,source:'passive' as const,amountCents:100000}]};
 const books=Object.fromEntries(['federal','california','federal-amt','california-amt'].map(b=>[b,{status:'available' as const,value:book}])) as unknown as typeof opening.rentals[string];
 const state={...opening,rentals:{sold:books,kept:books,unrelated:books}},base=cases.find(c=>c.id==='rental-sale-gain')!.input;
 const grouped=aduValue(calculatePropertyDisposition({...base,activityMembers:[{rentalId:'sold',propertyId:'sale-property'},{rentalId:'kept',propertyId:'kept-property'}]}));
 expect(releaseDisposedPassiveLosses(state,grouped.taxFacts).releasedCents.federal).toEqual({status:'available',value:0});
 const full=aduValue(calculatePropertyDisposition({...base,activityMembers:[{rentalId:'sold',propertyId:'sale-property'}]}));
 const released=releaseDisposedPassiveLosses(state,full.taxFacts);
 expect(released.releasedCents.federal).toEqual({status:'available',value:100000});
 expect(released.closing.rentals.kept).toEqual(books);expect(released.closing.rentals.unrelated).toEqual(books);
 expect(released.closing.rentals.sold!.federal).toMatchObject({status:'available',value:{atRiskSuspendedCents:500,passiveSuspendedCents:0,lossVintages:[{source:'at-risk',amountCents:500,year:2025}]}});
 expect(releaseDisposedPassiveLosses(released.closing,full.taxFacts).releasedCents.federal).toEqual({status:'available',value:0});
});
it('uses disposal-year mid-month depreciation before sale gain basis',()=>{
 const unit={...makeAduPlan().rentals[0]!,availableDate:'2020-01-01'},source=makeRetirementPlan(),r=resolveYearRules(loadRuleSet(),2026,source.taxPolicy);if(r.status!=='available')throw Error('rules');
 const result=aduValue(calculateDepreciation(unit,2026,'federal',{status:'available',value:{...zeroAduBook,recoveryBasisCents:33_000_000,adjustedBuildingBasisCents:30_000_000}},r.value,{disposalDate:'2026-01-01'}));
 expect(result.depreciationCents).toBe(50_000);expect(result.monthsRecovered).toBe(.5);
});
it('locates the excluded-home-gain and rental-loss-release boundary',()=>{
 const base=cases.find(c=>c.id==='rental-sale-gain')!.input,result=aduValue(calculatePropertyDisposition({...base,homeExclusionEligible:{known:true,value:true}}));
 expect(result.taxFacts.books.federal).toMatchObject({status:'available',value:{excluded121GainCents:25_200_000}});
 expect(result.taxFacts.releasesEntireActivity.status).toBe('unsupported-case');
});
it('keeps estimated ownership and book history visibly estimated',()=>{
 const base=cases[0]!.input,fed=base.books.federal;if(fed.status!=='available')throw Error('fixture');
 const result=aduValue(calculatePropertyDisposition({...base,ownershipUseOrigin:'estimate',books:{...base.books,federal:{status:'available',value:{...fed.value,basisOrigin:'estimate',depreciationOrigin:'estimate'}}}}));
 expect(result.provenance).toMatchObject({ownershipUseOrigin:'estimate',basisOriginByBook:{federal:'estimate'},depreciationOriginByBook:{federal:'estimate'}});
});
it('recaptures all depreciation on section1250 property held one year or less',()=>{
 const base=cases.find(c=>c.id==='rental-sale-gain')!.input,result=aduValue(calculatePropertyDisposition({...base,holdingPeriod:'short-term'}));
 expect(result.taxFacts.books.federal).toMatchObject({status:'available',value:{ordinaryRecaptureCents:5_000_000,shortTermGainCents:25_200_000,unrecaptured1250GainCents:0,longTerm1231GainCents:0}});
});
it('locates missing source activity members instead of inventing a zero release',()=>{
 const base=cases.find(c=>c.id==='rental-sale-gain')!.input,facts=aduValue(calculatePropertyDisposition(base)).taxFacts;
 const result=releaseDisposedPassiveLosses(initialTaxState(makeRetirementPlan()),facts);
 expect(result.releasedCents.federal).toMatchObject({status:'needs-data',issues:expect.arrayContaining([expect.objectContaining({recordId:'sold'})])});
});
