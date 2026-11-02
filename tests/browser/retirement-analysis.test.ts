import {makeRetirementPlan} from '../helpers/retirement';
import {afterEach,expect,it,vi} from 'vitest';
import * as engine from '../../src/engine';
import {createRetirementWorkerHarness} from '../helpers/retirement-worker';
import {runRetirementAnalysisRequest,type RetirementWorkerReply} from '../../src/browser/retirement-analysis-worker';
import {applyRetirementEdit} from '../../src/browser/retirement-state';
const fixtures:ReturnType<typeof createRetirementWorkerHarness>[]=[];
function setup(plan?:engine.PlanDocument){const h=createRetirementWorkerHarness(plan);fixtures.push(h);return h;}
afterEach(()=>{fixtures.forEach(h=>h.dispose());fixtures.length=0;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('streams fully processed candidates in any order without presenting an incomplete comparison as calculated',()=>{
 const h=setup(),request=h.requests[0]!,replies=h.replies(request),candidates=replies.filter(r=>r.kind==='candidate');expect(candidates).toHaveLength(3);expect(replies.at(-1)?.kind).toBe('complete');h.deliver(candidates[2]!,request);h.deliver(candidates[0]!,request);expect(h.publications.at(-1)).toMatchObject({status:'pending',progress:{completed:2,total:3}});expect(h.publications.at(-1)?.comparison).toBeUndefined();h.deliver(candidates[1]!,request);h.deliver(replies.at(-1)!,request);expect(h.publications.at(-1)).toMatchObject({status:'calculated',progress:{completed:3,total:3}});expect(h.publications.at(-1)?.comparison?.candidates.map(c=>c.retirementYear)).toEqual([2098,2099,2100]);
});
it.each(['workspaceGeneration','scenarioId','sessionGeneration','activationGeneration','sourceBinding','candidateBinding','inputRevision','definitionFingerprint','definitionGeneration','ruleVersion','ruleBinding','requestGeneration','detailGeneration'] as const)('rejects a reply with mismatched %s',field=>{
 const h=setup(),request=h.requests[0]!,reply=h.completedReply(request),count=h.publications.length,old=reply.owner[field];h.deliver({...reply,owner:{...reply.owner,[field]:typeof old==='number'?999:'wrong'}},request);expect(h.publications).toHaveLength(count);
});
it.each(['source apply','switch','away back','restore','dispose','invalidate'])('rejects queued comparison results after %s',action=>{
 const h=setup(),request=h.requests[0]!,reply=h.completedReply(request);if(action==='source apply'){const draft=h.controller.getDraft('household','household');h.controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'1.00'}});h.controller.saveRecord('household');}if(action==='switch'||action==='away back')h.manager.switchScenario('other');if(action==='away back')h.manager.switchScenario('master');if(action==='restore')h.restoreSameIds();if(action==='dispose')h.scheduler.dispose();if(action==='invalidate')h.scheduler.invalidate();const count=h.publications.length;h.deliver(reply,request);expect(h.publications).toHaveLength(count);
});
it('builds a private Apply receipt only from the current complete comparison and matching ordinary projection',()=>{
 const h=setup();const draft=h.controller.getRetirementDraft();h.controller.editRetirementDraft({...draft,value:{...draft.value,withdrawalBps:'4.00'}});h.scheduler.request('draft');const request=h.requests.at(-1)!,reply=h.completedReply(request);if(reply.kind!=='complete')throw Error('complete');if(request.kind!=='comparison')throw Error('comparison');expect(request.needsProjection).toBe(true);h.deliver({...reply,projection:{...reply.projection!,inputRevision:999}},request);expect(h.publications.at(-1)?.receipt).toBeUndefined();h.deliver(reply,request);const receipt=h.publications.at(-1)?.receipt;expect(receipt).toBeDefined();expect(applyRetirementEdit(h.controller,receipt!).accepted).toBe(true);expect(h.controller.getState().savedPlan.retirementAnalysis?.withdrawalBps).toBe(400);
});
it('cancels edited inputs, retains a labeled owned previous result and rejects late fatal errors',()=>{
 const h=setup(),old=h.requests[0]!;h.run(old);const calculated=h.publications.at(-1)!;expect(calculated.status).toBe('calculated');h.scheduler.request('draft');const draft=h.controller.getRetirementDraft();h.controller.editRetirementDraft({...draft,value:{...draft.value,withdrawalBps:'4.00'}});expect(h.publications.at(-1)?.status).toBe('pending');expect(h.publications.at(-1)?.retained?.comparison).toBe(calculated.comparison);expect(h.publications.at(-1)?.comparison).toBeUndefined();const count=h.publications.length;h.workers[0]!.onerror?.(new Event('error'));expect(h.publications).toHaveLength(count);expect(h.workers[0]!.terminated).toBe(true);
});
it('debounces only detail requests and preserves the running comparison during rapid year changes',()=>{
 vi.useFakeTimers();const h=setup(),comparison=h.workers[0]!;h.scheduler.selectYear(2098);h.scheduler.selectYear(2099);h.scheduler.selectYear(2100);vi.advanceTimersByTime(149);expect(h.requests).toHaveLength(1);vi.advanceTimersByTime(1);expect(h.requests).toHaveLength(2);expect(h.requests[1]).toMatchObject({kind:'detail',retirementYear:2100});expect(comparison.terminated).toBe(false);h.run(h.requests[0]!);expect(h.publications.at(-1)?.status).toBe('calculated');
});
it('rejects old detail callbacks and bounds detail reuse to two current-source candidate paths',()=>{
 vi.useFakeTimers();const h=setup();h.run(h.requests[0]!);h.scheduler.selectYear(2098);vi.advanceTimersByTime(150);const old=h.requests.at(-1)!;h.scheduler.selectYear(2099);vi.advanceTimersByTime(150);const current=h.requests.at(-1)!;h.run(old);expect(h.publications.at(-1)?.detail).toBeUndefined();h.run(current);expect(h.publications.at(-1)?.detail?.path.retirementYear).toBe(2099);const count=h.requests.length;h.scheduler.selectYear(2099);vi.advanceTimersByTime(150);expect(h.requests).toHaveLength(count);h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);h.run(h.requests.at(-1)!);h.scheduler.selectYear(2098);vi.advanceTimersByTime(150);h.run(h.requests.at(-1)!);const before=h.requests.length;h.scheduler.selectYear(2099);vi.advanceTimersByTime(150);expect(h.requests).toHaveLength(before+1);
});
it('does not reuse summary or detail cache after source/rule invalidation',()=>{
 vi.useFakeTimers();const h=setup();h.run(h.requests[0]!);h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);h.run(h.requests.at(-1)!);const count=h.requests.length;h.scheduler.request();expect(h.requests).toHaveLength(count);h.rules.version='new-rules';h.scheduler.request();expect(h.requests.length).toBeGreaterThan(count);expect(h.requests.at(-1)!.owner.ruleVersion).toBe('new-rules');h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);expect(h.requests.at(-1)!.kind).toBe('detail');
});
it('distinguishes worker failure from financially unavailable candidate values and retries',()=>{
 const h=setup();h.workers[0]!.onerror?.(new Event('error'));expect(h.publications.at(-1)?.status).toBe('failed');h.scheduler.request();const request=h.requests.at(-1)!;h.run(request);expect(h.publications.at(-1)?.status).toBe('calculated');
});
it('reports unavailable worker support without running a financial forecast on the UI thread',()=>{
 const h=setup();h.scheduler.invalidate();vi.stubGlobal('Worker',undefined);const calculate=vi.spyOn(engine,'prepareRetirementAnalysis');h.scheduler.request();expect(h.publications.at(-1)).toMatchObject({status:'failed',issues:[{code:'retirement-calculation-unavailable'}]});expect(calculate).not.toHaveBeenCalled();
});
it('pure runner constructs one context and emits JSON-safe summaries before the final calculation',()=>{
 const h=setup(),request=h.requests[0]!,prepare=vi.spyOn(engine,'prepareRetirementAnalysis'),replies:RetirementWorkerReply[]=[];runRetirementAnalysisRequest(request,r=>replies.push(r));expect(prepare).toHaveBeenCalledTimes(1);expect(replies[0]?.kind).toBe('progress');expect(replies.at(-1)?.kind).toBe('complete');expect(JSON.parse(JSON.stringify(replies))).toEqual(replies);for(const reply of replies)if(reply.kind==='candidate')expect(reply.candidate.firstYear.months).toEqual([]);
});

