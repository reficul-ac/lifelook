import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {renderPropertiesForm} from '../../src/browser/forms/properties';
import {createRecordEditorMemory} from '../../src/browser/record-ui-state';
import {createWorkspace,prepareEdit,type RawObject} from '../../src/browser/state';
import {mountWorkspace,setField} from '../helpers/dom';
import {openRecord,waitForPreview} from '../helpers/workspace-ui';
import {makeAduPlan} from '../helpers/adu';
import {memoryWorkspaceStorage} from '../helpers/scenarios';
import {mountPresentation} from '../helpers/presentation';
import type {PlanDocument} from '../../src/engine';
import {unmountApp} from '../../src/browser/main';

const cleanups:(()=>void)[]=[];afterEach(()=>{cleanups.splice(0).reverse().forEach(fn=>fn());document.body.replaceChildren();});
function mount(plan:PlanDocument=makeAduPlan()){
 const {root,context}=mountPresentation(plan),controller=createWorkspace(plan,memoryWorkspaceStorage().port),memory=createRecordEditorMemory();renderPropertiesForm(root,controller,context,{section:'properties',recordId:'home',memory,onSubmit(){controller.saveProperty('home');}});cleanups.push(()=>context.disclosures.dispose());return {root,controller,memory};
}
describe('ADU groups within the property transaction',()=>{
 it('previews the property bundle while the project comparison remains applied',async()=>{
  const base=makeAduPlan(),stage=base.properties[0]!.aduProject!.costs[0]!,plan=makeAduPlan({}, {taxEstimation:{mode:'simple',propertyTaxRateBps:120},costs:[{...stage,treatments:{federal:{known:false},california:{known:false},'federal-amt':{known:false},'california-amt':{known:false}}}]}),{root,controller}=mountWorkspace(plan),editor=openRecord(root,{kind:'record',section:'properties',recordId:'home'});
  cleanups.push(()=>unmountApp(root));setField(editor,'Total ADU build cost ($)','310000.00');await waitForPreview(root);const prepared=prepareEdit(controller,{kind:'record',section:'properties',recordId:'home'});expect(prepared.status).toBe('ready');if(prepared.status!=='ready')throw Error('property candidate required');expect(prepared.plan.properties[0]!.aduProject!.costs[0]!.amountCents).toBe(31_000_000);expect(controller.getState().savedPlan.properties[0]!.aduProject!.costs[0]!.amountCents).toBe(30_000_000);expect(root).toHaveTextContent('Applied project comparison');expect(within(editor).getByRole('button',{name:'Apply property changes'})).toBeEnabled();
 });
 it('retains financing draw attribution and identities when cash funding is reversed',()=>{
  const financing={id:'loan',name:'Detailed loan',aprBps:0,termMonths:120,firstAmortizingPaymentMonth:'2027-08',collateralPropertyId:'home',draws:[{id:'draw',month:'2027-07',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true as const,value:true},rentalInterestQualified:{known:true as const,value:true},financingAtRiskQualification:{known:true as const,value:true}},source=makeAduPlan({}, {financing}),{root,controller}=mount(source),before=structuredClone((controller.getDraft('properties','home').value.property as RawObject).aduProject);
  setField(root,'ADU funding','cash');expect((controller.getDraft('properties','home').value.property as any).aduProject.financing).toBeUndefined();setField(root,'ADU funding','loan');expect((controller.getDraft('properties','home').value.property as any).aduProject).toEqual(before);expect(controller.getState().savedPlan.revision).toBe(0);
 });
 it('retains direct and per-area valuation assumptions across mode reversal',()=>{
  const {root,controller}=mount();setField(root,'Completion value assumption','value-added');setField(root,'Assumed completion value added ($)','230000.00');setField(root,'Completion value assumption','adu-value-per-square-foot');expect(within(root).getByLabelText('Assumed added value per ADU sq ft ($)')).toHaveValue('275.00');setField(root,'Completion value assumption','value-added');expect(within(root).getByLabelText('Assumed completion value added ($)')).toHaveValue('230000.00');expect(controller.getState().savedPlan.properties[0]!.aduProject!.valuation).toEqual({kind:'adu-value-per-square-foot',valuePerSquareFootCents:27500});
 });
 it('retains simple tax assumptions and independent readiness and lease dates',()=>{
  const base=makeAduPlan(),source=makeAduPlan({}, {taxEstimation:{mode:'simple',propertyTaxRateBps:137},propertyTax:{...base.properties[0]!.aduProject!.propertyTax,marginalRateBps:{known:false}}}),{root,controller}=mount(source);
  setField(root,'ADU tax calculation','detailed');setField(root,'ADU tax calculation','simple');expect(within(root).getByLabelText('Estimated ADU property-tax rate (%)')).toHaveValue('1.37');fireEvent.click(within(root).getByRole('button',{name:'Rent & costs'}));setField(root,'Available for rent date','2027-09-01');setField(root,'Lease income start date','2027-11-01');fireEvent.click(within(root).getByRole('button',{name:'ADU setup'}));setField(root,'Construction completion date','2027-08-31');setField(root,'Construction completion date','2027-09-30');expect(controller.getDraft('properties','home').value).toMatchObject({rentals:[expect.objectContaining({availableDate:'2027-09-01',rentStartDate:'2027-11-01'})]});
 });
 it('does not apply any property inputs when a confirmed treatment conflicts with the changed staged cost',()=>{
  const {root,controller}=mount(),saved=controller.getState().savedPlan;setField(root,'Total ADU build cost ($)','310000.00');setField(root,'ADU project name','Unapplied project');expect(controller.saveProperty('home').accepted).toBe(false);expect(controller.getState().savedPlan).toBe(saved);expect((controller.getDraft('properties','home').value.property as any).aduProject.name).toBe('Unapplied project');
 });
});
