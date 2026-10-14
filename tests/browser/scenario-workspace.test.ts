import {describe,it,expect} from 'vitest';
import {createScenarioWorkspace,validateScenarioWorkspace,validateScenarioName,suggestForkName} from '../../src/browser/scenario-workspace';
import {createEditorViewSession,normalizeViewYears} from '../../src/browser/scenario-session';
import {makePlan} from '../helpers/plans';
import {makeAllocationPlan} from '../helpers/allocations';

describe('scenario workspace contract',()=>{
  it('wraps unchanged plans with separate identities and frozen output',()=>{
    const plan=makeAllocationPlan();const doc=createScenarioWorkspace(plan,'constructor');
    expect(doc).toMatchObject({kind:'lifelook-workspace',schemaVersion:1,workspaceRevision:0,baselineScenarioId:'constructor',activeScenarioId:'constructor'});
    expect(doc.scenarios[0]).toEqual({id:'constructor',name:'Master',plan});
    expect(doc.scenarios[0]!.plan).not.toBe(plan);expect(Object.isFrozen(doc.scenarios[0]!.plan)).toBe(true);
    expect(Object.hasOwn(createScenarioWorkspace(makePlan(),'master').scenarios[0]!.plan,'children')).toBe(false);
  });
  it('allows repeated financial identities and deleted historical fork sources',()=>{
    const doc=createScenarioWorkspace(makeAllocationPlan(),'master');
    expect(validateScenarioWorkspace({...doc,scenarios:[...doc.scenarios,{id:'fork',name:'Fork',plan:doc.scenarios[0]!.plan,forkedFrom:{scenarioId:'deleted',scenarioName:'Old source',planRevision:4}}]}).ok).toBe(true);
  });
  it.each([
    {kind:'plan'},{schemaVersion:2},{workspaceRevision:-1},{workspaceRevision:Number.MAX_SAFE_INTEGER+1},
    {scenarios:[]},{activeScenarioId:'gone'},{baselineScenarioId:'gone'},
  ])('rejects invalid envelope metadata %j',override=>expect(validateScenarioWorkspace({...createScenarioWorkspace(makePlan(),'master'),...override}).ok).toBe(false));
  it('rejects duplicate IDs, names, untrimmed stored names and malformed provenance',()=>{
    const doc=createScenarioWorkspace(makePlan(),'master'),row=doc.scenarios[0]!;
    for(const other of [{...row,name:'Other'},{...row,id:'two',name:'MASTER'},{...row,id:'two',name:' Other '},{...row,id:'two',name:'Other',forkedFrom:{scenarioId:'master',scenarioName:'Master',planRevision:1.5}}])expect(validateScenarioWorkspace({...doc,scenarios:[row,other]}).ok).toBe(false);
  });
  it('attaches scenario identity and plan field path to invalid financial links',()=>{
    const doc=createScenarioWorkspace(makeAllocationPlan(),'master');
    const plan={...doc.scenarios[0]!.plan,contributions:[{id:'bad-link',accountId:'gone',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}]};
    const result=validateScenarioWorkspace({...doc,scenarios:[{id:'master',name:'Master',plan}]});
    expect(result.ok).toBe(false);if(!result.ok)expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({scenarioId:'master',scenarioName:'Master',recordId:'bad-link',field:expect.stringMatching(/^scenarios\[0\]\.plan/)} )]));
  });
  it('trims entered names and counts Unicode code points',()=>{
    const doc=createScenarioWorkspace(makePlan(),'master');
    expect(validateScenarioName(' lower growth ',doc.scenarios)).toEqual({ok:true,name:'lower growth'});
    expect(validateScenarioName('MASTER',doc.scenarios).ok).toBe(false);
    expect(validateScenarioName(' Master ',doc.scenarios,'master').ok).toBe(true);
    expect(validateScenarioName('😀'.repeat(80),[]).ok).toBe(true);expect(validateScenarioName('😀'.repeat(81),[]).ok).toBe(false);
    expect(validateScenarioName(' ',[]).ok).toBe(false);
  });
  it('suggests unique fork names even for maximum-length emoji names',()=>{
    const source='😀'.repeat(80),doc=createScenarioWorkspace(makePlan(),'master');const first=suggestForkName(source,doc.scenarios);
    expect(Array.from(first)).toHaveLength(80);expect(first.endsWith(' copy')).toBe(true);
    const second=suggestForkName(source,[...doc.scenarios,{id:'two',name:first,plan:makePlan()}]);
    expect(Array.from(second).length).toBeLessThanOrEqual(80);expect(second.endsWith(' copy 2')).toBe(true);
  });
  it('isolates mutable session state, inherits only selections and clamps years',()=>{
    const plan=makePlan({horizonYears:2}),view=createEditorViewSession(plan);view.selections.forecastYear=2027;view.selections.allocationYear=2027;view.selections.hiddenPlotSeries.add('cashFlowCents');view.taskIssues.set('household',[]);
    const fork=createEditorViewSession(plan,view.selections);fork.selections.hiddenPlotSeries.clear();expect(view.selections.hiddenPlotSeries.size).toBe(1);expect(fork.taskIssues.size).toBe(0);expect(fork.propertyDisclosures).not.toBe(view.propertyDisclosures);
    normalizeViewYears(view,{...plan,horizonYears:1});expect(view.selections.forecastYear).toBe(2026);expect(view.selections.allocationYear).toBe(2026);expect(view.selections.hiddenPlotSeries.has('cashFlowCents')).toBe(true);expect(plan.revision).toBe(0);
  });
});
