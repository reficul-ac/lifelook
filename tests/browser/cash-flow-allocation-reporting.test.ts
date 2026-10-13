import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet,type AnnualProjection,type CashFlowAllocationYear,type AccountAllocationFunding,type Issue,type PlanDocument} from '../../src/engine';
import {renderAllocationPie,renderAllocationYears} from '../../src/browser/views/cash-flow-allocation';
import {renderProjection} from '../../src/browser/views/projection';
import {resolveIssueTargets,type IssueViewContext} from '../../src/browser/issue-presentation';
import {mountPresentation} from '../helpers/presentation';
import {makeAllocationPlan,makeAllocationPolicy} from '../helpers/allocations';
import {mustValidate} from '../helpers/plans';

const policy=makeAllocationPolicy({entries:[{id:'stocks-entry',priority:1,destination:{kind:'account',accountId:'brokerage'},amount:{kind:'percent',percentBps:5000}},{id:'ira-entry',priority:2,destination:{kind:'account',accountId:'ira'},amount:{kind:'max-annual'}}],overflow:{id:'excess-entry',destination:{kind:'account',accountId:'ira'}}});
const plan=makeAllocationPlan({cashFlowAllocation:policy});
function account(overrides:Partial<AccountAllocationFunding>={}):AccountAllocationFunding{return {accountId:'brokerage',targetCents:5000,existingCents:1000,percentageCents:3000,maximumCents:0,excessCents:1000,actualCents:5000,shortfallCents:0,share:{status:'available',value:.5},reasons:[],...overrides};}
function report(overrides:Partial<CashFlowAllocationYear>={}):CashFlowAllocationYear{return {year:2026,status:'funded',originalCashFlowCents:10000,accounts:[account(),account({accountId:'ira',targetCents:2500,existingCents:0,percentageCents:0,maximumCents:2000,excessCents:500,actualCents:2500,share:{status:'available',value:.25}})],explicitCashTargetCents:1000,explicitCashCents:1000,explicitCashShortfallCents:0,excessOfferedCents:3000,excessAcceptedCents:1500,excessRetainedCents:1500,retainedCashCents:2500,reasons:[],...overrides};}
const baseYear=calculateProjection(mustValidate(makeAllocationPlan()),loadRuleSet()).years[0]!;
function year(value:CashFlowAllocationYear):AnnualProjection{return {...baseYear,year:value.year,cashFlowAllocation:{status:'available',value}};}
function reason(code:string,field='cashFlowAllocation.overflow.destination'):Issue{return {code,recordId:policy.id,field,year:2026,severity:'warning',explanation:`Cause ${code}`,resolution:'Review the affected facts.'};}
let contexts:IssueViewContext[]=[];
function mount(p:PlanDocument=plan){const result=mountPresentation(p);contexts.push(result.context);return result;}
afterEach(()=>{contexts.forEach(c=>c.disclosures.dispose());contexts=[];document.body.replaceChildren();});