it('completes comparisons containing financially unavailable candidates without calling them worker failures',()=>{
 const base=makeRetirementPlan({startYear:2100,horizonYears:1}),source=makeRetirementPlan({...base,household:{...base.household,filers:base.household.filers.map(f=>f.id==='owner-a'?{...f,birthDate:{known:false as const}}:f) as unknown as typeof base.household.filers}}),h=setup(source);h.run(h.requests[0]!);expect(h.publications.at(-1)?.status).toBe('calculated');expect(h.publications.at(-1)?.comparison?.candidates[0]).toMatchObject({completion:'unavailable',ranked:false});
});
it('retains a labeled previous report when current raw values become invalid',()=>{
 const h=setup();h.run(h.requests[0]!);const applied=h.publications.at(-1)!.comparison,draft=h.controller.getRetirementDraft();h.controller.editRetirementDraft({...draft,value:{...draft.value,withdrawalBps:'4'}});h.scheduler.request('draft');const old=h.requests.at(-1)!,reply=h.completedReply(old);h.controller.editRetirementDraft({...h.controller.getRetirementDraft(),value:{...draft.value,withdrawalBps:'unfinished'}});expect(h.publications.at(-1)).toMatchObject({status:'invalid',retained:{comparison:applied}});expect(h.publications.at(-1)?.comparison).toBeUndefined();expect(h.publications.at(-1)?.receipt).toBeUndefined();const count=h.publications.length;h.deliver(reply,old);expect(h.publications).toHaveLength(count);
});
it('rejects completion if captured rules mutate before a replacement request',()=>{
 const h=setup(),old=h.requests[0]!,reply=h.completedReply(old);h.rules.version='changed';const count=h.publications.length;h.deliver(reply,old);expect(h.publications).toHaveLength(count);
});
it('returns an explicit empty-calendar explanation when the source starts after 2100',()=>{
 const h=setup(makeRetirementPlan({startYear:2101,horizonYears:1}));h.run(h.requests[0]!);expect(h.publications.at(-1)).toMatchObject({status:'calculated',comparison:{candidates:[]},issues:[{code:'no-retirement-candidates'}]});
});
it('clears detail reuse after an ordinary source Apply',()=>{
 vi.useFakeTimers();const h=setup();h.run(h.requests[0]!);h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);h.run(h.requests.at(-1)!);const draft=h.controller.getDraft('household','household');h.controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'2'}});h.controller.saveRecord('household');expect(h.publications.at(-1)?.detail).toBeUndefined();h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);expect(h.requests.at(-1)).toMatchObject({kind:'detail',owner:{inputRevision:1}});
});
it.each(['restore','dispose','away back'])('rejects queued detail work after %s',action=>{
 vi.useFakeTimers();const h=setup();h.run(h.requests[0]!);h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);const old=h.requests.at(-1)!,reply=h.replies(old).find(r=>r.kind==='detail')!;if(action==='restore')h.restoreSameIds();if(action==='dispose')h.scheduler.dispose();if(action==='away back'){h.manager.switchScenario('other');h.manager.switchScenario('master');}const count=h.publications.length;h.deliver(reply,old);expect(h.publications).toHaveLength(count);
});
it('uses the applied scope for unchanged raw drafts and handles worker construction failure',()=>{
 const h=setup();h.run(h.requests[0]!);const draft=h.controller.getRetirementDraft();h.controller.editRetirementDraft({...draft,value:{...draft.value,withdrawalBps:'3.0'}});h.scheduler.request('draft');expect(h.publications.at(-1)).toMatchObject({status:'calculated',scope:'applied'});expect(h.publications.at(-1)?.receipt).toBeUndefined();h.scheduler.invalidate();vi.stubGlobal('Worker',class{constructor(){throw Error('worker unavailable');}});h.scheduler.request();expect(h.publications.at(-1)?.status).toBe('failed');
});
it('streams a fully solved selected candidate from detail while the overall comparison remains pending',()=>{
 vi.useFakeTimers();const h=setup();h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);const request=h.requests.at(-1)!;h.run(request);expect(h.publications.at(-1)?.status).toBe('pending');expect(h.publications.at(-1)?.candidates.map(c=>c.retirementYear)).toContain(2100);expect(h.publications.at(-1)?.detail?.path.retirementYear).toBe(2100);expect(h.publications.at(-1)?.comparison).toBeUndefined();expect(h.publications.at(-1)?.receipt).toBeUndefined();
});
it('refreshes the selected detail alongside a replacement comparison after input changes',()=>{
 vi.useFakeTimers();const h=setup();h.scheduler.selectYear(2100);vi.advanceTimersByTime(150);h.scheduler.request('draft');const before=h.requests.filter(r=>r.kind==='detail').length;const draft=h.controller.getRetirementDraft();h.controller.editRetirementDraft({...draft,value:{...draft.value,withdrawalBps:'4'}});vi.advanceTimersByTime(150);expect(h.requests.filter(r=>r.kind==='detail')).toHaveLength(before+1);expect(h.requests.at(-1)?.owner.definitionGeneration).toBe(h.controller.getRetirementDraft().generation);
});
