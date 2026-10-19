import {afterEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet,type Issue,type PlanDocument} from '../../src/engine';
import {buildAttention,mountAttention} from '../../src/browser/views/attention';
import {mountSettings} from '../../src/browser/settings';
import {mountPersistenceStatus} from '../../src/browser/persistence-status';
import {mountAppearance} from '../../src/browser/ui/appearance';
import {createScenarioManager} from '../../src/browser/scenario-manager';
import {createWorkspace,toDraftValue} from '../../src/browser/state';
import {renderPropertiesForm} from '../../src/browser/forms/properties';
import {reviewTarget} from '../../src/browser/navigation';
import type {ReportSnapshot} from '../../src/browser/report-snapshot';
import {makePlan,mustValidate} from '../helpers/plans';
import {makeAduPlan} from '../helpers/adu';
import {mountPresentation} from '../helpers/presentation';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from '../helpers/scenarios';
import {WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';

const cleanups:(()=>void)[]=[];afterEach(()=>{cleanups.splice(0).reverse().forEach(fn=>fn());vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
const issue=(code:string,extra:Partial<Issue>={}):Issue=>({code,recordId:'household',field:'household.coverageAnswers.additionalIncome',year:2026,severity:'warning',explanation:`Cause ${code}`,resolution:'Supply the relevant facts.',...extra});
function snapshot(plan:PlanDocument=makePlan(),issues:readonly Issue[]=[]):ReportSnapshot {return {plan,projection:{...calculateProjection(mustValidate(plan),loadRuleSet()),issues},comparison:null,status:'applied',label:'Applied results',allowDeltas:false};}
function managerSetup(suspension:'none'|'unreadable'|'external-change'='none'){
 const document=makeScenarioWorkspace(),raw=suspension==='unreadable'?'unreadable original bytes':JSON.stringify(document),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw]]));let fail=true;
 const manager=createScenarioManager(document,{...store.port,setItem(key,value){if(fail)throw Error('quota');store.port.setItem(key,value);}},loadRuleSet(),{persisted:suspension==='none',persistenceIssues:[],observedRaw:raw,suspension,...(suspension==='unreadable'?{recovery:{key:WORKSPACE_STORAGE_KEY,raw}}:{})});
 cleanups.push(manager.dispose);return {manager,store,raw,allowSaving(){fail=false;}};
}

describe('current-report attention',()=>{
 it('groups repeated periods and distinguishes meaning independently of severity',()=>{
  const report=snapshot(makePlan({horizonYears:2}),[issue('required-history'),issue('required-history',{year:2027}),issue('cash-gap',{severity:'info'}),issue('unsupported-tax-case',{severity:'info'}),issue('provisional-rules',{severity:'error'})]),draft=issue('invalid-input',{severity:'warning'});
  const items=buildAttention(report,[draft],{savedPlan:report.plan,drafts:{}});
  expect(items.map(item=>item.kind).sort()).toEqual(['assumption','funding','input','missing-data','unsupported']);expect(items.find(item=>item.kind==='missing-data')?.group.periods).toEqual([{year:2026},{year:2027}]);expect(items.find(item=>item.kind==='unsupported')?.targets).toEqual([]);
 });
 it('routes candidate-only records and ignores detached earlier-report and disposed actions',()=>{
  const applied=makePlan(),candidate=makePlan({accounts:[{id:'new-account',name:'Candidate account',type:'traditional-ira',ownerId:'owner-a',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}]}),{root,context,reviews}=mountPresentation(applied),binding=mountAttention(root,context,target=>reviews.push(target));cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  const report=snapshot(candidate,[issue('required-ira-basis',{recordId:'new-account',field:'openingIraBasis'})]);binding.update(report,[]);fireEvent.click(within(root).getByRole('button',{name:/attention/i}));
  const oldAction=within(root).getByRole('button',{name:'Review Candidate account'});binding.update({...report,plan:{...candidate}},[]);fireEvent.click(oldAction);expect(reviews).toEqual([]);
  const current=within(root).getByRole('button',{name:'Review Candidate account'});fireEvent.click(current);expect(reviews).toEqual([{section:'Investments',recordId:'new-account',field:'openingIraBasis',label:'Review Candidate account'}]);binding.dispose();fireEvent.click(current);expect(reviews).toHaveLength(1);
 });
 it('opens the owning property and focuses its exact nested ADU control',()=>{
  const plan=makeAduPlan(),store=memoryWorkspaceStorage(),controller=createWorkspace(plan,store.port),{root,context}=mountPresentation(plan),editor=document.createElement('section');editor.dataset.section='Properties';const host=document.createElement('div');root.append(editor,host);renderPropertiesForm(editor,controller,context);
  const binding=mountAttention(host,context,target=>reviewTarget(root,target));cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  binding.update(snapshot(plan,[issue('required-history',{recordId:'building-stage',field:'amountCents'})]),[]);fireEvent.click(within(host).getByRole('button',{name:/attention/i}));fireEvent.click(within(host).getByRole('button',{name:'Review Building'}));
  expect(editor.querySelector('[data-field="property.aduProject.costs.0.amountCents"]')).toHaveFocus();
 });
 it('keeps the selected explanation open until resolution without taking editor focus',()=>{
  const {root,context}=mountPresentation(),binding=mountAttention(root,context,context.review);cleanups.push(binding.dispose,()=>context.disclosures.dispose());const warning=issue('unsupported-tax-case');binding.update(snapshot(makePlan(),[warning]),[]);fireEvent.click(within(root).getByRole('button',{name:/attention/i}));const disclosure=within(root).getByRole('button',{name:/explanation/i});fireEvent.click(disclosure);const panel=within(document.body).getByRole('region',{name:/Unsupported case/});
  binding.update(snapshot(makePlan({revision:1}),[warning]),[]);expect(panel).toBeVisible();expect(within(panel).queryByRole('button',{name:/Review/})).toBeNull();const input=document.createElement('input');document.body.append(input);input.focus();binding.update(snapshot(),[]);expect(panel).not.toBeVisible();expect(input).toHaveFocus();expect(root).toHaveTextContent(/resolved/i);
 });
});