describe('accepted allocation reporting',()=>{
 it.each([{gross:25200000,target:0},{gross:24700000,target:375000}])('discloses a real Roth phaseout maximum of $target cents and routes review to its source',({gross,target})=>{
  const base=makeAllocationPlan(),p=makeAllocationPlan({accounts:[...base.accounts,{...base.accounts[1]!,id:'roth',name:'Roth IRA',type:'roth-ira'}],salaries:[{...base.salaries[0]!,annualGrossCents:gross}],cashFlowAllocation:makeAllocationPolicy({entries:[{id:'roth-max',priority:1,destination:{kind:'account',accountId:'roth'},amount:{kind:'max-annual'}}]})});
  const result=calculateProjection(mustValidate(p),loadRuleSet()).years[0]!.cashFlowAllocation!;
  expect(result.status).toBe('available');if(result.status!=='available')throw new Error('allocation');
  if(target===0)expect(result.value.originalCashFlowCents).toBe(18100700);
  expect(result.value.accounts[0]).toMatchObject({targetCents:target,actualCents:target,shortfallCents:0});
  expect(result.value.accounts[0]!.reasons).toContainEqual(expect.objectContaining({code:'ira-contribution-capped',field:'cashFlowAllocation.entries.0.amount'}));
  const {root,context,reviews}=mount(p);renderAllocationPie(root,result,p,context);
  const row=within(root).getByRole('row',{name:/Roth IRA/});expect(row).toHaveTextContent(target===0?'$0.00':'$3,750.00');
  fireEvent.click(within(row).getByRole('button',{name:/Roth IRA.*funding/}));
  const panel=within(document.body).getByRole('region',{name:/Roth IRA.*2026/});
  expect(panel).toHaveTextContent(/income.eligibility limit/i);expect(panel).toHaveTextContent(target===0?'$0.00':'$3,750.00');
  expect(panel).toHaveTextContent(/computed annual maximum/i);
  fireEvent.click(within(panel).getByRole('button',{name:/Review Allocation.*Roth IRA/}));
  expect(reviews[0]).toMatchObject({section:'Investments',recordId:p.cashFlowAllocation!.id,field:'entries.0.amount'});
  const notes=within(root).getByRole('button',{name:/Allocation notes/});fireEvent.mouseEnter(notes);
  expect(within(document.body).getByRole('tooltip')).toHaveTextContent(/annual maximum/i);
  expect(within(document.body).getByRole('tooltip')).not.toHaveTextContent(/prevented the full target/i);
 });
 it('keeps refused excess distinct from a fully funded maximum at the same account',()=>{
  const {root,context}=mount(),overflow=reason('ira-contribution-capped','cashFlowAllocation.overflow.amount');
  renderAllocationPie(root,{status:'available',value:report({accounts:[account({accountId:'ira',reasons:[overflow]})],reasons:[overflow]})},plan,context);
  expect(within(root).queryByRole('button',{name:/IRA funding/})).toBeNull();
  fireEvent.mouseEnter(within(root).getByRole('button',{name:/Allocation notes/}));
  expect(within(document.body).getByRole('tooltip')).toHaveTextContent(/excess deposit/i);
 });
 it('aggregates components into one amount-derived account slice plus cash',()=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'available',value:report()},plan,context);
  const svg=within(root).getByRole('img',{name:/2026.*allocation/i});
  const slices=svg.querySelectorAll('[data-allocation-slice]');expect(slices).toHaveLength(3);
  expect(slices[0]).toHaveAttribute('data-angle','180');expect(slices[1]).toHaveAttribute('data-angle','90');expect(slices[2]).toHaveAttribute('data-angle','90');
  const table=within(root).getByRole('table');const stocks=within(table).getByRole('row',{name:/Stocks/});
  for(const value of ['$50.00','50%','$10.00','$30.00'])expect(stocks).toHaveTextContent(value);
  expect(within(table).getByRole('row',{name:/Cash \/ savings/})).toHaveTextContent('$25.00');
 });
 it('uses cent amounts for angles when independently rounded share labels sum to 99.99%',()=>{
  const {root,context}=mount();const r=report({originalCashFlowCents:3,accounts:[account({actualCents:1,share:{status:'available',value:.3333}}),account({accountId:'ira',actualCents:1,share:{status:'available',value:.3333}})],retainedCashCents:1});renderAllocationPie(root,{status:'available',value:r},plan,context);
  const angles=[...root.querySelectorAll('[data-angle]')].map(n=>Number(n.getAttribute('data-angle')));expect(angles).toEqual([120,120,120]);expect(root).toHaveTextContent('$0.01');
 });
 it('reports legacy over-target funding as actual dollars without inventing top ups',()=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'available',value:report({accounts:[account({targetCents:4000,existingCents:6000,percentageCents:0,maximumCents:0,excessCents:0,actualCents:6000,share:{status:'available',value:.6}})],retainedCashCents:4000})},plan,context);
  const stocks=within(root).getByRole('row',{name:/Stocks/});expect(stocks).toHaveTextContent('$60.00');expect(stocks).toHaveTextContent('60%');expect(within(stocks).getAllByText('$0.00')).toHaveLength(4);
 });
 it.each(['no-surplus','funding-conflict'] as const)('shows %s as text without normalized wedges',status=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'available',value:report({status,originalCashFlowCents:status==='no-surplus'?0:10000,accounts:[account({actualCents:12000,existingCents:12000,percentageCents:0,share:{status:'available',value:1.2}})],retainedCashCents:0})},plan,context);
  expect(within(root).queryByRole('img')).toBeNull();expect(root).toHaveTextContent(status==='no-surplus'?'No positive allocation budget':'Funding conflict');if(status==='funding-conflict')expect(root).toHaveTextContent('$120.00');else expect(root.textContent).not.toContain('Infinity');
 });
 it('shows unavailable supporting facts without inventing a dollar budget',()=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'needs-data',issues:[reason('required-age','cashFlowAllocation.entries.1.birthDate')]},plan,context);expect(within(root).queryByRole('img')).toBeNull();expect(root).toHaveTextContent('Needs data');expect(root.textContent).not.toContain('$0.00');
 });
 it('places actual accepted excess and retained cash together in annual reports and suppresses deliberate cash markers',()=>{
  const {root,context}=mount();renderAllocationYears(root,[year(report({reasons:[reason('contribution-capped')]})),year(report({year:2027,reasons:[],excessRetainedCents:0}))],context);
  expect(root).toHaveTextContent('2026');expect(root).toHaveTextContent('2027');expect(root).toHaveTextContent('Excess accepted: $15.00');expect(root).toHaveTextContent('Excess retained: $15.00');
  expect(within(root).getAllByRole('button',{name:/cash retained/i})).toHaveLength(1);
 });
 it.each([['contribution-capped',/limit/i],['allocation-compensation-timing',/timing/i],['required-age',/information/i]])('distinguishes %s fallback notes and opens amount/destination/year details', (code,note)=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'available',value:report({reasons:[reason(code)]})},plan,context);
  const trigger=within(root).getByRole('button',{name:/cash retained/i});fireEvent.mouseEnter(trigger);expect(within(document.body).getByRole('tooltip')).toHaveTextContent(note);
  fireEvent.keyDown(document,{key:'Escape'});trigger.focus();expect(within(document.body).getByRole('tooltip')).toBeVisible();
  fireEvent.pointerDown(trigger,{pointerType:'touch'});fireEvent.click(trigger);const panel=within(document.body).getByRole('region',{name:/Cash retained.*2026/});expect(panel).toHaveTextContent('$15.00');expect(panel).toHaveTextContent('IRA');expect(panel).toHaveTextContent('2026');
  fireEvent.keyDown(document,{key:'Escape'});expect(panel).not.toBeVisible();expect(document.activeElement).toBe(trigger);
 });
 it('routes stale indexed issues through the producing entry ID into current draft indexes',()=>{
  const {root,context,reviews}=mount();const current={savedPlan:plan,drafts:{},allocationDraft:{recordId:policy.id,baseSnapshot:'synthetic',value:{...policy,entries:[policy.entries[1],policy.entries[0]]}}};const c={...context,readState:()=>current};
  renderAllocationPie(root,{status:'available',value:report({accounts:[account({shortfallCents:1000,reasons:[reason('allocation-budget-shortfall','cashFlowAllocation.entries.0.amount')]})]})},plan,c);
  fireEvent.click(within(root).getByRole('button',{name:/Stocks.*funding/i}));const panel=within(document.body).getByRole('region');fireEvent.click(within(panel).getByRole('button',{name:/Review.*Stocks/}));expect(reviews[0]).toMatchObject({section:'Investments',recordId:policy.id,field:'entries.1.amount'});
 });
 it('routes entry/overflow identities and owner/sponsor facts to their actual records',()=>{
  const p=makeAllocationPlan({cashFlowAllocation:{...policy,entries:[{...policy.entries[0]!,destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'}}],overflow:{id:'excess-entry',destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'}}}});
  const state={savedPlan:p,drafts:{}};
  expect(resolveIssueTargets(reason('required-age','cashFlowAllocation.entries.0.birthDate'),state)[0]).toMatchObject({section:'Household',recordId:'household',field:'household.filers.0.birthDate'});
  expect(resolveIssueTargets(reason('required-employer-history','cashFlowAllocation.overflow.employerAssumptionsByYear'),state)[0]?.field).toContain('household.filers.0.employerAssumptionsByYear');
  expect(resolveIssueTargets(reason('invalid-sponsor','cashFlowAllocation.entries.0.sponsoringSalaryId'),state)[0]).toMatchObject({section:'Income',recordId:'salary-a'});
  expect(resolveIssueTargets({...reason('contribution-capped','openingIraBasis'),recordId:'stocks-entry'},state)[0]).toMatchObject({section:'Investments',recordId:'workplace',field:'openingIraBasis'});
  expect(resolveIssueTargets({...reason('allocation-budget-shortfall','amount'),recordId:'stocks-entry'},state)[0]).toMatchObject({section:'Investments',recordId:policy.id,field:'entries.0.amount'});
 });
 it('finds current owner/employer year rows and never substitutes a removed source',()=>{
  const p=makeAllocationPlan({cashFlowAllocation:{...policy,entries:[{...policy.entries[0]!,destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'}}]}});
  const rawHousehold={household:{filers:[{id:'owner-b'},{id:'owner-a',employerAssumptionsByYear:[{year:'2025',employerId:'employer-0'},{year:'2026',employerId:'employer-1'},{year:'2026',employerId:'employer-0'}]}]}};
  const state={savedPlan:p,drafts:{household:{recordId:'household',section:'household' as const,value:rawHousehold}},allocationDraft:{recordId:policy.id,baseSnapshot:'synthetic',value:{...policy,entries:[policy.entries[1]]}}};
  expect(resolveIssueTargets(reason('required-employer-history','cashFlowAllocation.entries.0.employerAssumptionsByYear.priorYearWagesCents'),state,p)[0]).toMatchObject({section:'Household',recordId:'household',field:'household.filers.1.employerAssumptionsByYear.2.priorYearWagesCents'});
  expect(resolveIssueTargets(reason('allocation-budget-shortfall','cashFlowAllocation.entries.0.amount'),state,p)[0]).toMatchObject({section:'Investments',recordId:policy.id});
  expect(resolveIssueTargets(reason('allocation-budget-shortfall','cashFlowAllocation.entries.0.amount'),state,p)[0]).not.toHaveProperty('field');
  expect(resolveIssueTargets(reason('mandatory-roth-catchup','cashFlowAllocation.entries.0.accountId'),state,p)[0]).toMatchObject({section:'Investments',recordId:'workplace',field:'type'});
 });
 it('does not claim a fallback failure for fully accepted funding with retained probe reasons',()=>{
  const {root,context}=mount();const probe=reason('contribution-capped','cashFlowAllocation.entries.0.amount');
  renderAllocationPie(root,{status:'available',value:report({accounts:[account({reasons:[probe]})],excessRetainedCents:0,retainedCashCents:5000,reasons:[probe]})},plan,context);
  expect(within(root).queryByRole('button',{name:/Stocks funding/})).toBeNull();expect(within(root).queryByRole('button',{name:/cash retained/i})).toBeNull();
  expect(within(root).queryByRole('button',{name:/Allocation notes/})).toBeNull();
 });
 it('explains an actual cash shortfall separately from the legal maximum at the same source',()=>{
  const {root,context}=mount(),cap={...reason('ira-contribution-capped','cashFlowAllocation.entries.1.amount'),explanation:'This restriction determines the computed annual maximum. Roth income limits restrict further contributions.'},cash=reason('allocation-cash-shortfall','cashFlowAllocation.entries.1.destination');
  renderAllocationPie(root,{status:'available',value:report({accounts:[account({accountId:'ira',targetCents:3000,actualCents:2000,shortfallCents:1000,reasons:[cap,cash]})],reasons:[cap,cash],excessRetainedCents:0})},plan,context);
  fireEvent.mouseEnter(within(root).getByRole('button',{name:/IRA funding/}));
  expect(within(document.body).getByRole('tooltip')).toHaveTextContent(/available annual cash/i);
  expect(within(document.body).getByRole('tooltip')).not.toHaveTextContent(/confirmed contribution limit.*prevented/i);
 });
 it('keeps a reconciled partial annual maximum visible as actual funded shares',()=>{
  const {root,context}=mount();renderAllocationPie(root,{status:'available',value:report({accounts:[account({accountId:'ira',targetCents:3000,existingCents:0,percentageCents:0,maximumCents:2000,excessCents:0,actualCents:2000,shortfallCents:1000,share:{status:'available',value:.2},reasons:[reason('allocation-cash-shortfall','cashFlowAllocation.entries.1.destination')]})],retainedCashCents:8000,excessRetainedCents:0})},plan,context);
  expect(within(root).getByRole('img')).toBeVisible();expect(within(root).getByRole('row',{name:/IRA/})).toHaveTextContent('20%');expect(within(root).getByRole('button',{name:/IRA funding/})).toHaveTextContent('Partially funded');
  fireEvent.mouseEnter(within(root).getByRole('button',{name:/IRA funding/}));expect(within(document.body).getByRole('tooltip')).not.toHaveTextContent('excess destination');
 });
 it('adds allocation reports only for annual rows which carry them without moving overview columns',()=>{
  const {root,context}=mount();const projection=calculateProjection(mustValidate(makeAllocationPlan()),loadRuleSet());renderProjection(root,{...projection,years:[year(report())]},context);expect(within(root).getByRole('heading',{name:'Annual cash flow allocation'})).toBeVisible();
  const overview=within(root).getByRole('table',{name:'Annual financial overview'});expect([...overview.querySelectorAll('thead th')].map(n=>n.textContent)).toEqual(['Year','Net Worth','Total Income','Cash Income','Post Tax Income','Expenses','Cash Flow']);
  const {cashFlowAllocation:_,...withoutAllocation}=baseYear;renderAllocationYears(root,[withoutAllocation],context);expect(within(root).queryByRole('heading',{name:'Annual cash flow allocation'})).toBeNull();
 });
 it('shows the deliberate saving target, actual earmark and shortfall with current cash-source review',()=>{
  const cashEntry={id:'cash-entry',priority:1,destination:{kind:'cash' as const},amount:{kind:'percent' as const,percentBps:5000}};
  const p=makeAllocationPlan({cashFlowAllocation:{...policy,entries:[cashEntry,policy.entries[0]!]}}),{root,context,reviews}=mount(p);
  const current={savedPlan:p,drafts:{},allocationDraft:{recordId:policy.id,baseSnapshot:'synthetic',value:{...p.cashFlowAllocation,entries:[policy.entries[0],cashEntry]}}};
  const cashIssue=reason('allocation-cash-shortfall','cashFlowAllocation.entries.0.amount');
  const value={...report({originalCashFlowCents:1000000,accounts:[account({targetCents:720000,actualCents:720000,existingCents:720000,percentageCents:0,excessCents:0,share:{status:'available',value:.72}})],explicitCashCents:280000,retainedCashCents:280000,excessOfferedCents:0,excessAcceptedCents:0,excessRetainedCents:0,reasons:[cashIssue]}),explicitCashTargetCents:500000,explicitCashShortfallCents:220000};
  renderAllocationPie(root,{status:'available',value},p,{...context,readState:()=>current});
  expect(within(root).getByRole('img')).toBeVisible();const row=within(root).getByRole('row',{name:/Cash \/ savings/});
  expect(row).toHaveTextContent('$5,000.00');expect(row).toHaveTextContent('$2,800.00');expect(row).toHaveTextContent('$2,200.00');
  const trigger=within(row).getByRole('button',{name:/Cash.*target funding/});expect(trigger).toHaveTextContent('Partially funded');
  fireEvent.click(trigger);const panel=within(document.body).getByRole('region',{name:/Cash.*target funding/});
  for(const amount of ['$5,000.00','$2,800.00','$2,200.00'])expect(panel).toHaveTextContent(amount);
  expect(panel).not.toHaveTextContent('excess destination');fireEvent.click(within(panel).getByRole('button',{name:/Review Allocation.*Cash \/ savings/}));
  expect(reviews[0]).toMatchObject({section:'Investments',recordId:policy.id,field:'entries.1.amount'});expect(within(root).queryByRole('button',{name:/cash retained/i})).toBeNull();
 });
});
