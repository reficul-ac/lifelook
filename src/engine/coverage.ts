import { parseISODate } from './dates';
import {aduTaxActivityStarted} from './property/adu-tax';
import type { History, ValidatedPlan } from './model/plan';
import type { Coverage, Issue } from './model/results';
import { rsuVestingEvents } from './equity/rsu';

/** Deferred awards need their actual settlement and FICA history before tax can be complete. */
export function rsuDeferredTaxIssues(plan:ValidatedPlan,year:number):readonly Issue[] {
  return plan.accounts.filter(account=>account.type==='rsu').flatMap(account=>account.rsu!.grants.flatMap((grant,index)=>{
    if(grant.taxTreatment!=='deferred'||!rsuVestingEvents(grant).some(event=>event.date<=`${year}-12-31`))return [];
    return [{code:'unsupported-rsu-deferred-settlement',recordId:account.id,year,field:`rsu.grants.${index}.taxTreatment`,severity:'warning' as const,explanation:'This RSU grant defers share delivery. Income-tax and payroll-tax timing require settlement terms and history beyond this model.',resolution:'Use settlement at each vest only if the award delivers shares then; deferred awards need a separate settlement and payroll model.'}];
  }));
}

/** Scenario coverage is independent of whether the selected rule constants are verified. */
export function checkCoverage(plan: ValidatedPlan, year: number): Coverage {
  const issues: Issue[] = [];
  let completeForModeledScope = true;
  let completeHouseholdLiability = true;
  const add = (code: string, recordId: string, field: string, explanation: string, resolution: string, modeled = true): void => {
    issues.push({ code, recordId, year, field, severity: 'warning', explanation, resolution });
    completeHouseholdLiability = false;
    if (modeled) completeForModeledScope = false;
  };
  const required = <T>(history: History<T>, recordId: string, field: string, modeled = true): void => {
    if (!history.known) add('required-history', recordId, field, 'This history is unknown; dependent tax results require an explicit answer.', 'Supply the history or explicitly confirm a known zero or absence.', modeled);
  };
  plan.household.filers.forEach(filer => {
    required(filer.birthDate, filer.id, 'birthDate');
    const coverage = filer.coverageByYear.find(row => row.year === year)?.workplaceCoverage ?? filer.workplaceCoverage;
    required(coverage, filer.id, 'workplaceCoverage');
    if (filer.birthDate.known) {
      const birthYear = parseISODate(filer.birthDate.value).year;
      const age = year - birthYear;
      const distributionAge = birthYear >= 1960 ? 75 : birthYear >= 1951 ? 73 : 72;
      const hasDeferredAccount = plan.accounts.some(a => a.ownerId === filer.id && (a.type === 'traditional-ira' || a.type === 'traditional-401k') && a.openingBalanceCents > 0);
      if (hasDeferredAccount && age >= distributionAge) add('omitted-distributions', filer.id, 'birthDate', 'This year can depend on retirement distributions that this contribution-and-growth scenario omits.', 'Interpret total household liability as incomplete and model distribution planning separately.', false);
      if (age >= 50) {
        const sponsors = new Set(plan.contributions.flatMap(rule => rule.sponsoringSalaryId ? [rule.sponsoringSalaryId] : []));
        plan.salaries.filter(salary => salary.ownerId === filer.id && sponsors.has(salary.id)).forEach(salary => {
          const facts = filer.employerAssumptionsByYear.find(row => row.year === year && row.employerId === salary.employerId);
          if (!facts) add('required-history', filer.id, 'employerAssumptionsByYear', 'Catch-up contributions require sponsoring-employer history and plan availability.', 'Supply prior-year employer wages and catch-up availability for this year.');
          else {
            required(facts.priorYearWagesCents, filer.id, 'employerAssumptionsByYear.priorYearWagesCents');
            required(facts.planCatchUpAvailable, filer.id, 'employerAssumptionsByYear.planCatchUpAvailable');
            required(facts.rothCatchUpAvailable, filer.id, 'employerAssumptionsByYear.rothCatchUpAvailable');
          }
        });
      }
    }
  });
  Object.entries(plan.household.coverageAnswers).forEach(([field, answer]: [string, History<boolean>]) => {
    required(answer, plan.id, `household.coverageAnswers.${field}`, false);
    if (answer.known && answer.value) add('unsupported-tax-case', plan.id, `household.coverageAnswers.${field}`, 'The household reports an income, credit, or distribution circumstance beyond the modeled tax scope.', 'Add support for this circumstance before treating the result as complete household liability.', false);
  });
  plan.otherIncome.filter(income => income.classification === 'ordinary-taxable' && income.niitTreatment === 'unknown').forEach(income => add('required-data', income.id, 'niitTreatment', 'NIIT treatment of this taxable income is unresolved.', 'Classify its treatment as included or excluded before calculating NIIT.'));
  plan.properties.filter(property=>property.purchaseDate<=`${year}-12-31`).forEach(property => property.loans.forEach(loan => {
    required(loan.proceedsQualification.qualifiedAcquisitionDebt, loan.id, 'proceedsQualification.qualifiedAcquisitionDebt');
    required(loan.proceedsQualification.qualifiedPrincipalCents, loan.id, 'proceedsQualification.qualifiedPrincipalCents');
    required(loan.proceedsQualification.historyComplete, loan.id, 'proceedsQualification.historyComplete');
    if (loan.proceedsQualification.kind !== 'acquisition' && (loan.proceedsQualification.kind === 'unknown' || !loan.proceedsQualification.historyComplete.known || !loan.proceedsQualification.historyComplete.value)) add('unsupported-tax-case', loan.id, 'proceedsQualification', 'Advanced mortgage qualification requires complete qualifying proceeds history.', 'Supply supported financing and acquisition history before claiming mortgage deductions.');
  }));
  plan.rentals.forEach(rental => {
    const owner=plan.properties.find(property=>property.id===rental.propertyId);
    if(owner&&owner.purchaseDate>`${year}-12-31`)return;
    const property=plan.properties.find(p=>p.aduProject?.rentalId===rental.id);
    if(property&&!aduTaxActivityStarted(plan,property,year))return;
    required(rental.activeParticipation, rental.id, 'activeParticipation');
    if (rental.convertedFromPersonalUse) required(rental.conversionBuildingFmv, rental.id, 'conversionBuildingFmv');
    Object.entries(rental.qualifications).forEach(([field, answer]: [string, History<boolean>]) => {
      if (field === 'californiaSmallBusinessQualification') return;
      required(answer, rental.id, `qualifications.${field}`);
      if (answer.known && (field === 'advancedBasisAdjustments' ? answer.value : !answer.value)) add('unsupported-tax-case', rental.id, `qualifications.${field}`, 'This rental qualification is outside the ordinary residential long-term rental contract.', 'Provide supported qualification or basis history before calculating dependent rental taxes.');
    });
    Object.entries(rental.taxHistory).forEach(([book, history]) => required(history, rental.id, `taxHistory.${book}`));
    rental.loanAllocations.forEach(allocation => {
      required(allocation.qualification, rental.id, 'loanAllocations.qualification');
      const loan = plan.properties.flatMap(p => p.loans).find(item => item.id === allocation.loanId);
      if (loan) required(loan.financingAtRiskQualification, loan.id, 'financingAtRiskQualification');
    });
    required(rental.qbi.qualification, rental.id, 'qbi.qualification');
    required(rental.qbi.openingLossVintages, rental.id, 'qbi.openingLossVintages');
    if (rental.qbi.qualification.known && rental.qbi.qualification.value) {
      required(rental.qbi.wagesCents, rental.id, 'qbi.wagesCents');
      required(rental.qbi.ubiaCents, rental.id, 'qbi.ubiaCents');
    }
  });
  for(const property of plan.properties){
    if(property.purchaseDate>`${plan.startYear}-01-01`&&property.purchaseDate<=`${year}-12-31`){
      if(property.purchaseFunding?.kind==='taxable-brokerage'){
        completeHouseholdLiability=false;
        issues.push({code:'purchase-funding-estimate',recordId:property.id,year,field:'purchaseFunding',severity:'info',explanation:'The down payment assumes proportional sales of long-term brokerage holdings. Unknown account basis is estimated as zero, and realized losses receive no tax deduction, offset or carryforward benefit.',resolution:'Review the selected account and its investment cost basis before relying on the planning estimate.'});
      }
      if(property.purchaseTaxEstimation?.mode==='simple'){
        completeHouseholdLiability=false;
        issues.push({code:'property-purchase-estimate',recordId:property.id,year,field:'purchaseTaxEstimation',severity:'info',explanation:'The planned purchase uses estimates for unanswered ordinary rental and purchase-loan tax details, with the selected building share of the purchase price used for depreciation. Known tax answers are preserved.',resolution:'Review the purchase tax assumptions or choose detailed tax inputs.'});
      }
    }
    if(property.aduProject?.ownerFunding?.kind==='taxable-brokerage'){
      completeHouseholdLiability=false;
      issues.push({code:'brokerage-funding-estimate',recordId:property.aduProject.id,year,field:'ownerFunding',severity:'info',explanation:'ADU funding assumes proportional sales of long-term brokerage holdings. Unknown account basis is estimated as zero, and realized losses receive no tax deduction, offset or carryforward benefit.',resolution:'Review the selected account and its investment cost basis before relying on the planning estimate.'});
    }
    const project=property.aduProject;if(project?.taxEstimation?.mode!=='simple')continue;
    completeHouseholdLiability=false;
    issues.push({code:'adu-planning-estimate',recordId:project.id,year,field:'taxEstimation',severity:'info',explanation:'ADU taxes use planning assumptions for unanswered rental, building-cost, financing and property-tax details. The known home value is retained until completion; no additional unfinished-construction market value is assumed.',resolution:'Review the editable assumptions in Advanced ADU details or choose detailed tax inputs.'});
  }
  const rsuIssues=rsuDeferredTaxIssues(plan,year);
  if(rsuIssues.length){issues.push(...rsuIssues);completeForModeledScope=false;completeHouseholdLiability=false;}
  return { completeForModeledScope, completeHouseholdLiability, issues };
}
