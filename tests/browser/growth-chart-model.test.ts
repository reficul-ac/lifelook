import {describe,expect,it} from 'vitest';
import {calculateProjection,loadRuleSet,type Available,type Cents,type PlanDocument} from '../../src/engine';
import {MAX_CENTS} from '../../src/engine/money';
import {buildGrowthChartModel} from '../../src/browser/growth-chart-model';
import type {ReportSnapshot} from '../../src/browser/report-snapshot';
import {makePlan,mustValidate} from '../helpers/plans';

const amount=(value:number):Available<Cents>=>({status:'available',value});
function snapshot(plan:PlanDocument,base?:PlanDocument):ReportSnapshot {
 return {plan,projection:calculateProjection(mustValidate(plan),loadRuleSet()),comparison:base?{plan:base,projection:calculateProjection(mustValidate(base),loadRuleSet())}:null,status:base?'preview':'applied',label:base?'Preview · Growth assumptions':'Applied results',allowDeltas:!!base};
}

describe('growth chart annual model',()=>{
 it('pairs exact annual cents with the current applied year',()=>{
  const value=snapshot(makePlan({openingCashCents:12500}),makePlan({openingCashCents:10000}));
  expect(buildGrowthChartModel(value,2026,'all').points[0]).toMatchObject({year:2026,netWorth:amount(12500),appliedNetWorth:amount(10000),delta:amount(2500)});
  expect(buildGrowthChartModel({...value,comparison:null,allowDeltas:false},2026,'all').points[0]!.delta).toBeNull();
 });
 it.each(['updating','paused','failed','applied'] as const)('removes numeric comparison from a %s producing snapshot',status=>{
  const value={...snapshot(makePlan({openingCashCents:12500}),makePlan({openingCashCents:10000})),status,label:'Preview paused · previous preview'};
  const model=buildGrowthChartModel(value,2026,'all');
  expect(model.canCompare).toBe(false);expect(model.sourceLabel).toBe('Preview paused · previous preview');
  expect(model.points[0]).toMatchObject({appliedNetWorth:null,delta:null});
 });
 it('retains negative and zero values, gaps, and missing applied years without fabricating deltas',()=>{
  const value=snapshot(makePlan({horizonYears:3}),makePlan({horizonYears:2}));
  const missing:Available<Cents>={status:'needs-data',issues:[]};
  const unsupported:Available<Cents>={status:'unsupported-case',issues:[]};
  const candidate={...value,projection:{...value.projection,years:value.projection.years.map((row,index)=>({...row,netWorthCents:[amount(-100),missing,amount(0)][index]!}))},comparison:{...value.comparison!,projection:{...value.comparison!.projection,years:value.comparison!.projection.years.map((row,index)=>({...row,netWorthCents:index?unsupported:amount(-200)}))}}};
  const model=buildGrowthChartModel(candidate,2027,'all');
  expect(model.selectedYear).toBe(2027);expect(model.points.map(point=>point.netWorth)).toEqual([amount(-100),missing,amount(0)]);
  expect(model.points[0]!.delta).toEqual(amount(100));expect(model.points[1]!.delta?.status).toBe('unsupported-case');
  expect(model.points[2]).toMatchObject({appliedNetWorth:null,delta:null});
 });
 it('reports delta overflow as unsupported',()=>{
  const model=buildGrowthChartModel(snapshot(makePlan({openingCashCents:MAX_CENTS}),makePlan({openingCashCents:-MAX_CENTS})),2026,'all');
  expect(model.points[0]!.delta).toMatchObject({status:'unsupported-case',issues:[{code:'monetary-overflow'}]});
 });
 it('uses five year-end points and retains horizons from the full forecast',()=>{
  const model=buildGrowthChartModel(snapshot(makePlan({horizonYears:20})),2045,5);
  expect(model.points.map(point=>point.year)).toEqual([2026,2027,2028,2029,2030]);
  expect(model.selectedYear).toBe(2030);expect(model.availableHorizons).toEqual([5,10,15,'all']);
 });
 it('offers only distinct horizon lengths and normalizes unsupported preferences after a plan change',()=>{
  expect(buildGrowthChartModel(snapshot(makePlan({horizonYears:1})),NaN,5)).toMatchObject({horizon:'all',availableHorizons:['all'],selectedYear:2026});
  expect(buildGrowthChartModel(snapshot(makePlan({horizonYears:10})),2040,15)).toMatchObject({horizon:'all',availableHorizons:[5,'all'],selectedYear:2035});
 });
 it('clips to the producing plan bounds and selects the nearest actual year',()=>{
  const value=snapshot(makePlan({horizonYears:4}));
  const withGap={...value,projection:{...value.projection,years:value.projection.years.filter(year=>year.year!==2027)}};
  expect(buildGrowthChartModel(withGap,2027,'all').selectedYear).toBe(2026);
  const next={...value,plan:{...value.plan,startYear:2028,horizonYears:1}};
  expect(buildGrowthChartModel(next,2026,'all').points.map(point=>point.year)).toEqual([2028]);
 });
});
