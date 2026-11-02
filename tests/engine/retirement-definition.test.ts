import {expect,it} from 'vitest';
import {createDefaultRetirementAnalysis} from '../../src/engine/retirement/definition';
import {validateRetirementAnalysis} from '../../src/engine/retirement/validation';
import {resolveRetirementAssumptions} from '../../src/engine/retirement/assumptions';
import {validatePlan} from '../../src/engine/validation';
import {makeRetirementDefinition,makeRetirementPlan,makeRetirementTarget} from '../helpers/retirement';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
it('keeps omission and independent fixed-price rentals',()=>{
 const old=makeRetirementPlan();
 expect(old).not.toHaveProperty('retirementAnalysis');
 expect(createDefaultRetirementAnalysis(old)).toMatchObject({mode:'projected',withdrawalBps:300});
 const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'rental-a',financing:{kind:'mortgage',downPaymentBps:2000,aprBps:600,termMonths:360}}),makeRetirementTarget({id:'rental-b',purchasePriceCents:40_000_000})]},old);
 expect(validatePlan({...old,retirementAnalysis:definition}).ok).toBe(true);
 expect(definition.newProperties.map(p=>p.purchasePriceCents)).toEqual([60_000_000,40_000_000]);
 expect(definition.newProperties[0]!.financing).toMatchObject({downPaymentBps:2000});
 expect(JSON.parse(JSON.stringify(old))).not.toHaveProperty('retirementAnalysis');
});
it.each([-1,10001,2000.5,NaN,Infinity])('rejects malformed down-payment bps %s',downPaymentBps=>{
 const source=makeRetirementPlan();
 const raw={...createDefaultRetirementAnalysis(source),newProperties:[makeRetirementTarget({financing:{kind:'mortgage',downPaymentBps,aprBps:0,termMonths:360}})]};
 expect(validateRetirementAnalysis(raw,source).ok).toBe(false);
 expect(validatePlan({...source,retirementAnalysis:raw}).ok).toBe(false);
});
it.each([0,10000])('accepts %s bps down with explicit zero APR',downPaymentBps=>{
 expect(makeRetirementDefinition({withdrawalBps:0,newProperties:[makeRetirementTarget({financing:{kind:'mortgage',downPaymentBps,aprBps:0,termMonths:1}})]}).withdrawalBps).toBe(0);
});
it('rejects duplicate targets and source IDs',()=>{
 const source=makeRetirementPlan(),base=createDefaultRetirementAnalysis(source);
 for(const targets of [[makeRetirementTarget({id:'same'}),makeRetirementTarget({id:'same'})],[makeRetirementTarget({id:'stocks'})],[makeRetirementTarget({id:'owner-a'})]]) expect(validateRetirementAnalysis({...base,newProperties:targets},source).ok).toBe(false);
});
it('locates dangling property, loan, account, owner and commitment references',()=>{
 const source=makeRetirementPlan(makeFuturePurchasePlan()),base=createDefaultRetirementAnalysis(source);
 const invalid=[{existingProperties:[{propertyId:'gone',action:'keep',payoffLoanIds:[]}]},{existingProperties:[{propertyId:'future-home',action:'keep',payoffLoanIds:['gone']}]},{assumptions:{...base.assumptions,accounts:[{accountId:'gone',taxableBasisCents:{known:true,value:0}}]}},{assumptions:{...base.assumptions,owners:[{ownerId:'gone',birthDate:{known:true,value:'1960-01-01'}}]}},{commitments:[{recordId:'gone',action:'continue'}]}];
 for(const change of invalid){const result=validateRetirementAnalysis({...base,...change},source);expect(result).toMatchObject({ok:false,issues:expect.arrayContaining([expect.objectContaining({code:'dangling-reference'})])});}
});
it('requires growth for reallocation without inventing an APR or birth date',()=>{
 const source=makeRetirementPlan(),base=createDefaultRetirementAnalysis(source);
 expect(base).not.toHaveProperty('stockGrowthBps');
 expect(base.assumptions.owners).toEqual([]);
 expect(validateRetirementAnalysis({...base,mode:'reallocate'},source).ok).toBe(false);
 expect(createDefaultRetirementAnalysis({...source,growthAssumptions:{stocksBps:500}}).stockGrowthBps).toBe(500);
});
it('preserves unknown versus zero and gives known source history priority',()=>{
 const source=makeRetirementPlan();
 const definition=makeRetirementDefinition({assumptions:{...createDefaultRetirementAnalysis(source).assumptions,accounts:[{accountId:'stocks',taxableBasisCents:{known:true,value:0}}]}},source);
 const resolved=resolveRetirementAssumptions(source,definition);
 expect(resolved.facts).toContainEqual(expect.objectContaining({recordId:'stocks',field:'taxableBasisCents',value:100_000_000,origin:'entered-history'}));
 const unknown={...createDefaultRetirementAnalysis(source),assumptions:{...definition.assumptions,accounts:[{accountId:'stocks',taxableBasisCents:{known:false}}]}};
 expect(validateRetirementAnalysis(unknown,source).ok).toBe(true);
 expect(unknown.assumptions.accounts[0]!.taxableBasisCents).toEqual({known:false});
 for(const history of [{known:true},{known:true,value:-1},{known:false,value:0}])expect(validateRetirementAnalysis({...unknown,assumptions:{...unknown.assumptions,accounts:[{accountId:'stocks',taxableBasisCents:history}]}},source).ok).toBe(false);
});
it('rejects arbitrary unvalidated assumption fields and duplicate source choices',()=>{
 const source=makeRetirementPlan(makeFuturePurchasePlan()),base=createDefaultRetirementAnalysis(source);
 expect(validateRetirementAnalysis({...base,assumptions:{...base.assumptions,secretTaxRate:0}},source).ok).toBe(false);
 const choice={propertyId:'future-home',action:'keep',payoffLoanIds:[]};
 expect(validateRetirementAnalysis({...base,existingProperties:[choice,choice]},source).ok).toBe(false);
});
