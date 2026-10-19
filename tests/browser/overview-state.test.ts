import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet,type PlanDocument} from '../../src/engine';
import {createEditorViewSession} from '../../src/browser/scenario-session';
import {withProducingPlan,resolveIssueTargets} from '../../src/browser/issue-presentation';
import type {ReportSnapshot} from '../../src/browser/report-snapshot';
import {mountOverview} from '../../src/browser/views/overview';
import {renderProjection} from '../../src/browser/views/projection';
import {mountPresentation} from '../helpers/presentation';
import {makePlan,mustValidate} from '../helpers/plans';

const plan=(name='Applied account')=>makePlan({horizonYears:2,accounts:[{id:'account',name,ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}]});
function snapshot(document:PlanDocument,base?:PlanDocument):ReportSnapshot{return {plan:document,projection:calculateProjection(mustValidate(document),loadRuleSet()),comparison:base?{plan:base,projection:calculateProjection(mustValidate(base),loadRuleSet())}:null,status:base?'preview':'applied',label:base?'Preview':'Applied',allowDeltas:!!base};}
const cleanups:(()=>void)[]=[];afterEach(()=>{cleanups.splice(0).forEach(dispose=>dispose());document.body.replaceChildren();});

describe('mounted producing-plan overview',()=>{
 it('updates selected-year totals from chart keyboard input without replacing the focused chart',()=>{
  const applied=plan(),{root,context}=mountPresentation(applied),view=createEditorViewSession(applied),binding=mountOverview(root,snapshot(applied),context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  fireEvent.click(within(root).getByText('Forecast charts',{selector:'summary'}));
  const chart=within(root).getByRole('img',{name:'Net worth over time'});chart.focus();fireEvent.keyDown(chart,{key:'ArrowRight'});
  expect(within(root).getByLabelText('Forecast year')).toHaveValue('2027');expect(root.querySelector('.overview-totals')).toHaveTextContent('Net worth · 2027');expect(chart).toHaveFocus();expect(chart.isConnected).toBe(true);
 });
 it('defers diagnostic tables and preserves amounts during a status-only update',()=>{
  const applied=plan(),report=snapshot(applied),{root,context}=mountPresentation(applied),binding=mountOverview(root,report,context,createEditorViewSession(applied));cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  expect(root.querySelector('[data-testid="annual-2026-net-worth"]')).toBeNull();const amount=within(root).getByTestId('balance-2026-reserve').firstChild;binding.update({...report,status:'updating',label:'Updating · applied results'});expect(within(root).getByTestId('balance-2026-reserve').firstChild).toBe(amount);fireEvent.click(within(root).getByText('Forecast details',{selector:'summary'}));expect(root.querySelector('[data-testid="annual-2026-net-worth"]')).not.toBeNull();
 });
 it('retains an open issue while its cause remains and removes obsolete actions on resolution',()=>{
  const base=makePlan(),unknown=makePlan({household:{...base.household,coverageAnswers:{...base.household.coverageAnswers,additionalIncome:{known:false}}}}),{root,context,reviews}=mountPresentation(unknown),view=createEditorViewSession(unknown),binding=mountOverview(root,snapshot(unknown),context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  fireEvent.click(within(within(root).getByTestId('balance-2026-reserve')).getByRole('button'));
  const panel=within(document.body).getByRole('region',{name:'Cash balance · 2026'}),oldReview=within(panel).getByRole('button',{name:'Review Household'});
  binding.update(snapshot({...unknown,revision:1,openingCashCents:10000},unknown));expect(panel).toBeVisible();expect(panel).toHaveTextContent('Additional income outside these records');
  const input=document.createElement('input');document.body.append(input);input.focus();binding.update(snapshot({...base,revision:1},unknown));expect(panel).not.toBeVisible();expect(input).toHaveFocus();fireEvent.click(oldReview);expect(reviews).toEqual([]);
 });
 it('keeps producing labels, open months, selected year, table scroll and editor focus during updates',()=>{
  const applied=plan(),{root,context}=mountPresentation(applied),view=createEditorViewSession(applied);
  const activeInput=document.createElement('input');document.body.append(activeInput);
  const binding=mountOverview(root,snapshot(applied),context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  const tableScroll=within(root).getByRole('region',{name:'Annual balance sheet, horizontally scrollable'});tableScroll.scrollLeft=160;
  fireEvent.click(within(root).getByText('Forecast details',{selector:'summary'}));const monthToggle=within(root).getByRole('button',{name:'Show months for 2026'});fireEvent.click(monthToggle);
  const assets=within(root).getByText('Asset and loan balances · 2026',{selector:'summary'}).parentElement as HTMLDetailsElement;assets.open=true;
  fireEvent.change(within(root).getByLabelText('Forecast year'),{target:{value:'2027'}});activeInput.focus();
  binding.update(snapshot({...plan('Renamed candidate account'),revision:1},applied));
  expect(root).toHaveTextContent('Renamed candidate account');expect(root).not.toHaveTextContent('Applied account');expect(monthToggle.isConnected).toBe(true);expect(monthToggle).toHaveAttribute('aria-expanded','true');expect(assets.isConnected).toBe(true);expect(assets.open).toBe(true);expect(tableScroll.scrollLeft).toBe(160);expect(activeInput).toHaveFocus();expect(within(root).getByLabelText('Forecast year')).toHaveValue('2027');
  expect(within(root).getByRole('table',{name:'Annual balance sheet'}).querySelectorAll('thead th')).toHaveLength(6);
 });
 it('switches to financial definitions and closes details removed by changed forecast bounds',()=>{
  const applied=plan(),{root,context}=mountPresentation(applied),view=createEditorViewSession(applied),binding=mountOverview(root,snapshot(applied),context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  fireEvent.click(within(root).getByText('Forecast details',{selector:'summary'}));fireEvent.click(within(root).getByRole('button',{name:'Show months for 2027'}));fireEvent.change(within(root).getByLabelText('Table view'),{target:{value:'financial-overview'}});
  expect(within(root).getByRole('table',{name:'Annual financial overview'}).querySelectorAll('thead th')).toHaveLength(7);expect(root).toHaveTextContent('Investment contributions are savings');
  binding.update(snapshot({...applied,horizonYears:1,revision:1},applied));expect(within(root).queryByRole('button',{name:'Hide months for 2027'})).toBeNull();expect(view.reportState.expanded.has('year:2027:months')).toBe(false);
 });
 it('labels debt increases without a beneficial-gain cue and labels candidate-only years',()=>{
  const applied=makePlan(),candidate=makePlan({horizonYears:2,debts:[{id:'debt',name:'Debt',openingBalanceCents:10000,aprBps:0,monthlyPaymentCents:0,firstPaymentMonth:'2026-01'}]}),{root,context}=mountPresentation(applied),view=createEditorViewSession(candidate),binding=mountOverview(root,snapshot(candidate,applied),context,view);cleanups.push(binding.dispose,()=>context.disclosures.dispose());
  const debt=within(root).getByTestId('balance-2026-debt');expect(debt).toHaveTextContent('Debt increasing');expect(debt).not.toHaveClass('cash-flow-positive');expect(root).toHaveTextContent('No applied comparison');expect(within(root).getByTestId('balance-2026-property')).toHaveTextContent('$0.00');
 });
 it('routes candidate-only records and labels from the producing plan without replacing editor state',()=>{
  const applied=makePlan(),candidate=plan('Candidate only'),{root,context}=mountPresentation(applied),producing=withProducingPlan(context,candidate);
  cleanups.push(()=>context.disclosures.dispose());renderProjection(root,snapshot(candidate).projection,producing);
  expect(root).toHaveTextContent('Candidate only');expect(context.readState().savedPlan).toBe(applied);
  expect(resolveIssueTargets({code:'required-history',recordId:'account',field:'openingBalanceCents',severity:'warning',explanation:'Missing',resolution:'Review'},context.readState(),candidate)).toEqual([{section:'Investments',recordId:'account',field:'openingBalanceCents',label:'Review Candidate only'}]);
 });
});
