import {calculateAduBuildComparison,type AduBuildComparison,type Available,type RuleSet,type ValidatedPlan} from '../engine';
import type {AduComparisonRequestOwner} from './adu-comparison';
export interface AduComparisonWorkerRequest {readonly owner:AduComparisonRequestOwner;readonly plan:ValidatedPlan;readonly ruleSet:RuleSet}
export interface AduComparisonWorkerReply {readonly owner:AduComparisonRequestOwner;readonly result:Available<AduBuildComparison>}
export function calculateAduComparisonWorker(request:AduComparisonWorkerRequest):AduComparisonWorkerReply {
 let result:Available<AduBuildComparison>;
 try{result=calculateAduBuildComparison(request.plan,request.ruleSet,request.owner.projectId);}
 catch{result={status:'unsupported-case',issues:[{code:'adu-comparison-failed',recordId:request.owner.projectId,field:'aduComparison',severity:'error',explanation:'The applied ADU comparison could not be calculated.',resolution:'Resolve the project inputs and request the comparison again.'}]};}
 return{owner:request.owner,result};
}
const scope=globalThis as unknown as {onmessage:((e:MessageEvent<AduComparisonWorkerRequest>)=>void)|null;postMessage?:(reply:AduComparisonWorkerReply)=>void};
if(typeof document==='undefined'&&typeof scope.postMessage==='function')scope.onmessage=event=>scope.postMessage!(calculateAduComparisonWorker(event.data));
