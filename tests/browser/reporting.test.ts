import {mountPresentation} from '../helpers/presentation';
import type {IssueViewContext} from '../../src/browser/issue-presentation';
import { describe,expect,it } from 'vitest';
import { fireEvent,within } from '@testing-library/dom';
import { calculateProjection,loadRuleSet } from '../../src/engine';
import type { PlanDocument,ProjectionResult } from '../../src/engine';
import { renderProjection } from '../../src/browser/views/projection';
import { renderTaxExplanation } from '../../src/browser/views/tax-explanation';
import { renderIssues } from '../../src/browser/views/issues';
import { loadReferences } from '../helpers/references';
import { mustValidate } from '../helpers/plans';
const currency=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const slug=(key:string)=>key.replace(/Cents$/,'').replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`);
function fixture(id:string){return loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id===id)!;}
function result(id:string){return calculateProjection(mustValidate(fixture(id).input),loadRuleSet());}
let context:IssueViewContext;
function root(){const mounted=mountPresentation(fixture('two-salaries-home-adu').input);context=mounted.context;return mounted.root;}
describe('traceable projection reporting',()=>{
  it('displays every aggregate column from the independent annual worksheet with saved revision',()=>{
    const c=fixture('two-salaries-home-adu'),node=root();renderProjection(node,result(c.id),context);
    const queries=within(node);expect(queries.getByRole('heading',{name:'Projection'})).toBeVisible();
    expect(queries.getByText('Calculated from saved revision 0')).toBeVisible();
    const year=c.expected.years[0]!;
    for(const key of ['grossIncomeCents','salaryCents','otherIncomeCents','rentCents','ordinaryExpensesCents','propertyExpensesCents','expensesCents','debtPaymentCents','interestCents','principalPaidCents','federalIncomeTaxCents','californiaIncomeTaxCents','socialSecurityCents','medicareCents','additionalMedicareCents','sdiCents','totalTaxCents','requestedContributionCents','eligibleContributionCents','preventedContributionCents','accountGrowthCents','propertyGrowthCents','cashFlowCents','accountBalanceCents','propertyValueCents','loanBalanceCents','equityCents','reserveCents','netWorthCents'] as const){
      const value=year[key];if(value.status!=='available')throw new Error('Complete worksheet required');
      expect(queries.getByTestId(`annual-2026-${slug(key)}`)).toHaveTextContent(currency(value.value));
    }
    for(const label of ['Gross income','Federal income tax','California income tax','Social Security','Medicare','Additional Medicare','SDI','Expenses','Debt payments','Eligible contributions','Prevented contributions','Account growth','Property growth','Cash flow','Cash reserve','Net worth'])expect(queries.getByRole('columnheader',{name:label})).toBeVisible();
  });
  it('expands monthly amounts with a native labeled button and visible account/property/loan detail',()=>{
    const c=fixture('two-salaries-home-adu'),node=root();renderProjection(node,result(c.id),context);const queries=within(node);
    expect(node.querySelector('[data-testid="monthly-2026-01-net-worth"]')).toBeNull();
    const button=queries.getByRole('button',{name:'Show months for 2026'});button.focus();expect(button).toHaveFocus();button.click();
    const month=queries.getByTestId('monthly-2026-01-net-worth');
    expect(button).toHaveAttribute('aria-expanded','true');expect(month).toBeVisible();
    const expected=c.expected.months[0]!.netWorthCents;if(expected.status!=='available')throw new Error('Complete month required');
    expect(month).toHaveTextContent(currency(expected.value));
    for(const account of c.expected.years[0]!.accounts)if(account.closingCents.status==='available')expect(queries.getByTestId(`annual-2026-account-${account.accountId}-closing`)).toHaveTextContent(currency(account.closingCents.value));
    for(const property of c.expected.years[0]!.properties)if(property.equityCents.status==='available')expect(queries.getByTestId(`annual-2026-property-${property.propertyId}-equity`)).toHaveTextContent(currency(property.equityCents.value));
    for(const loan of c.expected.years[0]!.loans)if(loan.closingPrincipalCents.status==='available')expect(queries.getByTestId(`annual-2026-loan-${loan.loanId}-closing`)).toHaveTextContent(currency(loan.closingPrincipalCents.value));
    button.click();expect(month).not.toBeVisible();expect(button).toHaveAttribute('aria-expanded','false');
  });
  it('defers tax detail until its native expansion control is opened',()=>{
    const node=root();renderProjection(node,result('two-salaries-home-adu'),context);const queries=within(node);
    expect(node.querySelector('[data-testid="tax-2026-federal-total"]')).toBeNull();
    const button=queries.getByRole('button',{name:'Tax explanation for 2026'});button.click();
    expect(button).toHaveAttribute('aria-expanded','true');
    expect(queries.getByTestId('tax-2026-federal-total')).toHaveTextContent('$9,839.00');
    button.click();expect(queries.getByTestId('tax-2026-federal-total')).not.toBeVisible();
  });
  it('identifies a contribution rule whose request schedule could not be calculated',()=>{
    const projection=result('cash-only'),node=root();
    const issue={code:'monetary-overflow',recordId:'large-rule',year:2026,field:'amount',severity:'error' as const,explanation:'The requested contribution exceeds the supported monetary range.',resolution:'Reduce this contribution rule amount.'};
    renderProjection(node,{...projection,contributionSchedules:[{ruleId:'large-rule',year:2026,requests:{status:'unsupported-case',issues:[issue]}}],issues:[...projection.issues,issue]},context);
    const cell=within(node).getByTestId('contribution-schedule-2026-large-rule');
    expect(cell).toHaveTextContent('Unsupported');fireEvent.click(within(cell).getByRole('button'));const panel=within(document.body).getByRole('region');expect(panel).toHaveTextContent(issue.explanation);expect(panel).toHaveTextContent(issue.resolution);expect(cell.textContent).not.toContain('$0.00');
    expect(within(node).getByRole('table',{name:'Contribution request schedules'})).toHaveTextContent('large-rule');
  });
  it('shows selected tax methods, four comparisons, components and assessed/paid tax assumptions',()=>{
    const node=root();renderTaxExplanation(node,result('two-salaries-home-adu').years[0]!,context);const queries=within(node);
    expect(queries.getByText('Federal method: standard')).toBeVisible();expect(queries.getByText('California method: standard')).toBeVisible();
    expect(queries.getByTestId('tax-2026-federal-total')).toHaveTextContent('$9,839.00');expect(queries.getByTestId('tax-2026-california-total')).toHaveTextContent('$3,046.00');
    expect(queries.getByRole('table',{name:'Legal deduction comparisons'}).querySelectorAll('tbody tr')).toHaveLength(4);
    expect(queries.getByText('California tax assessed')).toBeVisible();expect(queries.getByText('California income tax paid')).toBeVisible();
    expect(queries.getByText('Prospective payment assumption')).toBeVisible();
    expect(queries.getByText('Federal AMT',{selector:'dt'})).toBeVisible();expect(queries.getByText('NIIT')).toBeVisible();expect(queries.getByText('California AMT',{selector:'dt'})).toBeVisible();expect(queries.getByText('California surtax')).toBeVisible();
  });
  it('explains AMT-selected itemization, disallowed reasons and separate rental loss books',()=>{
    const c=loadReferences<{plan:PlanDocument},unknown>('comparison-2026').find(c=>c.id==='amt-lower-itemization-beats-larger-standard')!;
    const doc={...c.input.plan,expenses:[{id:'home-insurance',name:'Insurance',propertyId:'home',amountCents:120000,frequency:'annual' as const,startDate:'2026-01-01',annualGrowthBps:0,use:'personal' as const,taxCategory:'homeowners-insurance' as const},{id:'mpi',name:'Mortgage insurance',propertyId:'home',amountCents:100000,frequency:'annual' as const,startDate:'2026-01-01',annualGrowthBps:0,use:'personal' as const,taxCategory:'mortgage-insurance' as const,mortgageInsuranceQualification:{known:true as const,value:true}}]};
    const projection=calculateProjection(mustValidate(doc),loadRuleSet()),node=root();renderTaxExplanation(node,projection.years[0]!,context);const queries=within(node);
    expect(queries.getByText('Federal method: itemized')).toBeVisible();expect(queries.getByText('California method: itemized')).toBeVisible();
    expect(queries.getByTestId('tax-2026-federal-total')).toHaveTextContent('$33,748.00');
    expect(queries.getByTestId('tax-2026-federal-disallowed')).toHaveTextContent('$2,200.00');
    expect(queries.getByTestId('tax-2026-california-disallowed')).toHaveTextContent('$2,200.00');
    fireEvent.click(queries.getAllByRole('button').find(b=>b.textContent==='Personal homeowner insurance does not qualify as an itemized deduction.')!);expect(within(document.body).getByRole('region')).toHaveTextContent('Personal homeowner insurance does not qualify as an itemized deduction.');
    expect(queries.getByRole('table',{name:'Rental cash and tax allocations'})).toBeVisible();
    const books=within(queries.getByRole('table',{name:'Rental taxable books'}));
    for(const label of ['Federal regular','California regular','Federal AMT','California AMT'])expect(books.getByText(label)).toBeVisible();
    expect(queries.getByTestId('rental-2026-rent-federal-passive-loss')).toHaveTextContent('$15,000.04');
  });
  it('shows requested, eligible and prevented monthly funding after shared IRA limits',()=>{
    const c=loadReferences<{plan:PlanDocument},unknown>('comparison-2026').find(c=>c.id==='final-ira-funding-order-precedes-tax-comparison')!;
    const node=root();renderTaxExplanation(node,calculateProjection(mustValidate(c.input.plan),loadRuleSet()).years[0]!,context);const queries=within(node);
    expect(queries.getByRole('table',{name:'Contribution requests and limits'}).querySelectorAll('tbody tr')).toHaveLength(24);
    expect(queries.getByTestId('contribution-2026-1-a-traditional-eligible')).toHaveTextContent('$625.00');
    expect(queries.getByTestId('contribution-2026-7-a-traditional-eligible')).toHaveTextContent('$0.00');
    expect(queries.getByTestId('contribution-2026-7-a-traditional-prevented')).toHaveTextContent('$625.00');
    expect(queries.getByText('IRA closing basis: owner-a')).toBeVisible();expect(queries.getByTestId('ira-2026-owner-a-basis')).toHaveTextContent('$370.00');
  });
  it('keeps independent results visible and explains unavailable values without numeric placeholders',()=>{
    const c=fixture('unknown-rental-history-two-years'),node=root();renderProjection(node,result(c.id),context);const queries=within(node);
    const unknown=queries.getByTestId('annual-2026-net-worth');expect(unknown).toHaveTextContent('Needs data');expect(unknown.textContent).not.toContain('$0.00');fireEvent.click(within(unknown).getByRole('button'));expect(within(document.body).getByRole('region')).toHaveTextContent('Supply');
    const salary=c.expected.years[0]!.salaryCents;if(salary.status!=='available')throw new Error('Known salary required');
    expect(queries.getByTestId('annual-2026-salary')).toHaveTextContent(currency(salary.value));
    expect(queries.getAllByText('Incomplete household liability')[0]).toBeVisible();
  });
  it('distinguishes provisional/projected sources, coverage and persistent funding gaps',()=>{
    const node=root();renderProjection(node,result('provisional-2027'),context);const queries=within(node);
    expect(queries.getAllByText('Provisional rules')[0]).toBeVisible();expect(queries.getAllByText('Projected rules')[0]).toBeVisible();
    expect(queries.getAllByRole('link').some(a=>a.getAttribute('href')==='https://www.irs.gov/pub/irs-drop/rp-25-32.pdf')).toBe(true);
    renderProjection(node,result('cash-only-funding-gap'),context);
    expect(within(node).getByText('Conditional after a cash gap')).toBeVisible();
    expect(within(node).getByText(/Contributions remain planned/)).toBeVisible();
    expect(within(node).getByTestId('annual-2026-net-worth')).toHaveTextContent('$100.00');
    const gap=result('cash-only-funding-gap');
    renderProjection(node,{...gap,years:gap.years.map(year=>({...year,fundingStatus:'unavailable'}))},context);
    expect(within(node).getByText('Conditional after a cash gap')).toBeVisible();
    expect(within(node).getByText('Funding result unavailable')).toBeVisible();
  });
  it('renders imported HTML-like issue text literally with a clear action',()=>{
    const node=root();renderIssues(node,[{code:'required-history',recordId:'<img src=x onerror=alert(1)>',year:2026,field:'taxHistory.federal',severity:'warning',explanation:'<script>bad()</script> missing history',resolution:'Supply the declared opening book.'}],context);
    expect(node.querySelector('img')).toBeNull();expect(node.querySelector('script')).toBeNull();
    fireEvent.click(within(node).getByRole('button'));expect(within(document.body).getByRole('region')).toHaveTextContent('<script>bad()</script> missing history');
    expect(within(document.body).getByRole('region')).toHaveTextContent('Supply the declared opening book.');
    expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
