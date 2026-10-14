import type { Cents, Property } from '../model/plan';
import type { Available } from '../model/results';
import { CalculationRangeError, Decimal, settleCents } from '../money';

function missing(property:Property,field:string,explanation:string):Available<never> {
  return {status:'needs-data',issues:[{code:'required-adu-valuation',recordId:property.aduProject?.id??property.id,field,severity:'warning',explanation,resolution:'Enter the independent area and valuation assumption.'}]};
}
function money(property:Property,field:string,calculate:()=>Decimal):Available<Cents> {
  try{return {status:'available',value:settleCents(calculate())};}
  catch(error){if(!(error instanceof CalculationRangeError))throw error;return {status:'needs-data',issues:[{code:'monetary-overflow',recordId:property.aduProject?.id??property.id,field,severity:'warning',explanation:error.message,resolution:'Use amounts within the supported monetary range.'}]};}
}
export function calculateAduValueAdded(property:Property):Available<Cents> {
  const project=property.aduProject;if(!project)return missing(property,'aduProject','A completion valuation requires a project.');
  const valuation=project.valuation;
  if(valuation.kind==='value-added')return money(property,'valuation.valueAddedCents',()=>new Decimal(valuation.valueAddedCents));
  if(!Number.isFinite(property.aduArea)||!property.aduArea||property.aduArea<=0)return missing(property,'aduArea','Enter positive ADU living area in square feet.');
  return money(property,'valuation.valuePerSquareFootCents',()=>new Decimal(property.aduArea!).times(valuation.valuePerSquareFootCents));
}
export function aduAreaRatios(property:Property,combinedValue:Available<Cents>):{
  constructionCostPerSquareFootCents:Available<Cents>;valueAddedPerSquareFootCents:Available<Cents>;
  combinedValuePerSquareFootCents:Available<Cents>;existingWholePropertyValuePerSquareFootCents:Available<Cents>;
} {
  const area=property.aduArea,primary=property.primaryArea;
  const hasArea=typeof area==='number'&&Number.isFinite(area)&&area>0;
  const hasPrimary=typeof primary==='number'&&Number.isFinite(primary)&&primary>0;
  const areaMissing=missing(property,'aduArea','ADU living area is required for this ratio.');
  const primaryMissing=missing(property,'primaryArea','Primary-home living area is required for this ratio.');
  const added=calculateAduValueAdded(property);
  return {
    constructionCostPerSquareFootCents:!hasArea?areaMissing:!property.aduProject?missing(property,'aduProject','Declared staged costs are required.'):money(property,'costs',()=>property.aduProject!.costs.reduce((sum,row)=>sum.plus(row.amountCents),new Decimal(0)).div(area!)),
    valueAddedPerSquareFootCents:!hasArea?areaMissing:added.status!=='available'?added:money(property,'valuation',()=>new Decimal(added.value).div(area!)),
    combinedValuePerSquareFootCents:!hasPrimary?primaryMissing:!hasArea?areaMissing:combinedValue.status!=='available'?combinedValue:money(property,'combinedLivingAreaSqFt',()=>new Decimal(combinedValue.value).div(new Decimal(primary!).plus(area!))),
    existingWholePropertyValuePerSquareFootCents:!hasPrimary?primaryMissing:money(property,'primaryArea',()=>new Decimal(property.openingValueCents).div(primary!)),
  };
}
