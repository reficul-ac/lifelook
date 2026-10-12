import type {IssueViewContext} from '../issue-presentation';
import { element,renderField,renderHistory,renderRecordSection,renderRows,type FieldContext } from '../fields';
import type { WorkspaceController } from '../state';

export function renderHouseholdForm(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext):void {
  renderRecordSection(root,controller,'household','Household',(body,context)=>{
    renderField(body,context,['startYear'],'Projection start year',{kind:'integer'});
    renderField(body,context,['horizonYears'],'Projection years',{kind:'integer',hint:'1–40 years.'});
    renderField(body,context,['openingCashCents'],'Opening cash reserve ($)',{kind:'money',hint:'Cash outside investment accounts on Jan 1.'});
    for(let index=0;index<2;index++){
      const group=element('fieldset');group.append(element('legend',`Filer ${index+1}`));const path=['household','filers',index] as const,prefix=`Filer ${index+1}`;
      renderField(group,context,[...path,'name'],`${prefix} name`);
      renderHistory(group,context,[...path,'birthDate'],`${prefix} birth date`,{kind:'date'});
      renderHistory(group,context,[...path,'workplaceCoverage'],`${prefix} covered by workplace retirement plan`,{kind:'checkbox'});
      renderHistory(group,context,[...path,'seniorDeductionSsnEligible'],`${prefix} eligible SSN for senior deduction`,{kind:'checkbox'});
      renderRows(group,context,[...path,'coverageByYear'],`${prefix} annual workplace coverage`,()=>({year:String(controller.getState().savedPlan.startYear),workplaceCoverage:{known:false}}),(row,rowPath,i)=>{
        renderField(row,context,[...rowPath,'year'],`${prefix} coverage year ${i+1}`,{kind:'integer'});renderHistory(row,context,[...rowPath,'workplaceCoverage'],`${prefix} workplace coverage ${i+1}`,{kind:'checkbox'});
      });
      renderRows(group,context,[...path,'employerAssumptionsByYear'],`${prefix} employer catch-up facts`,()=>({year:String(controller.getState().savedPlan.startYear),employerId:'',priorYearWagesCents:{known:false},planCatchUpAvailable:{known:false},rothCatchUpAvailable:{known:false}}),(row,rowPath,i)=>{
        renderField(row,context,[...rowPath,'year'],`${prefix} employer year ${i+1}`,{kind:'integer'});renderField(row,context,[...rowPath,'employerId'],`${prefix} employer ${i+1}`,{kind:'select',options:[{value:'',label:'Choose an employer from Income'},...controller.getState().savedPlan.salaries.filter(s=>s.ownerId===controller.getState().savedPlan.household.filers[index]!.id).map(s=>({value:s.employerId,label:s.name}))],hint:'Use the employer linked to the sponsoring salary.'});
        renderHistory(row,context,[...rowPath,'priorYearWagesCents'],`${prefix} prior-year employer wages ${i+1} ($)`,{kind:'money'});
        renderHistory(row,context,[...rowPath,'planCatchUpAvailable'],`${prefix} employer offers catch-up ${i+1}`,{kind:'checkbox'});renderHistory(row,context,[...rowPath,'rothCatchUpAvailable'],`${prefix} employer offers Roth catch-up ${i+1}`,{kind:'checkbox'});
      });body.append(group);
    }
    const questions:readonly [string,string][]=[['additionalIncome','Additional income outside these records'],['additionalCredits','Additional household tax credits'],['qualifiedDividendsOrCapitalGains','Qualified dividends or capital gains'],['retirementDistributions','Retirement distributions'],['priorFederalMinimumTaxCredits','Prior federal minimum-tax credits'],['priorCaliforniaMinimumTaxCredits','Prior California minimum-tax credits']];
    const circumstances=element('fieldset');circumstances.append(element('legend','Other tax circumstances'));body.append(circumstances);
    for(const [field,label] of questions)renderHistory(circumstances,context,['household','coverageAnswers',field],label,{kind:'checkbox'});
    const policy=element('fieldset');policy.append(element('legend','Tax payment and future rule assumptions'));
    renderField(policy,context,['taxPolicy','futureIndexGrowthBps'],'Future tax threshold growth (%)',{kind:'rate',hint:'Annual increase assumed for tax thresholds after 2026.'});
    renderRows(policy,context,['taxPolicy','actualStateTaxPaidByYear'],'actual state tax payment',()=>({year:String(controller.getState().savedPlan.startYear),californiaIncomeTaxPaidCents:'',sdiPaidCents:''}),(row,path,i)=>{
      renderField(row,context,[...path,'year'],`State tax payment year ${i+1}`,{kind:'integer'});renderField(row,context,[...path,'californiaIncomeTaxPaidCents'],`California income tax actually paid ${i+1} ($)`,{kind:'money'});renderField(row,context,[...path,'sdiPaidCents'],`SDI actually paid ${i+1} ($)`,{kind:'money'});
    });body.append(policy);
  },undefined,ui);
}
