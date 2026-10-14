import {describe,it,expect} from 'vitest';
import {loadWorkspace,saveWorkspace,exportWorkspace,WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';
import {PLAN_STORAGE_KEY,exportPlan,type StoragePort} from '../../src/browser/storage';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from '../helpers/scenarios';
import {makePlan} from '../helpers/plans';

describe('workspace storage',()=>{
  it('migrates the legacy plan exactly once and keeps original bytes',()=>{
    const plan=makePlan({revision:9}),raw=exportPlan(plan),store=memoryWorkspaceStorage(new Map([[PLAN_STORAGE_KEY,raw]]));
    const result=loadWorkspace(store.port,()=> 'master');expect(result.status).toBe('migrated');if(result.status==='migrated')expect(result.document.scenarios[0]!.plan).toEqual(plan);
    expect(store.writes()).toBe(1);expect(store.values.get(PLAN_STORAGE_KEY)).toBe(raw);expect(loadWorkspace(store.port,()=> 'new').status).toBe('loaded');expect(store.writes()).toBe(1);
  });
  it('gives the new key precedence and never falls back on invalid bytes',()=>{
    for(const raw of ['broken',JSON.stringify({...makeScenarioWorkspace(),schemaVersion:2})]){
      const store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw],[PLAN_STORAGE_KEY,exportPlan(makePlan())]]));const result=loadWorkspace(store.port,()=> 'master');
      expect(result.status).toBe('invalid');expect(result.persistence).toMatchObject({observedRaw:raw,suspension:'unreadable',recovery:{key:WORKSPACE_STORAGE_KEY,raw}});expect(store.writes()).toBe(0);
    }
  });
  it('distinguishes missing, invalid legacy and read failure without overwrites',()=>{
    expect(loadWorkspace(memoryWorkspaceStorage().port,()=> 'master').status).toBe('missing');
    const invalid=memoryWorkspaceStorage(new Map([[PLAN_STORAGE_KEY,'bad legacy']]));expect(loadWorkspace(invalid.port,()=> 'master').persistence.recovery).toEqual({key:PLAN_STORAGE_KEY,raw:'bad legacy'});expect(invalid.writes()).toBe(0);
    let writes=0;const port:StoragePort={getItem(){throw Error('blocked');},setItem(){writes++;}};const failed=loadWorkspace(port,()=> 'master');expect(failed.status).toBe('read-failed');expect(failed.persistence.observedRaw).toBeUndefined();expect(failed.persistence.suspension).toBe('unreadable');expect(writes).toBe(0);
  });
  it('retains migrated inputs after quota failure and preserves unknown histories',()=>{
    const plan=makePlan();const raw=exportPlan({...plan,household:{...plan.household,coverageAnswers:{...plan.household.coverageAnswers,additionalIncome:{known:false}}}});const store=memoryWorkspaceStorage(new Map([[PLAN_STORAGE_KEY,raw]]));
    const result=loadWorkspace({...store.port,setItem(){throw Error('quota');}},()=> 'master');expect(result.status).toBe('migrated');expect(result.persistence).toMatchObject({persisted:false,observedRaw:null,suspension:'none'});if(result.status==='migrated')expect(result.document.scenarios[0]!.plan.household.coverageAnswers.additionalIncome).toEqual({known:false});
  });
  it('checks raw observations and validates before its one write',()=>{
    const doc=makeScenarioWorkspace(),store=memoryWorkspaceStorage();const first=saveWorkspace(store.port,doc,null);expect(first.status).toBe('saved');expect(first.observedRaw).toBe(exportWorkspace(doc));expect(store.writes()).toBe(1);
    expect(saveWorkspace(store.port,doc,null).status).toBe('external-change');expect(store.writes()).toBe(1);
    expect(saveWorkspace(store.port,{...doc,scenarios:[]},first.observedRaw).status).toBe('invalid');expect(store.writes()).toBe(1);
    expect(saveWorkspace({...store.port,getItem(){throw Error('blocked');}},doc,first.observedRaw).status).toBe('read-failed');expect(store.writes()).toBe(1);
    expect(saveWorkspace({...store.port,setItem(){throw Error('quota');}},doc,first.observedRaw)).toMatchObject({status:'write-failed',observedRaw:first.observedRaw});
  });
  it('exports the complete envelope without runtime state',()=>{const doc=makeScenarioWorkspace();expect(JSON.parse(exportWorkspace(doc))).toEqual(doc);});
  it('suspends migration when a workspace appears between read and write',()=>{
    let reads=0,writes=0;const port:StoragePort={getItem(key){return key===PLAN_STORAGE_KEY?exportPlan(makePlan()):reads++===0?null:'external';},setItem(){writes++;}};
    const result=loadWorkspace(port,()=> 'master');expect(result.status).toBe('migrated');expect(result.persistence.suspension).toBe('external-change');expect(writes).toBe(0);
  });
});
