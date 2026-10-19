import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {renderPropertiesForm} from '../../src/browser/forms/properties';
import {createRecordEditorMemory} from '../../src/browser/record-ui-state';
import {createEditorViewSession} from '../../src/browser/scenario-session';
import {createWorkspace,prepareEdit,type RawObject} from '../../src/browser/state';
import {mountOverview} from '../../src/browser/views/overview';
import {makePlan} from '../helpers/plans';
import {makeAduPlan} from '../helpers/adu';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
import {makeEstimatedMortgagePlan} from '../helpers/estimated-mortgage';
import {memoryWorkspaceStorage} from '../helpers/scenarios';
import {mountPresentation} from '../helpers/presentation';
import {setField} from '../helpers/dom';
import {makeGrowthPlan} from '../helpers/growth';
import type {PlanDocument} from '../../src/engine';

const cleanups:(()=>void)[]=[];afterEach(()=>{cleanups.splice(0).reverse().forEach(fn=>fn());document.body.replaceChildren();});
function mount(plan:PlanDocument=makeFuturePurchasePlan()){
 const {root,context}=mountPresentation(plan),store=memoryWorkspaceStorage(),controller=createWorkspace(plan,store.port),id=plan.properties[0]!.id,memory=createRecordEditorMemory();
 renderPropertiesForm(root,controller,context,{section:'properties',recordId:id,memory,onSubmit(){controller.saveProperty(id);}});cleanups.push(()=>context.disclosures.dispose());
 return {root,context,controller,id,memory,store};
}
describe('focused property groups',()=>{
 it('retains custom appreciation and year overrides while changing the source without writes',()=>{
  const base=makeGrowthPlan({horizonYears:2,growthAssumptions:{propertyBps:400}}),plan={...base,properties:base.properties.map(p=>({...p,appreciationSource:'property-default' as const,appreciationOverrides:[{year:2027,rateBps:-100}]}))};
  const {root,controller,id,store,context}=mount(plan),view=createEditorViewSession(plan);view.selections.forecastYear=2027;
  renderPropertiesForm(root,controller,{...context,editorView:view},{section:'properties',recordId:id,memory:createRecordEditorMemory(),onSubmit(){controller.saveProperty(id);}});
  expect(within(root).getByLabelText('Property growth source')).toHaveValue('property-default');expect(root).toHaveTextContent('4.00% annual appreciation');expect(root).toHaveTextContent('2027: -1.00% · Year override');
  const summary=within(root).getByText(/2027: -1.00% · Year override/);view.selections.forecastYear=2026;summary.dispatchEvent(new Event('forecast-year-selected'));expect(summary).toHaveTextContent('2026: 4.00% · Property category default');view.selections.forecastYear=2027;summary.dispatchEvent(new Event('forecast-year-selected'));
  expect(within(root).queryByLabelText('Effective annual appreciation (%)')).toBeNull();
  setField(root,'Property growth source','custom');expect(within(root).getByLabelText('Effective annual appreciation (%)')).toHaveValue('3.00');
  setField(root,'Property growth source','property-default');setField(root,'Property growth source','custom');
  expect(within(root).getByLabelText('Effective annual appreciation (%)')).toHaveValue('3.00');expect(root).toHaveTextContent('2027: -1.00% · Year override');
  expect(store.writes()).toBe(0);expect(controller.getState().savedPlan.revision).toBe(0);
  fireEvent.submit(root.querySelector('form')!);const saved=controller.getState().savedPlan;
  expect(saved.properties[0]!.appreciationBps).toBe(300);expect(saved.properties[0]!.appreciationSource).toBeUndefined();expect(saved.properties[0]!.appreciationOverrides).toEqual([{year:2027,rateBps:-100}]);
 });
 it('initializes new properties from the applied category and leaves an unconfigured category custom',()=>{
  const store=memoryWorkspaceStorage(),controller=createWorkspace(makeGrowthPlan({growthAssumptions:{propertyBps:400}}),store.port),draft=controller.getGrowthDraft();
  controller.editGrowthDraft({...draft,value:{...draft.value,defaults:{propertyBps:'9.00'}}});
  const id=controller.beginAdd('properties');expect(controller.getDraft('properties',id).value.property).toMatchObject({appreciationSource:'property-default',appreciationBps:'0.00'});
  expect(controller.getState().savedPlan.properties[0]!.appreciationSource).toBeUndefined();
  const custom=createWorkspace(makeGrowthPlan(),memoryWorkspaceStorage().port),proposal=custom.getGrowthDraft();custom.editGrowthDraft({...proposal,value:{...proposal.value,defaults:{propertyBps:'9.00'}}});const customId=custom.beginAdd('properties');expect((custom.getDraft('properties',customId).value.property as RawObject).appreciationSource).toBeUndefined();expect(store.writes()).toBe(0);
 });
 it('moves through Property, Financing and Rent & costs without applying or creating a revision',()=>{
  const {root,controller,store}=mount();const name=within(root).getByLabelText('Property name');expect(name).toBeVisible();
  fireEvent.click(within(root).getByRole('button',{name:'Financing'}));expect(within(root).getByLabelText('Mortgage APR (%)')).toBeVisible();expect(within(root).getByLabelText('Property name')).not.toBeVisible();
  fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));expect(within(root).getByRole('button',{name:'Add property expense'})).toBeVisible();expect(name.isConnected).toBe(true);fireEvent.click(within(root).getByRole('button',{name:'Property'}));expect(within(root).getByLabelText('Property name')).toBe(name);expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().drafts).toEqual({});expect(store.writes()).toBe(0);
 });
 it('reclassifies at the forecast boundary without replacing manual facts',()=>{
  const {root,controller,id}=mount();fireEvent.click(within(root).getByRole('button',{name:'Financing'}));setField(root,'First payment date','2027-07-31');fireEvent.click(within(root).getByRole('button',{name:'Property'}));setField(root,'Property purchase date','2026-01-01');expect(root).toHaveTextContent('Owned at forecast start');setField(root,'Property purchase date','2026-01-02');expect(root).toHaveTextContent('Purchase after forecast start');
  expect(controller.getDraft('properties',id).value).toMatchObject({property:{loans:[expect.objectContaining({firstPaymentDate:'2027-07-31'})]}});expect(controller.getState().savedPlan.revision).toBe(0);
 });
 it('reclassifies after a household start-year change while retaining purchase history and manual dates',()=>{
  const {root,controller,id}=mount();const household=controller.getDraft('household','household');controller.editDraft('household',{...household,value:{...household.value,startYear:'2028'}});expect(controller.saveRecord('household').accepted).toBe(true);
  renderPropertiesForm(root,controller,undefined,{section:'properties',recordId:id,memory:createRecordEditorMemory(),onSubmit(){}});expect(root).toHaveTextContent('Owned at forecast start');expect(controller.getDraft('properties',id).value).toMatchObject({property:{purchaseDate:'2027-06-15',loans:[expect.objectContaining({firstPaymentDate:'2027-07-31'})]}});
 });
 it('retains the entered planning share when detailed mode is reversed',()=>{
  const plan=makeFuturePurchasePlan({}, {role:'rental',purchaseTaxEstimation:{mode:'simple',buildingShareBps:7300}}),{root,controller,id}=mount(plan);fireEvent.click(within(root).getByRole('button',{name:'Financing'}));setField(root,'Estimated building share (%)','74.50');setField(root,'Purchase tax calculation','detailed');setField(root,'Purchase tax calculation','simple');expect(within(root).getByLabelText('Estimated building share (%)')).toHaveValue('74.50');
  expect((controller.getDraft('properties',id).value.property as RawObject).purchaseTaxEstimation).toEqual({mode:'simple',buildingShareBps:'74.50'});
 });
 it('retains entered rental history and unfinished blanks when unknown history is reversed',()=>{
  const base=makeAduPlan(),{aduProject,...property}=base.properties[0]!,source={...base,properties:[property],rentals:base.rentals.map(unit=>({...unit,availableDate:'2026-01-01',rentStartDate:'2026-01-01'}))},{root,controller}=mount(source);fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));const history=()=>root.querySelector<HTMLElement>('[data-field-group="rentals.0.taxHistory.federal"]')!;
  setField(history(),'Original building recovery basis (excludes land) ($)','123.45');setField(history(),'Adjusted building basis ($)','');setField(history(),'History status','unknown');expect((controller.getDraft('properties','home').value.rentals as any[])[0].taxHistory.federal).toEqual({known:false});setField(history(),'History status','known');expect(within(history()).getByLabelText('Original building recovery basis (excludes land) ($)')).toHaveValue('123.45');expect(within(history()).getByLabelText('Adjusted building basis ($)')).toHaveValue('');
 });
 it('keeps linked expense, rent and loan changes in one candidate and rejects incomplete purchase facts',()=>{
  const {root,controller,id}=mount();setField(root,'Purchase price ($)','');expect(prepareEdit(controller,{kind:'record',section:'properties',recordId:id}).status).toBe('invalid');expect(controller.getState().savedPlan.revision).toBe(0);setField(root,'Purchase price ($)','810000.00');fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));fireEvent.click(within(root).getByRole('button',{name:'Add property expense'}));setField(root,'Property expense amount ($)','125.00');const prepared=prepareEdit(controller,{kind:'record',section:'properties',recordId:id});expect(prepared.status).toBe('ready');if(prepared.status!=='ready')throw Error('candidate required');expect(prepared.plan.properties[0]!.purchasePriceCents).toBe(81_000_000);expect(prepared.plan.expenses[0]!.amountCents).toBe(12500);expect(controller.getState().savedPlan.expenses).toEqual([]);
 });

 it('does not reuse removed rental history for another rental at the same position',()=>{
  const base=makeAduPlan(),{aduProject,...property}=base.properties[0]!,first={...base.rentals[0]!,availableDate:'2026-01-01',rentStartDate:'2026-01-01'},second={...first,id:'second-rental',taxHistory:{...first.taxHistory,federal:{known:false as const}}};
  const {root,controller}=mount({...base,properties:[property],rentals:[first,second]});fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));
  const history=()=>root.querySelector<HTMLElement>('[data-field-group="rentals.0.taxHistory.federal"]')!;
  setField(history(),'Original building recovery basis (excludes land) ($)','123.45');setField(history(),'History status','unknown');
  fireEvent.click(within(root).getAllByRole('button',{name:'Remove rental unit'})[0]!);setField(history(),'History status','known');
  expect((controller.getDraft('properties','home').value.rentals as RawObject[])[0]!.id).toBe('second-rental');
  expect(within(history()).getByLabelText('Original building recovery basis (excludes land) ($)')).toHaveValue('');
 });
 it('does not reuse a removed loan balance for another loan at the same position',()=>{
  const base=makeEstimatedMortgagePlan(),home=base.properties[0]!,loan=home.loans[0]!;
  const {root}=mount({...base,properties:[{...home,loans:[loan,{...loan,id:'second-loan',name:'Second loan',openingBalance:{known:false},openingPayment:{known:false}}]}]});
  fireEvent.click(within(root).getByRole('button',{name:'Financing'}));
  const first=()=>within(root).getAllByRole('group',{name:'Loan terms'})[0]!;
  setField(first(),'Opening mortgage balance history','known');setField(first(),'Opening mortgage balance ($)','123.45');setField(first(),'Opening mortgage balance history','unknown');
  fireEvent.click(within(root).getAllByRole('button',{name:'Remove loan'})[0]!);setField(first(),'Opening mortgage balance history','known');
  expect(within(first()).getByLabelText('Opening mortgage balance ($)')).toHaveValue('');
 });

 it('retains entered QBI loss rows when unknown history is reversed without confirming no losses',()=>{
  const base=makeAduPlan(),{aduProject,...property}=base.properties[0]!,source={...base,properties:[property],rentals:base.rentals.map(unit=>({...unit,availableDate:'2026-01-01',rentStartDate:'2026-01-01'}))};
  const {root,controller}=mount(source);fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));
  fireEvent.click(within(root).getByRole('button',{name:'Add QBI loss vintage',hidden:true}));
  const loss=()=>within(root).getByRole('group',{name:'QBI loss vintage 1',hidden:true});
  setField(loss(),'Loss year','2025');setField(loss(),'Loss amount ($)','321.00');setField(loss(),'Loss amount ($)','654.32');setField(root,'QBI loss history','unknown');
  expect((controller.getDraft('properties','home').value.rentals as any[])[0].qbi.openingLossVintages).toEqual({known:false});
  setField(root,'QBI loss history','known');expect((controller.getDraft('properties','home').value.rentals as any[])[0].qbi.openingLossVintages).toEqual({known:true,value:[{year:'2025',amountCents:'654.32'}]});
 });
 it.each(['rental','expense'])('restores an explicit %s share after using the default',kind=>{
  const base=makeAduPlan(),{aduProject,...property}=base.properties[0]!,source={...base,properties:[property],rentals:base.rentals.map(unit=>({...unit,availableDate:'2026-01-01',rentStartDate:'2026-01-01'}))};
  const {root,controller}=mount(source);fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));
  const scope=()=>kind==='rental'?root:within(root).getByRole('group',{name:'Property expense — Property expense',hidden:true});
  if(kind==='expense'){fireEvent.click(within(root).getByRole('button',{name:'Add property expense'}));setField(scope(),'Property expense use','shared');}
  const label=kind==='rental'?'Shared-cost allocation':'Expense shared allocation';
  const share=()=>kind==='rental'?(controller.getDraft('properties','home').value.rentals as RawObject[])[0]!.sharedAllocation:(controller.getDraft('properties','home').value.expenses as RawObject[])[0]!.allocationOverride;
  setField(scope(),label,'explicit');setField(scope(),'Rental portion','2');setField(scope(),'Total portions','7');setField(scope(),label,'default');expect(share()).toBeUndefined();
  setField(scope(),label,'explicit');expect(share()).toEqual({numerator:'2',denominator:'7'});
 });
 it('does not clear the applied ADU comparison selection while rendering a candidate without that project',()=>{
  const applied=makeAduPlan(),{root,context}=mountPresentation(applied),view=createEditorViewSession(applied),controller=createWorkspace(applied,memoryWorkspaceStorage().port);const binding=mountOverview(root,{plan:applied,projection:controller.getState().projection,comparison:null,status:'applied',label:'Applied',allowDeltas:false},context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());const candidate=makePlan({startYear:2027,horizonYears:1}),other=createWorkspace(candidate,memoryWorkspaceStorage().port);binding.update({plan:candidate,projection:other.getState().projection,comparison:{plan:applied,projection:controller.getState().projection},status:'preview',label:'Preview',allowDeltas:true});expect(view.selectedAduProjectId).toBe('adu-project');expect(view.selections.forecastYear).toBe(2027);
 });
});
