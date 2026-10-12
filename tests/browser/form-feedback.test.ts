import {describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import type {Issue,PlanDocument,ProjectionResult} from '../../src/engine';
import {resolveFormIssues,revealField} from '../../src/browser/form-feedback';
import {createWorkspace,toDraftValue,type RecordDraft} from '../../src/browser/state';
import {renderField,type FieldContext} from '../../src/browser/fields';
import {mountWorkspace,setField} from '../helpers/dom';
import {mountPresentation} from '../helpers/presentation';
import {makePlan} from '../helpers/plans';
import {loadReferences} from '../helpers/references';
const problem=(recordId:string,field:string):Issue=>({recordId,field,code:'invalid-input',severity:'error',explanation:'Invalid input',resolution:'Correct this input.'});
describe('draft-relative feedback',()=>{
  it('resolves nested records and bracket paths without matching another record’s identical leaf',()=>{
    const plan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;
    const controller=createWorkspace(plan,{getItem:()=>null,setItem:()=>{}}),draft=controller.getDraft('properties','home');
    const issues=[problem('home','rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents'),problem(plan.rentals[0]!.id,'loanAllocations[0].share'),problem(plan.properties[0]!.loans[0]!.id,'aprBps'),problem(plan.expenses[0]!.id,'amountCents'),problem('home','unknownAggregate'),problem('different','aprBps')];
    const resolved=resolveFormIssues(draft,plan.id,issues);
    expect(resolved).toHaveLength(5);
    expect(resolved[0]?.path).toEqual(['rentals',0,'taxHistory','federal-amt','value','adjustedBuildingBasisCents']);
    expect(resolved[1]).toMatchObject({path:['rentals',0,'loanAllocations',0,'share'],scope:'group'});
    expect(resolved[2]?.path).toEqual(['property','loans',0,'aprBps']);expect(resolved[3]?.path).toEqual(['expenses',0,'amountCents']);expect(resolved[4]?.scope).toBe('record');
  });
  it('resolves filer and plan paths only in the household task',()=>{
    const plan=makePlan(),controller=createWorkspace(plan,{getItem:()=>null,setItem:()=>{}}),draft=controller.getDraft('household','household');
    expect(resolveFormIssues(draft,plan.id,[problem('owner-b','birthDate'),problem(plan.id,'startYear')]).map(i=>i.path)).toEqual([['household','filers',1,'birthDate'],['startYear']]);
  });
  it('shows failed-save feedback without replacing or applying the draft input and clears it on editing',()=>{
    const {root,controller}=mountWorkspace(makePlan()),input=within(root).getByLabelText('Opening cash reserve ($)');
    setField(root,'Opening cash reserve ($)','1.234');fireEvent.click(within(root).getByRole('button',{name:'Save household'}));
    expect(within(root).getByLabelText('Opening cash reserve ($)')).toBe(input);expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');expect(input).toHaveAccessibleDescription(/up to 2 decimal places/);
    expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().projection.inputRevision).toBe(0);
    fireEvent.click(within(input.closest('form')!).getByRole('button',{name:'Review Opening cash reserve ($)'}));expect(input).toHaveFocus();
    setField(root,'Opening cash reserve ($)','12.34');expect(input).not.toHaveAttribute('aria-invalid');expect(input).toHaveFocus();
  });
  it('keeps a boolean Unknown/No/Yes/Unknown exact in drafts and saved data',()=>{
    const {root,controller}=mountWorkspace(makePlan());const label='Additional income outside these records';
    for(const [value,want]of [['unknown',{known:false}],['false',{known:true,value:false}],['true',{known:true,value:true}],['unknown',{known:false}]] as const){
      setField(root,label,value);expect((controller.getDraft('household','household').value.household as any).coverageAnswers.additionalIncome).toEqual(want);
      expect(within(root).getByLabelText(label)).not.toHaveAttribute('aria-invalid');fireEvent.click(within(root).getByRole('button',{name:'Save household'}));expect(controller.getState().savedPlan.household.coverageAnswers.additionalIncome).toEqual(want);
    }
  });
  it('preserves contextual input focus and selection when another record is added',()=>{
    const {root,controller}=mountWorkspace(makePlan());setField(root,'Filer 1 name','Draft filer name');
    const input=within(root).getByLabelText('Filer 1 name') as HTMLInputElement;input.focus();input.setSelectionRange(2,6);
    controller.beginAdd('salaries');const refreshed=within(root).getByLabelText('Filer 1 name') as HTMLInputElement;
    expect(refreshed).toHaveFocus();expect(refreshed).toHaveValue('Draft filer name');expect([refreshed.selectionStart,refreshed.selectionEnd]).toEqual([2,6]);
  });
  it('creates an empty known date value and retains text selection during row refresh',()=>{
    const {root,controller}=mountWorkspace(makePlan());setField(root,'Filer 1 birth date history','unknown');setField(root,'Filer 1 birth date history','known');
    expect((controller.getDraft('household','household').value.household as any).filers[0].birthDate).toEqual({known:true,value:''});
    expect(within(root).getByLabelText('Filer 1 birth date value')).toHaveValue('');
  });
  it('keeps help outside the label while preserving a contextual accessible name and selection',()=>{
    const {root,context:ui}=mountPresentation();let draft:RecordDraft={recordId:'debt',section:'debts',value:{name:'abc'}};
    const context:FieldContext={get draft(){return draft;},issues:[],ui,onChange(_path,value){draft={...draft,value:{name:value}};},refresh(){}};
    const input=renderField(root,context,['name'],'Debt name',{visibleLabel:'name',help:'Name this debt for later review.'});
    expect(input).toHaveAccessibleName('Debt name');expect(root.querySelector('label')).toHaveTextContent('name');expect(root.querySelector('label button')).toBeNull();fireEvent.click(within(root).getByRole('button',{name:/About name/}));expect(document.querySelector('[data-disclosure-panel]')).toHaveTextContent('Name this debt');
  });
});
