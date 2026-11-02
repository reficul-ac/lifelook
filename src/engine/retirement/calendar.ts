import type {ValidatedPlan} from '../model/plan';
import type {Available} from '../model/results';
declare const validatedRetirementCalendar:unique symbol;
export type ValidatedRetirementCalendar=Readonly<{startYear:number;endYear:2100;readonly [validatedRetirementCalendar]:true}>;
export function validateRetirementCalendar(source:ValidatedPlan,startYear:number):Available<ValidatedRetirementCalendar>{
 if(!Number.isInteger(startYear)||startYear<source.startYear||startYear>=source.startYear+source.horizonYears||startYear>2100)return {status:'needs-data',issues:[{code:'invalid-retirement-calendar',recordId:source.id,field:'retirementYear',severity:'warning',explanation:'Choose a working-forecast candidate year through 2100.',resolution:'Review the source forecast years.'}]};
 return {status:'available',value:{startYear,endYear:2100} as ValidatedRetirementCalendar};
}
