import {describe,expect,it} from 'vitest';
import {calculateProjection,loadRuleSet,type PlanDocument,type ProjectionResult} from '../../src/engine';
import {MAX_CENTS} from '../../src/engine/money';
import {selectReportSnapshot,type ReportSnapshot} from '../../src/browser/report-snapshot';
import {buildOverviewRows} from '../../src/browser/overview-model';
import type {EditPreviewState} from '../../src/browser/edit-types';
import type {WorkspaceState} from '../../src/browser/state';
import {makePlan,mustValidate} from '../helpers/plans';
import {loadReferences} from '../helpers/references';

const project=(plan:PlanDocument)=>calculateProjection(mustValidate(plan),loadRuleSet());
const state=(savedPlan:PlanDocument):WorkspaceState=>({savedPlan,projection:project(savedPlan),drafts:{},persisted:true,issues:[],persistenceIssues:[]});
const inactive:EditPreviewState={status:'inactive',target:null,current:null,lastValid:null,issues:[]};
function snapshot(plan:PlanDocument,base:PlanDocument):ReportSnapshot{return {plan,projection:project(plan),comparison:{plan:base,projection:project(base)},status:'preview',label:'Preview',allowDeltas:true};}

describe('coherent report snapshots',()=>{
 it('does not compare an old candidate with a new base',()=>{
  const old=makePlan({openingCashCents:10000}),candidate=makePlan({revision:1,openingCashCents:12500}),current=makePlan({revision:1,openingCashCents:20000});
  const pending:EditPreviewState={...inactive,status:'pending',lastValid:{plan:candidate,projection:project(candidate),basePlan:old}};
  const displayed=selectReportSnapshot(state(current),pending);
  expect(displayed).toMatchObject({status:'updating',allowDeltas:false,comparison:null});expect(displayed.plan).toBe(candidate);expect(displayed.label).toMatch(/previous preview/i);
 });
 it('compares only a current receipt against its identical applied base',()=>{
  const base=mustValidate(makePlan({openingCashCents:10000})),candidate=mustValidate(makePlan({revision:1,openingCashCents:12500})),applied={...state(base),savedPlan:base};
  const preview:EditPreviewState={...inactive,status:'valid',target:{kind:'record',section:'household',recordId:'household'},current:{prepared:{status:'ready',target:{kind:'record',section:'household',recordId:'household'},plan:candidate,basePlan:base,ruleSet:loadRuleSet(),controllerEpoch:0,draftGeneration:1,token:1},projection:project(candidate)}};
  expect(selectReportSnapshot(applied,preview)).toMatchObject({status:'preview',allowDeltas:true,comparison:{plan:base}});
  expect(selectReportSnapshot({...applied,savedPlan:{...base}},preview)).toMatchObject({status:'updating',allowDeltas:false,comparison:null});
  expect(selectReportSnapshot(applied,inactive)).toMatchObject({plan:base,status:'applied',comparison:null,allowDeltas:false});
 });
 it.each(['invalid','stale','failed'] as const)('labels %s retained reports without current deltas',status=>{
  const plan=makePlan();const displayed=selectReportSnapshot(state(plan),{...inactive,status,lastValid:{plan,projection:project(plan),basePlan:plan}});
  expect(displayed.status).toBe(status==='failed'?'failed':'paused');expect(displayed.allowDeltas).toBe(false);expect(displayed.comparison).toBeNull();expect(displayed.label).toMatch(/previous preview/i);
 });
});

describe('availability-safe annual overview',()=>{
 it('maps engine balance stocks and subtracts exact available cents',()=>{
  const base=makePlan({openingCashCents:10000}),candidate=makePlan({revision:1,openingCashCents:12500});
  const [row]=buildOverviewRows(snapshot(candidate,base));
  expect(row?.balance).toEqual({year:2026,reserveCents:{status:'available',value:12500},accountBalanceCents:{status:'available',value:0},propertyValueCents:{status:'available',value:0},loanBalanceCents:{status:'available',value:0},netWorthCents:{status:'available',value:12500}});
  expect(row?.deltas.reserveCents).toEqual({status:'available',value:2500});expect(row?.deltas.cashFlowCents).toEqual({status:'available',value:0});expect(row?.financial.cashFlowCents).toEqual({status:'available',value:0});
 });
 it('does not fabricate numeric deltas for unavailable rental results',()=>{
  const reference=loadReferences<PlanDocument,ProjectionResult>('projection').find(item=>item.id==='unknown-rental-history-two-years')!;
  const [row]=buildOverviewRows(snapshot(reference.input,reference.input));
  expect(row?.financial.cashFlowCents.status).toBe('needs-data');expect(row?.deltas.cashFlowCents?.status).toBe('needs-data');expect(row?.balance.propertyValueCents.status).toBe('available');
 });
 it('marks candidate-only years and catches subtraction overflow',()=>{
  const base=makePlan({openingCashCents:-MAX_CENTS}),candidate=makePlan({horizonYears:2,openingCashCents:MAX_CENTS});const rows=buildOverviewRows(snapshot(candidate,base));
  expect(rows[0]?.deltas.reserveCents?.status).toBe('unsupported-case');expect(rows[1]?.noComparison).toBe(true);expect(rows[1]?.deltas.reserveCents).toBeNull();
 });
 it('hides every delta while a retained report has no current comparison',()=>{
  const base=makePlan(),value=snapshot(makePlan({openingCashCents:10000}),base);
  expect(Object.values(buildOverviewRows({...value,allowDeltas:false})[0]!.deltas)).toEqual([null,null,null,null,null,null]);
 });
});
