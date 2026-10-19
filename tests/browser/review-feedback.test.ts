import {describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import type {PlanDocument,ProjectionResult} from '../../src/engine';
import {resolveIssueTargets} from '../../src/browser/issue-presentation';
import {reviewTarget} from '../../src/browser/navigation';
import {setAt,valueAt} from '../../src/browser/fields';
import {mountWorkspace,setField} from '../helpers/dom';
import {makePlan} from '../helpers/plans';
import {makeAduPlan} from '../helpers/adu';
import {loadReferences} from '../helpers/references';

const fixture=()=>loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;
const formFor=(root:HTMLElement,id:string)=>[...root.querySelectorAll<HTMLFormElement>('form[data-record-id]')].find(form=>form.dataset.recordId===id)!;
const fieldFor=(form:HTMLElement,path:string)=>[...form.querySelectorAll<HTMLElement>('[data-field]')].find(control=>control.dataset.field===path)!;

describe('actionable review and recovery paths',()=>{
  it('reviews an unconfirmed ADU paid-tax year at its current draft row',()=>{
    const source=makeAduPlan().properties[0]!.aduProject!;
    const plan=makeAduPlan({},{propertyTax:{...source.propertyTax,paymentYears:source.propertyTax.paymentYears.map(row=>row.year===2027?{...row,complete:{known:false}}:row)}});
    const {root,controller}=mountWorkspace(plan),issue=controller.getState().projection.issues.find(issue=>issue.code==='required-adu-tax-payments'&&issue.year===2027)!;
    const draft=controller.getDraft('properties','home'),path=['property','aduProject','propertyTax','paymentYears'],years=valueAt(draft.value,path) as readonly unknown[];
    controller.editDraft('home',{...draft,value:setAt(draft.value,path,[years[1],years[2],years[0]])});controller.beginAdd('salaries');
    const target=resolveIssueTargets(issue,controller.getState())[0]!;reviewTarget(root,target);
    const control=fieldFor(formFor(root,'home'),'property.aduProject.propertyTax.paymentYears.0.complete');
    expect(control).toHaveFocus();expect(control).toBeVisible();expect(control).toHaveValue('unknown');expect(fieldFor(formFor(root,'home'),'property.aduProject.propertyTax.paymentYears.0.year')).toHaveValue('2027');expect(root.querySelector('[data-section="Properties"]')).toBeVisible();
  });

  it('opens the paid-tax controls when the required ADU year is absent from the draft',()=>{
    const source=makeAduPlan().properties[0]!.aduProject!;
    const plan=makeAduPlan({},{propertyTax:{...source.propertyTax,paymentYears:source.propertyTax.paymentYears.filter(row=>row.year!==2027)}});
    const {root,controller}=mountWorkspace(plan),issue=controller.getState().projection.issues.find(issue=>issue.code==='required-adu-tax-payments'&&issue.year===2027)!;
    const target=resolveIssueTargets(issue,controller.getState())[0]!;reviewTarget(root,target);
    const add=within(formFor(root,'home')).getByRole('button',{name:'Add paid-tax year'});
    expect(add).toBeVisible();expect(document.activeElement?.contains(add)||document.activeElement===add).toBe(true);
    fireEvent.click(add);expect(within(formFor(root,'home')).getAllByLabelText('Paid-tax calendar year')).toHaveLength(3);
  });

  it('shows a rejected salary removal beside its action and opens the dependent contribution',()=>{
    const plan=fixture(),{root,controller}=mountWorkspace(plan),salary=plan.salaries[0]!;
    fireEvent.click(within(root.querySelector('nav')!).getByRole('button',{name:'Income'}));
    const form=formFor(root,salary.id);
    fireEvent.click(within(form).getByRole('button',{name:`Remove ${salary.name}`}));
    expect(controller.getState().savedPlan).toEqual(plan);
    const feedback=form.querySelector<HTMLElement>('[data-operation-feedback]');
    expect(feedback).not.toBeNull();expect(feedback).toBeVisible();expect(feedback).toHaveTextContent('sponsoring');
    fireEvent.click(within(feedback!).getByRole('button',{name:/Review .*contribution/}));
    const contribution=plan.contributions.find(row=>row.sponsoringSalaryId===salary.id)!;
    expect(fieldFor(formFor(root,contribution.id),'sponsoringSalaryId')).toHaveFocus();
    expect(root.querySelector('[data-section="Investments"]')).toBeVisible();
  });

  it('reviews effective annual workplace coverage rather than the known baseline',()=>{
    const plan=makePlan(),changed:PlanDocument={...plan,household:{...plan.household,filers:[{...plan.household.filers[0],coverageByYear:[{year:2026,workplaceCoverage:{known:false}}]},plan.household.filers[1]]}};
    const {root,controller}=mountWorkspace(changed),issue=controller.getState().projection.coverage.issues.find(issue=>issue.field==='workplaceCoverage')!;
    expect(issue).toBeDefined();const target=resolveIssueTargets(issue,controller.getState())[0]!;
    reviewTarget(root,target);
    expect(fieldFor(formFor(root,'household'),'household.filers.0.coverageByYear.0.workplaceCoverage')).toHaveFocus();
    const spouses=resolveIssueTargets({...issue,code:'required-workplace-coverage'},controller.getState());
    expect(spouses.map(target=>target.field)).toEqual(['household.filers.0.coverageByYear.0.workplaceCoverage','household.filers.1.workplaceCoverage']);
  });

  it('reviews the employer group when a filer warning cannot identify the employer',()=>{
    const base=fixture(),owner=base.household.filers[0],salary=base.salaries.find(row=>row.ownerId===owner.id)!,rule=base.contributions.find(row=>row.sponsoringSalaryId===salary.id)!;
    const otherSalary={...salary,id:'second-salary',employerId:'second-employer',name:'Second employer'};
    const known={known:true as const,value:true};
    const plan:PlanDocument={...base,salaries:[...base.salaries,otherSalary],contributions:[...base.contributions,{...rule,id:'second-contribution',sponsoringSalaryId:otherSalary.id}],household:{...base.household,filers:[{...owner,birthDate:{known:true,value:'1970-01-01'},employerAssumptionsByYear:[{year:2026,employerId:salary.employerId,priorYearWagesCents:{known:true,value:0},planCatchUpAvailable:known,rothCatchUpAvailable:known},{year:2026,employerId:otherSalary.employerId,priorYearWagesCents:{known:false},planCatchUpAvailable:known,rothCatchUpAvailable:known}]},base.household.filers[1]]}};
    const {root,controller}=mountWorkspace(plan),issue=controller.getState().projection.coverage.issues.find(issue=>issue.recordId===owner.id&&issue.field==='employerAssumptionsByYear.priorYearWagesCents')!;
    expect(issue).toBeDefined();const target=resolveIssueTargets(issue,controller.getState())[0]!;
    expect(target.field).toBe('household.filers.0.employerAssumptionsByYear');reviewTarget(root,target);
    expect(document.activeElement).toHaveAttribute('data-field-group',target.field);
    const specific=resolveIssueTargets({...issue,recordId:'second-contribution'},controller.getState())[0]!;
    expect(specific.field).toBe('household.filers.0.employerAssumptionsByYear.1.priorYearWagesCents');
  });

  it('associates an absent sponsoring salary property with its visible required control',()=>{
    const plan=fixture(),{root,controller}=mountWorkspace(plan),account=plan.accounts.find(row=>row.type==='traditional-401k')!;
    fireEvent.click(within(root.querySelector('nav')!).getByRole('button',{name:'Investments'}));
    const id=controller.beginAdd('contributions');const form=formFor(root,id);setField(form,'Contribution account',account.id);
    const control=fieldFor(form,'sponsoringSalaryId');expect(controller.getDraft('contributions',id).value).not.toHaveProperty('sponsoringSalaryId');
    fireEvent.click(within(form).getByRole('button',{name:'Save contribution'}));
    expect(control).toHaveAttribute('aria-invalid','true');expect(control).toHaveAccessibleDescription(/nonempty string/);
    fireEvent.click(within(form).getByRole('button',{name:'Review Sponsoring salary'}));expect(control).toHaveFocus();
    expect(controller.getState().savedPlan.revision).toBe(plan.revision);
  });

  it('associates loss reconciliation with its group while keeping a valid loss year valid',()=>{
    const plan=fixture(),{root,controller}=mountWorkspace(plan);fireEvent.click(within(root.querySelector('nav')!).getByRole('button',{name:'Properties'}));
    const draft=controller.getDraft('properties','home'),path=['rentals',0,'taxHistory','federal','value','lossVintages'] as const;
    controller.editDraft('home',{...draft,value:setAt(draft.value,path,[{year:'2025',source:'passive',amountCents:'50.00',activeParticipation:{known:false},qbiQualification:{known:false}}])});
    // Adding a record rebuilds the forms with this retained structural draft.
    controller.beginAdd('salaries');const form=formFor(root,'home'),year=fieldFor(form,[...path,0,'year'].join('.'));
    fireEvent.click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(controller.getState().issues.some(issue=>issue.field?.endsWith('.lossVintages'))).toBe(true);
    expect(year).not.toHaveAttribute('aria-invalid');
    const group=[...form.querySelectorAll<HTMLElement>('[data-field-group]')].find(node=>node.dataset.fieldGroup===path.join('.'))!;
    expect(group).toHaveAttribute('aria-invalid','true');expect(group).toHaveAccessibleDescription(/reconcile/);
    fireEvent.click(within(form.querySelector<HTMLElement>('[data-form-feedback]')!).getByRole('button',{name:'Review Rental loss history'}));expect(group).toHaveFocus();
    for(let node:HTMLElement|null=group;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)expect(node.open).toBe(true);
  });

  it('retries persistence from unchanged salary Save after a quota failure',()=>{
    let unavailable=true;const writes=vi.fn((_key:string,_value:string)=>{if(unavailable)throw new Error('quota');});
    const plan=fixture(),{root,controller}=mountWorkspace(plan,{getItem:()=>null,setItem:writes}),salary=plan.salaries[0]!;
    fireEvent.click(within(root.querySelector('nav')!).getByRole('button',{name:'Income'}));
    setField(formFor(root,salary.id),'Salary name','Applied salary');fireEvent.click(within(formFor(root,salary.id)).getByRole('button',{name:'Save salary'}));
    expect(controller.getState().persisted).toBe(false);expect(controller.getState().drafts[salary.id]).toBeUndefined();
    const revision=controller.getState().savedPlan.revision;
    unavailable=false;fireEvent.click(within(formFor(root,salary.id)).getByRole('button',{name:'Save salary'}));
    expect(writes).toHaveBeenCalledTimes(2);expect(controller.getState().persisted).toBe(true);expect(controller.getState().savedPlan.revision).toBe(revision);
    expect(within(root).getByTestId('persistence-warning')).not.toBeVisible();expect(within(root).getByTestId('save-announcement')).toHaveTextContent('Inputs applied');
  });
});