describe('global persistence and settings',()=>{
 it('keeps an accepted storage failure visible through appearance changes and valid missing-data edits',()=>{
  const {manager}=managerSetup(),root=document.createElement('main');document.body.append(root);const status=document.createElement('div'),settings=document.createElement('div');root.append(status,settings);const persistence=mountPersistenceStatus(status,manager),appearance=mountAppearance(document.documentElement,{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},{matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList),binding=mountSettings(settings,manager,appearance);cleanups.push(persistence.dispose,binding.dispose,appearance.dispose);
  const controller=manager.getActiveSession().controller,draft=controller.getDraft('household','household'),base=controller.getState().savedPlan;controller.editDraft('household',{...draft,value:toDraftValue({household:{...base.household,coverageAnswers:{...base.household.coverageAnswers,additionalIncome:{known:false}}},taxPolicy:base.taxPolicy,startYear:base.startYear,horizonYears:base.horizonYears,openingCashCents:12500})});
  expect(controller.saveRecord('household').accepted).toBe(true);expect(status).toHaveTextContent('Applied');expect(status).toHaveTextContent('Not saved locally');fireEvent.change(within(settings).getByLabelText('Appearance'),{target:{value:'light'}});expect(document.documentElement.dataset.theme).toBe('light');expect(status).toHaveTextContent('Not saved locally');expect(manager.getState().persistence.persisted).toBe(false);expect(within(status).getByRole('button',{name:'Export workspace backup'})).toBeVisible();
 });
 it('disables retry after an external change while leaving export accessible',()=>{
  const {manager,allowSaving}=managerSetup(),root=document.createElement('div');document.body.append(root);const binding=mountPersistenceStatus(root,manager);cleanups.push(binding.dispose);manager.observeExternalStorage('different external bytes');allowSaving();expect(within(root).getByRole('button',{name:'Retry local save'})).toBeDisabled();expect(within(root).getByRole('button',{name:'Export workspace backup'})).toBeVisible();expect(root).toHaveTextContent('another tab');
 });
 it('downloads protected unreadable bytes and retains recovery through settings changes',()=>{
  const {manager,raw,store}=managerSetup('unreadable'),root=document.createElement('div');document.body.append(root);const binding=mountPersistenceStatus(root,manager);cleanups.push(binding.dispose);let captured:Blob|undefined;vi.stubGlobal('URL',{createObjectURL(blob:Blob){captured=blob;return 'blob:protected';},revokeObjectURL(){}});const clicked=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});fireEvent.click(within(root).getByRole('button',{name:'Download unreadable saved backup'}));expect(clicked).toHaveBeenCalledOnce();expect(captured?.size).toBe(raw.length);expect(store.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);expect(within(root).getByRole('button',{name:'Retry local save'})).toBeDisabled();
 });
});
