import {describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import type {Issue,PlanDocument,ProjectionResult} from '../../src/engine';
import {resolveFormIssues,revealField,formatFieldIssue} from '../../src/browser/form-feedback';
import {createWorkspace,toDraftValue,type RecordDraft} from '../../src/browser/state';
import {renderField,type FieldContext} from '../../src/browser/fields';
import {mountWorkspace,setField} from '../helpers/dom';
import {mountPresentation} from '../helpers/presentation';
import {makePlan} from '../helpers/plans';
import {validatePlan} from '../../src/engine';
import {loadReferences} from '../helpers/references';
import {openRecord,applyEdit} from '../helpers/workspace-ui';
const problem=(recordId:string,field:string):Issue=>({recordId,field,code:'invalid-input',severity:'error',explanation:'Invalid input',resolution:'Correct this input.'});
describe('draft-relative feedback',()=>{
  it('resolves nested records and bracket paths without matching another record’s identical leaf',async()=>{
    const plan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;
    const controller=createWorkspace(plan,{getItem:()=>null,setItem:()=>{}}),draft=controller.getDraft('properties','home');
    const issues=[problem('home','rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents'),problem(plan.rentals[0]!.id,'loanAllocations[0].share'),problem(plan.properties[0]!.loans[0]!.id,'aprBps'),problem(plan.expenses[0]!.id,'amountCents'),problem('home','unknownAggregate'),problem('different','aprBps')];
    const resolved=resolveFormIssues(draft,plan.id,issues);
    expect(resolved).toHaveLength(5);
    expect(resolved[0]?.path).toEqual(['rentals',0,'taxHistory','federal-amt','value','adjustedBuildingBasisCents']);
    expect(resolved[1]).toMatchObject({path:['rentals',0,'loanAllocations',0,'share'],scope:'group'});
    expect(resolved[2]?.path).toEqual(['property','loans',0,'aprBps']);expect(resolved[3]?.path).toEqual(['expenses',0,'amountCents']);expect(resolved[4]?.scope).toBe('record');
  });
  it('resolves filer and plan paths only in the household task',async()=>{
    const plan=makePlan(),controller=createWorkspace(plan,{getItem:()=>null,setItem:()=>{}}),draft=controller.getDraft('household','household');
    expect(resolveFormIssues(draft,plan.id,[problem('owner-b','birthDate'),problem(plan.id,'startYear')]).map(i=>i.path)).toEqual([['household','filers',1,'birthDate'],['startYear']]);
  });
  it('shows failed-save feedback without replacing or applying the draft input and clears it on editing',async()=>{
    const {root,controller}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});const input=within(root).getByLabelText('Opening cash reserve ($)');
    setField(root,'Opening cash reserve ($)','1.234');await applyEdit(root);
    expect(within(root).getByLabelText('Opening cash reserve ($)')).toBe(input);expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');expect(input).toHaveAccessibleDescription(/up to 2 decimal places/);
    expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().projection.inputRevision).toBe(0);
    fireEvent.click(within(input.closest('form')!).getByRole('button',{name:'Review Opening cash reserve ($)'}));expect(input).toHaveFocus();
    setField(root,'Opening cash reserve ($)','12.34');expect(input).not.toHaveAttribute('aria-invalid');expect(input).toHaveFocus();
  });
  it('keeps a boolean Unknown/No/Yes/Unknown exact in drafts and saved data',async()=>{
    const {root,controller}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});const label='Additional income outside these records';
    for(const [value,want]of [['unknown',{known:false}],['false',{known:true,value:false}],['true',{known:true,value:true}],['unknown',{known:false}]] as const){
      setField(root,label,value);expect((controller.getDraft('household','household').value.household as any).coverageAnswers.additionalIncome).toEqual(want);
      expect(within(root).getByLabelText(label)).not.toHaveAttribute('aria-invalid');await applyEdit(root);expect(controller.getState().savedPlan.household.coverageAnswers.additionalIncome).toEqual(want);
    }
  });
  it('preserves contextual input focus and selection when another record is added',async()=>{
    const {root,controller}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Filer 1 name','Draft filer name');
    const input=within(root).getByLabelText('Filer 1 name') as HTMLInputElement;input.focus();input.setSelectionRange(2,6);
    controller.beginAdd('salaries');const refreshed=within(root).getByLabelText('Filer 1 name') as HTMLInputElement;
    expect(refreshed).toHaveFocus();expect(refreshed).toHaveValue('Draft filer name');expect([refreshed.selectionStart,refreshed.selectionEnd]).toEqual([2,6]);
  });
  it('starts a newly confirmed date empty and restores entered dates after reversing Unknown',async()=>{
    const base=makePlan(),source=makePlan({household:{...base.household,filers:[{...base.household.filers[0]!,birthDate:{known:false}},base.household.filers[1]!]}});
    const {root,controller}=mountWorkspace(source);openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Filer 1 birth date history','known');
    expect((controller.getDraft('household','household').value.household as any).filers[0].birthDate).toEqual({known:true,value:''});
    expect(within(root).getByLabelText('Filer 1 birth date value')).toHaveValue('');
    setField(root,'Filer 1 birth date value','1985-03-14');setField(root,'Filer 1 birth date history','unknown');
    expect((controller.getDraft('household','household').value.household as any).filers[0].birthDate).toEqual({known:false});
    setField(root,'Filer 1 birth date history','known');expect(within(root).getByLabelText('Filer 1 birth date value')).toHaveValue('1985-03-14');
    expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('keeps help outside the label while preserving a contextual accessible name and selection',async()=>{
    const {root,context:ui}=mountPresentation();let draft:RecordDraft={recordId:'debt',section:'debts',value:{name:'abc'}};
    const context:FieldContext={get draft(){return draft;},issues:[],ui,onChange(_path,value){draft={...draft,value:{name:value}};},refresh(){}};
    const input=renderField(root,context,['name'],'Debt name',{visibleLabel:'name',help:'Name this debt for later review.'});
    expect(input).toHaveAccessibleName('Debt name');expect(root.querySelector('label')).toHaveTextContent('name');expect(root.querySelector('label button')).toBeNull();fireEvent.click(within(root).getByRole('button',{name:/About name/}));expect(document.querySelector('[data-disclosure-panel]')).toHaveTextContent('Name this debt');
  });
});
describe('feedback in entered units',()=>{
  it('uses actual growth/APR validation bounds as percentages while retaining domain corrections',async()=>{
    const plan=makePlan({accounts:[{id:'account-a',name:'Account',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:-10000,openingIraBasis:{known:false}}],debts:[{id:'debt-a',name:'Debt',openingBalanceCents:0,aprBps:-1,monthlyPaymentCents:0,firstPaymentMonth:'2026-01'}]});
    const result=validatePlan(plan);expect(result.ok).toBe(false);
    const growth=result.issues.find(i=>i.recordId==='account-a'&&i.field==='annualGrowthBps')!;const apr=result.issues.find(i=>i.recordId==='debt-a'&&i.field==='aprBps')!;
    const account:RecordDraft={recordId:'account-a',section:'accounts',value:toDraftValue(plan.accounts[0])},debt:RecordDraft={recordId:'debt-a',section:'debts',value:toDraftValue(plan.debts[0])};
    expect(formatFieldIssue(growth,account)).toContain('-99.99%');expect(formatFieldIssue(growth,account)).toContain('1,000%');expect(formatFieldIssue(apr,debt)).toContain('0%');
    const propertyPlan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;const invalid={...propertyPlan,properties:propertyPlan.properties.map(p=>({...p,downPaymentCents:p.purchasePriceCents+1}))};
    const issues=validatePlan(invalid).issues;const issue=issues.find(i=>i.field==='downPaymentCents')!;
    expect(formatFieldIssue(issue,{recordId:'home',section:'properties',value:toDraftValue({property:invalid.properties[0],rentals:[],expenses:[]})})).toBe('Down payment cannot exceed purchase price.');
  });
  it('distinguishes empty amounts, decimals and whole numbers while retaining unknown fallback diagnostics',async()=>{
    const draft:RecordDraft={recordId:'debt',section:'debts',value:{openingBalanceCents:'',aprBps:'1.234',termMonths:'1.5'}};
    expect(formatFieldIssue({...problem('debt','openingBalanceCents'),explanation:'Enter money as an ordinary decimal with at most two decimal places; blank is unknown.'},draft)).toBe('Enter an amount; use 0 only if confirmed.');
    expect(formatFieldIssue({...problem('debt','aprBps'),explanation:'Enter rate as an ordinary decimal with at most two decimal places; blank is unknown.'},draft)).toBe('Use up to 2 decimal places, without commas.');
    expect(formatFieldIssue({...problem('debt','termMonths'),explanation:'Enter a whole number; a blank value is unknown, not zero.'},draft)).toBe('Enter a whole number.');
    expect(formatFieldIssue({...problem('debt','other'),explanation:'Custom correction 38'},draft)).toBe('Custom correction 38');
  });
});

import {createEditorViewSession} from '../../src/browser/scenario-session';
import {setFormTaskIssues,syncFormFeedback} from '../../src/browser/form-feedback';
import {renderHouseholdForm} from '../../src/browser/forms/household';
it('rebuilds task feedback for the same record from its owning session',async()=>{
 const {root,context}=mountPresentation(),plan=makePlan(),view=createEditorViewSession(plan),controller=createWorkspace(plan,{getItem:()=>null,setItem(){}}),ui={...context,editorView:view,readState:controller.getState};
 renderHouseholdForm(root,controller,ui);setFormTaskIssues(root.querySelector('form')!,[problem('household','openingCashCents')],view);renderHouseholdForm(root,controller,ui);syncFormFeedback(root,controller,ui);expect(within(root).getByLabelText('Opening cash reserve ($)')).toHaveAttribute('aria-invalid','true');
 renderHouseholdForm(root,controller,{...ui,editorView:createEditorViewSession(plan)});syncFormFeedback(root,controller,{...ui,editorView:createEditorViewSession(plan)});expect(within(root).getByLabelText('Opening cash reserve ($)')).not.toHaveAttribute('aria-invalid');
});
