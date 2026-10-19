import {afterEach,describe,expect,it} from 'vitest';
import {renderAduComparison} from '../../src/browser/views/adu-comparison';
import {renderProjection} from '../../src/browser/views/projection';
import {resolveIssueTargets} from '../../src/browser/issue-presentation';
import {calculateAduBuildComparison,calculateProjection,loadRuleSet} from '../../src/engine';
import {makeAduPlan,aduValue} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';
import {mountPresentation} from '../helpers/presentation';
import {appendCoverage} from '../../src/browser/views/issues';
afterEach(()=>document.body.replaceChildren());
describe('ADU financial reporting',()=>{
 it('shows brokerage construction sales, tax reserve and remaining basis separately from income',()=>{
  const plan=mustValidate(makeAduPlan({openingCashCents:0,accounts:[{id:'brokerage',name:'Standard brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:50_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:50_000_000}}]},{ownerFunding:{kind:'taxable-brokerage',accountId:'brokerage'}}));
  const {root,context}=mountPresentation(plan);renderProjection(root,calculateProjection(plan,loadRuleSet()),context);
  expect(root.querySelector('[data-testid="annual-2027-brokerage-gross-sales"]')).toHaveTextContent('$300,000.00');
  expect(root.querySelector('[data-testid="annual-2027-brokerage-sale-tax"]')).toHaveTextContent('$0.00');
  expect(root.querySelector('[data-testid="annual-2027-brokerage-construction-funded"]')).toHaveTextContent('$300,000.00');
  expect(root.querySelector('[data-testid="annual-2027-account-brokerage-basis"]')).toHaveTextContent('$200,000.00');
  expect(root).toHaveTextContent('Household tax estimate');expect(root).toHaveTextContent(/sale proceeds.*transfer/i);
 });
 it('explains deferred automatic deposits beside the construction funding amounts',()=>{
  const plan=mustValidate(makeAduPlan({accounts:[{id:'brokerage',name:'Build savings',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:50_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:50_000_000}}]},{ownerFunding:{kind:'taxable-brokerage',accountId:'brokerage'}}));
  const projection=calculateProjection(plan,loadRuleSet()),{root,context}=mountPresentation(plan);
  const explanation='Automatic deposits to Build savings are held in cash until the July 2027 construction sale, then resume at month end.';
  renderProjection(root,{...projection,issues:[...projection.issues,{code:'brokerage-funding-deposit-timing',recordId:'adu-project',year:2027,field:'ownerFunding',severity:'info',explanation,resolution:'Review funding.'}]},context);
  const funding=[...root.querySelectorAll('section')].find(section=>section.querySelector('h3')?.textContent==='ADU investment funding · forecast total')!;
  expect(funding).toHaveTextContent(explanation);
  expect(funding).not.toHaveTextContent('Needs data');
 });
 it('labels the automatic-deposit timing convention as an estimate',()=>{
  const root=document.createElement('div');document.body.append(root);
  appendCoverage(root,{completeForModeledScope:true,completeHouseholdLiability:false,issues:[{code:'brokerage-funding-deposit-timing',severity:'info',explanation:'Automatic deposit timing estimate',resolution:'Review'}]});
  expect(root).toHaveTextContent('Household tax estimate');expect(root).not.toHaveTextContent('Household tax incomplete');
 });
 it('labels incomplete brokerage funding totals as covering available periods only',()=>{
  const plan=mustValidate(makeAduPlan()),projection=calculateProjection(plan,loadRuleSet()),{root,context}=mountPresentation(plan);
  const issue={code:'brokerage-funding-cycle',year:2028,field:'ownerFunding',severity:'warning' as const,explanation:'Funding could not be estimated.',resolution:'Review funding.'};
  renderProjection(root,{...projection,months:projection.months.map((m,i)=>i===projection.months.length-1?{...m,brokerageFunding:{sales:[],issues:[issue]}}:m)},context);
  expect(root).toHaveTextContent('ADU investment funding · available periods only');
  expect(root).toHaveTextContent(/funding could not be estimated for every construction period/i);
  expect(root).not.toHaveTextContent('ADU investment funding · forecast total');
 });
 it('keeps unrelated incomplete household liability visible beside ADU estimates',()=>{
  const root=document.createElement('div');document.body.append(root);
  appendCoverage(root,{completeForModeledScope:true,completeHouseholdLiability:false,issues:[
   {code:'adu-planning-estimate',severity:'info',explanation:'ADU assumptions',resolution:'Review'},
   {code:'omitted-distributions',severity:'warning',explanation:'Retirement distributions omitted',resolution:'Model separately'},
  ]});
  expect(root).toHaveTextContent('Household tax incomplete');expect(root).toHaveTextContent('ADU planning estimates');
 });
 it('shows annual movement differences and December balances with partial returns',()=>{const plan=mustValidate(makeAduPlan()),comparison=aduValue(calculateAduBuildComparison(plan,loadRuleSet(),'adu-project')),{root,context}=mountPresentation(plan);renderAduComparison(root,comparison,context,2027);expect(root.querySelector('[data-testid="adu-comparison-constructionCostCents"]')).toHaveTextContent('$300,000.00');expect(root.querySelector('[data-testid="adu-comparison-netWorthCents"]')).toHaveTextContent('-$80,000.00');expect(root).toHaveTextContent('Partial operating year');expect(root).toHaveTextContent('Household tax change');expect(root).toHaveTextContent('Investment contribution change');expect(root).toHaveTextContent('Not reached within forecast');});
 it('shows known original-home value, separate completion addition and restricted funding',()=>{const plan=mustValidate(makeAduPlan()),{root,context}=mountPresentation(plan);renderProjection(root,calculateProjection(plan,loadRuleSet()),context);expect(root).toHaveTextContent('Known original-home value');expect(root).toHaveTextContent('Completion value added');expect(root).toHaveTextContent('Restricted construction cash');expect(root).toHaveTextContent('Unrestricted cash');expect(root).toHaveTextContent('Cash available from income for investment allocation');expect(root).toHaveTextContent('Declared ADU draws fund their attributed stages');expect(root.querySelector('[data-testid="annual-2027-adu-completion-value"]')).toHaveTextContent('$220,000.00');});
 it('routes a reindexed nested stage and owned expense into its property bundle',()=>{const plan=makeAduPlan({expenses:[{id:'owned',name:'ADU costs',propertyId:'home',rentalId:'new-adu',amountCents:100,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'rental',taxCategory:'operating'}]}),state={savedPlan:plan,drafts:{}};expect(resolveIssueTargets({code:'invalid-input',recordId:'building-stage',field:'amountCents',severity:'error',explanation:'Bad stage',resolution:'Correct'},state)).toEqual([expect.objectContaining({section:'Properties',recordId:'home',field:'property.aduProject.costs.0.amountCents'})]);expect(resolveIssueTargets({code:'invalid-input',recordId:'owned',field:'amountCents',severity:'error',explanation:'Bad cost',resolution:'Correct'},state)[0]).toMatchObject({section:'Properties',recordId:'home',field:'expenses.0.amountCents'});});
 it('resolves project-emitted treatment issues to the current stage index',()=>{const plan=makeAduPlan(),state={savedPlan:plan,drafts:{}};expect(resolveIssueTargets({code:'required-adu-tax-treatment',recordId:'adu-project',field:'costs.building-stage.treatments.federal',severity:'warning',explanation:'Unanswered treatment',resolution:'Confirm'},state)[0]).toMatchObject({recordId:'home',field:'property.aduProject.costs.0.treatments.federal'});});

});
