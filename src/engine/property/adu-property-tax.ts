import {CalculationRangeError,Decimal,settleCents} from '../money';
import type {AduTaxPayment,Cents,Property,YearMonth} from '../model/plan';
import type {Available} from '../model/results';
import {maxAssessmentGrowthBps} from '../rules/adu-planning-v1';
export function estimateAduPropertyTax(property:Property,year:number):Available<{assessedValueCents:Cents;recurringAnnualTaxCents:Cents}> {
  const project=property.aduProject;
  const fail=(status:'needs-data'|'unsupported-case',code:string,field:string,explanation:string):Available<never>=>({status,issues:[{code,recordId:project?.id??property.id,year,field,severity:'warning',explanation,resolution:'Enter the relevant independent assessment, marginal rate and supported growth assumption; planned payments are separate.'}]});
  if(!project)return fail('needs-data','required-adu-project','aduProject','An assessment estimate requires a project.');
  const tax=project.propertyTax;
  if(maxAssessmentGrowthBps.value===undefined)return fail('needs-data','required-assessment-growth-rule','propertyTax.annualAssessmentGrowthBps','The applicable maximum assessment growth rule is unavailable.');
  if(tax.annualAssessmentGrowthBps<0||tax.annualAssessmentGrowthBps>maxAssessmentGrowthBps.value)return fail('unsupported-case','unsupported-assessment-growth','propertyTax.annualAssessmentGrowthBps','The assessment growth assumption exceeds the ordinary sourced maximum.');
  const jan1=`${year}-01-01`;
  if(year<tax.completedValueEnrollmentYear&&jan1<project.constructionStartDate)return {status:'available',value:{assessedValueCents:0,recurringAnnualTaxCents:0}};
  const assessment=year>=tax.completedValueEnrollmentYear?tax.addedAssessedValueCents:tax.constructionAssessments.find(row=>row.year===year)?.valueCents;
  if(!assessment?.known)return fail('needs-data','required-adu-assessment',year>=tax.completedValueEnrollmentYear?'propertyTax.addedAssessedValueCents':'propertyTax.constructionAssessments','The relevant completed or January 1 progress assessment is unknown.');
  if(!tax.marginalRateBps.known&&assessment.value!==0)return fail('needs-data','required-adu-property-tax-rate','propertyTax.marginalRateBps','The marginal tax rate is unknown.');
  try{
    const exact=year>=tax.completedValueEnrollmentYear?new Decimal(assessment.value).times(new Decimal(1).plus(new Decimal(tax.annualAssessmentGrowthBps).div(10000)).pow(year-tax.completedValueEnrollmentYear)):new Decimal(assessment.value);
    const assessedValueCents=settleCents(exact);
    const recurringAnnualTaxCents=settleCents(new Decimal(assessedValueCents).times(tax.marginalRateBps.known?tax.marginalRateBps.value:0).div(10000).plus(tax.additionalAnnualChargesCents));
    return {status:'available',value:{assessedValueCents,recurringAnnualTaxCents}};
  }catch(error){if(!(error instanceof CalculationRangeError))throw error;return fail('needs-data','monetary-overflow','propertyTax',error.message);}
}
/** A planning row is an input suggestion, never a tax deduction or a bill-timing inference. */
export function planAduTaxPayment(_property:Property,_year:number,month:YearMonth,kind:AduTaxPayment['kind'],amountCents:Cents,id:string):AduTaxPayment {
  return {id,month,kind,amountCents,treatments:{federal:{known:false},california:{known:false},'federal-amt':{known:false},'california-amt':{known:false}}};
}
