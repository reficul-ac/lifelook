import {vi} from 'vitest';
import {createScenarioManager} from '../../src/browser/scenario-manager';
import {createRetirementAnalysisScheduler,captureRetirementBindingOwnership,type RetirementAnalysisViewState} from '../../src/browser/retirement-analysis';
import {runRetirementAnalysisRequest,type RetirementWorkerRequest,type RetirementWorkerReply} from '../../src/browser/retirement-analysis-worker';
import {makeRetirementPlan} from './retirement';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from './scenarios';
import {loadRuleSet,type PlanDocument} from '../../src/engine';
export function createRetirementWorkerHarness(plan:PlanDocument=makeRetirementPlan({startYear:2098,horizonYears:3})){
 const requests:RetirementWorkerRequest[]=[],workers:ControlledWorker[]=[],publications:RetirementAnalysisViewState[]=[];
 class ControlledWorker {request!:RetirementWorkerRequest;terminated=false;onmessage:((e:MessageEvent<RetirementWorkerReply>)=>void)|null=null;onerror:((e:Event)=>void)|null=null;onmessageerror:((e:Event)=>void)|null=null;constructor(){workers.push(this);}postMessage(value:RetirementWorkerRequest){this.request=structuredClone(value);requests.push(this.request);}terminate(){this.terminated=true;}}
 vi.stubGlobal('Worker',ControlledWorker);const doc=makeScenarioWorkspace(plan,{scenarios:[{id:'master',name:'Master',plan},{id:'other',name:'Other',plan}]}),store=memoryWorkspaceStorage(),rules={...loadRuleSet()},manager=createScenarioManager(doc,store.port,rules,{persisted:true,persistenceIssues:[],suspension:'none',observedRaw:null}),session=manager.getActiveSession(),ownership=captureRetirementBindingOwnership(manager,session,1),controller=session.controller,scheduler=createRetirementAnalysisScheduler(controller,state=>publications.push(state),ownership);
 const replies=(request:RetirementWorkerRequest):RetirementWorkerReply[]=>{const values:RetirementWorkerReply[]=[];runRetirementAnalysisRequest(request,reply=>values.push(reply));return values;};
 const deliver=(reply:RetirementWorkerReply,request=requests.find(r=>r.owner.requestGeneration===reply.owner.requestGeneration&&r.owner.detailGeneration===reply.owner.detailGeneration&&r.kind===(reply.kind==='detail'?'detail':'comparison')))=>{workers.find(w=>w.request===request)?.onmessage?.({data:reply} as MessageEvent<RetirementWorkerReply>);};
 scheduler.request();return {manager,controller,rules,scheduler,requests,workers,publications,replies,deliver,completedReply(request:RetirementWorkerRequest){return replies(request).find(r=>r.kind==='complete')!;},run(request:RetirementWorkerRequest){for(const reply of replies(request))deliver(reply,request);},restoreSameIds(){return manager.restoreWorkspace(doc);},dispose(){scheduler.dispose();ownership.dispose();manager.dispose();}};
}
