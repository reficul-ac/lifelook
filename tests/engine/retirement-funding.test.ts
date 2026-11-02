import {expect,it,vi} from 'vitest';
import {solveRetirementFunding,MAX_RETIREMENT_FUNDING_EVALUATIONS} from '../../src/engine/retirement/funding';
const av=<T>(value:T)=>({status:'available' as const,value});
it('grosses up tax on the tax-covering draw and verifies the one-cent boundary by immutable replay',()=>{
 const openingAssets={cash:0,stocks:1_000_000},events=[{id:'purchase',cashCents:-100_000}],seen:number[]=[];
 const evaluate=vi.fn((grossCents:number)=>{seen.push(grossCents);const tax=Math.ceil(grossCents/10);return {netFundingCents:av(grossCents-100_000-tax),verification:JSON.stringify({grossCents,tax,stocks:1_000_000-grossCents}),payload:{tax}};});
 const r=solveRetirementFunding({openingAssets,events,maximumGrossCents:1_000_000,evaluate});
 expect(r.status).toBe('verified');expect(r.grossCents).toEqual(av(111_112));expect(seen).toContain(111_111);expect(evaluate.mock.calls.filter(c=>c[0]===111_112).length).toBeGreaterThanOrEqual(2);expect(openingAssets).toEqual({cash:0,stocks:1_000_000});expect(events).toEqual([{id:'purchase',cashCents:-100_000}]);
});
it('retains signed incremental tax credits',()=>{
 const r=solveRetirementFunding({openingAssets:{},events:[],maximumGrossCents:1_000_000,evaluate:(grossCents:number)=>({netFundingCents:av(grossCents-100_000+5000),verification:String(grossCents),payload:null})});
 expect(r.status).toBe('verified');expect(r.grossCents).toEqual(av(95_000));
});
it('distinguishes stable genuine shortage from an evaluator that changes under replay',()=>{
 const base={openingAssets:{},events:[],maximumGrossCents:50_000};
 const short=solveRetirementFunding({...base,evaluate:(g:number)=>({netFundingCents:av(g-100_000),verification:String(g),payload:null})});
 expect(short.status).toBe('shortfall');expect(short.shortfallCents).toEqual(av(50_000));
 let revision=0;const unstable=solveRetirementFunding({...base,evaluate:(g:number)=>({netFundingCents:av(g-100_000),verification:String(++revision),payload:null})});expect(unstable.status).toBe('nonconvergent');expect(unstable.evaluations).toBeLessThanOrEqual(MAX_RETIREMENT_FUNDING_EVALUATIONS);
});
it('locates missing tax data independently of funding capacity',()=>{
 const r=solveRetirementFunding({openingAssets:{},events:[],maximumGrossCents:50_000,evaluate:()=>({netFundingCents:{status:'needs-data' as const,issues:[]},verification:'missing',payload:null})});expect(r.status).toBe('unavailable');expect(r.shortfallCents.status).toBe('needs-data');
});
