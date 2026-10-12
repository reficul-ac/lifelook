import {describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,createPlan,loadRuleSet,type Issue,type PlanDocument,type ProjectionResult} from '../../src/engine';
import {formatPeriods,groupIssueOccurrences,getRecordLabel,resolveIssueTargets} from '../../src/browser/issue-presentation';
import {appendAmount} from '../../src/browser/views/issues';
import {renderProjection} from '../../src/browser/views/projection';
import {makePlan,mustValidate} from '../helpers/plans';
import {loadReferences} from '../helpers/references';
import {mountPresentation} from '../helpers/presentation';
const issue:Issue={code:'required-history',recordId:'rental-a',field:'taxHistory.federal',year:2027,severity:'warning',explanation:'History missing',resolution:'Review Federal history'};
describe('issue presentation',()=>{
  it('retains noncontiguous years and distinct corrections, records, fields, severity and explanations',()=>{
    const groups=groupIssueOccurrences([{issue},{issue},{issue:{...issue,year:2029}},{issue:{...issue,recordId:'rental-b'}},{issue:{...issue,resolution:'Review another input'}},{issue:{...issue,field:'taxHistory.california'}},{issue:{...issue,severity:'error'}},{issue:{...issue,explanation:'Different cause'}}]);
    expect(groups).toHaveLength(6);expect(groups[0]?.issues).toHaveLength(2);expect(groups[0]?.periods).toEqual([{year:2027},{year:2029}]);expect(formatPeriods(groups[0]!.periods)).toBe('2027, 2029');
  });
  it('compresses only adjacent months and preserves original cause year over a containing period',()=>{
    const {year,...undated}=issue;
    const groups=groupIssueOccurrences([{issue,period:{year:2056,month:9}},{issue:undated,period:{year:2027,month:1}},{issue:undated,period:{year:2027,month:2}},{issue:undated,period:{year:2027,month:4}}]);
    expect(groups[0]!.periods).toEqual([{year:2027},{year:2027,month:1},{year:2027,month:2},{year:2027,month:4}]);
    expect(formatPeriods([{year:2027,month:1},{year:2027,month:2},{year:2027,month:4}])).toBe('Jan–Feb 2027, Apr 2027');
  });
  it('keeps a 30-year reserve compact while retaining all original years and named checks',()=>{
    const plan=createPlan('2026-10-12','warning-audit');const {root,context}=mountPresentation(plan);renderProjection(root,calculateProjection(mustValidate(plan),loadRuleSet()),context);
    const cell=within(root).getByTestId('annual-2056-net-worth');expect(cell).toHaveTextContent('Needs data');expect(cell.querySelectorAll('p')).toHaveLength(0);expect(cell.textContent).not.toContain('$0.00');
    fireEvent.click(within(cell).getByRole('button',{name:/Needs data/}));const panel=within(document.body).getByRole('region',{name:'Net worth · 2056'});
    for(const text of ['2027–2056','Additional income outside these records','Additional household tax credits','Qualified dividends or capital gains'])expect(panel).toHaveTextContent(text);
    fireEvent.click(within(panel).getByRole('button',{name:'Review Household'}));
  });
  it('keeps empty unavailable causes honest and arbitrary codes/names literal',()=>{
    const {root,context}=mountPresentation();appendAmount(root,{status:'needs-data',issues:[]},context,{label:'Balance'});fireEvent.click(within(root).getByRole('button'));expect(within(document.body).getByRole('region')).toHaveTextContent('Supporting information is missing');
    appendAmount(root,{status:'unsupported-case',issues:[{...issue,code:'unknown-code',recordId:'__proto__',explanation:'<script>bad()</script>'}]},context,{label:'Other'});fireEvent.click(within(root).getByRole('button',{name:/Unsupported/}));expect(document.querySelector('script')).toBeNull();expect(within(document.body).getByRole('region')).toHaveTextContent('<script>bad()</script>');expect(getRecordLabel(makePlan(),'__proto__')).toBe('__proto__');
  });
  it('routes filer, nested rental/loan, bracket paths and indirect contribution requirements',()=>{
    const plan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;
    const state={savedPlan:plan,drafts:{}};
    expect(resolveIssueTargets({...issue,recordId:plan.household.filers[0].id,field:'birthDate'},state)[0]).toMatchObject({section:'Household',recordId:'household',field:'household.filers.0.birthDate'});
    expect(resolveIssueTargets({...issue,recordId:plan.rentals[0]!.id,field:'loanAllocations[0].share'},state)[0]).toMatchObject({section:'Properties',recordId:'home',field:'rentals.0.loanAllocations.0.share'});
    expect(resolveIssueTargets({...issue,recordId:plan.properties[0]!.loans[0]!.id,field:'openingBalance'},state)[0]).toMatchObject({section:'Properties',recordId:'home',field:'property.loans.0.openingBalance'});
    const contribution=plan.contributions[0]!;
    expect(resolveIssueTargets({...issue,recordId:contribution.id,field:'birthDate'},state)[0]?.section).toBe('Household');
    expect(resolveIssueTargets({...issue,recordId:contribution.id,field:'employerAssumptionsByYear'},state)[0]?.field).toContain('employerAssumptionsByYear');
    expect(resolveIssueTargets({...issue,recordId:contribution.id,field:'spouse.workplaceCoverage'},state)).toHaveLength(2);
    expect(getRecordLabel(plan,plan.rentals[0]!.id)).toContain(plan.properties[0]!.name);
    expect(getRecordLabel(plan,contribution.id)).toContain(plan.accounts.find(a=>a.id===contribution.accountId)!.name);
  });
});
