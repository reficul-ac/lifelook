import { parseISODate } from '../dates';
import { CalculationRangeError, Decimal, settleCents } from '../money';
import type { Cents, RentalBookState, RentalUnit, TaxBook } from '../model/plan';
import type { Available } from '../model/results';
import type { YearRules } from '../rules/types';
import { aduPlanningProvenance } from '../rules/adu-planning-v1';
import { calculateDepreciation } from './depreciation';
import type { DepreciationYear } from './depreciation';
export interface AduDepreciationYear extends DepreciationYear {readonly monthlyDepreciationCents:readonly Cents[]}
export function calculateAduDepreciation(input:{unit:RentalUnit;year:number;book:TaxBook;opening:Available<RentalBookState>;rules:YearRules}):Available<AduDepreciationYear> {
  const {unit,year,book,opening,rules}=input;
  if(opening.status!=='available')return opening;
  const ready=parseISODate(unit.availableDate);
  if(year<ready.year)return {status:'available',value:{rentalId:unit.id,year,book,recoveryBasisCents:opening.value.recoveryBasisCents,openingAdjustedBuildingBasisCents:opening.value.adjustedBuildingBasisCents,depreciationCents:0,monthsRecovered:0,closing:{...opening.value},monthlyDepreciationCents:Array.from({length:12},()=>0),provenance:aduPlanningProvenance(year)[0]!}};
  const method=rules[book.startsWith('california')?'california':'federal']?.rental;
  const fail=(status:'needs-data'|'unsupported-case',code:string,explanation:string):Available<never>=>({status,issues:[{code,recordId:unit.id,year,field:`taxHistory.${book}`,severity:'warning',explanation,resolution:'Confirm the supported new-asset ordinary 330-month, mid-month recovery method and basis.'}]});
  if(!method||method.recoveryPeriodMonths===undefined||method.convention===undefined)return fail('needs-data','required-adu-depreciation-method','The applicable recovery method is unknown.');
  if(method.recoveryPeriodMonths!==330||method.convention!=='mid-month'||unit.convertedFromPersonalUse)return fail('unsupported-case','unsupported-adu-depreciation-method','This new-asset method supports ordinary 330-month mid-month recovery only.');
  try {
    const supported=calculateDepreciation(unit,year,book,opening,rules);if(supported.status!=='available')return supported;
    const basis=opening.value.recoveryBasisCents,start=ready.year*12+ready.month-1;
    const unitsAt=(boundary:number):number=>Math.max(0,Math.min(660,2*(boundary-start)-1));
    const cumulative=(boundary:number):Cents=>settleCents(new Decimal(basis).times(unitsAt(boundary)).div(660));
    const monthly=Array.from({length:12},(_,index)=>settleCents(new Decimal(cumulative(year*12+index+1)).minus(cumulative(year*12+index))));
    const depreciationCents=settleCents(monthly.reduce((sum,cents)=>sum.plus(cents),new Decimal(0)));
    return {status:'available',value:{...supported.value,depreciationCents,monthsRecovered:(unitsAt((year+1)*12)-unitsAt(year*12))/2,monthlyDepreciationCents:monthly,
      closing:{...opening.value,adjustedBuildingBasisCents:settleCents(new Decimal(basis).minus(cumulative((year+1)*12))),cumulativeDepreciationCents:cumulative((year+1)*12)},
      provenance:{...supported.value.provenance,ruleVersion:ADU_METHOD_VERSION,sources:[...new Set([...supported.value.provenance.sources,'https://uscode.house.gov/us/usc/119-118/t26/s168/'])]},
    }};
  } catch(error){if(!(error instanceof CalculationRangeError))throw error;return fail('needs-data','monetary-overflow',error.message);}
}
const ADU_METHOD_VERSION='adu-construction.1';
