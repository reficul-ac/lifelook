import type {Issue} from '../engine';
import {Decimal} from '../engine/money';
import {parseMoneyInput,parseRateInput} from './input-parsers';
import type {RawObject} from './state';
const moneyHistories=new Set(['openingIraBasis','openingTaxableBasis','openingBalance','openingPayment','openingBasis','conversionBuildingFmv','priorYearWagesCents','qualifiedPrincipalCents','wagesCents','ubiaCents','addedAssessedValueCents','valueCents']);
const rateHistories=new Set(['marginalRateBps']);
const decimalUnits=(value:number)=>{const sign=value<0?'-':'';const digits=String(Math.abs(value));return `${sign}${digits.length<3?'0':digits.slice(0,-2)}.${digits.slice(-2).padStart(2,'0')}`;};
/** Stored integers become entered dollars/percentages; histories retain explicit unknowns. */
export function toDraftValue(value:unknown,key='',historyKey=''):any {
  if(typeof value==='number')return key.endsWith('Cents')||key.endsWith('Bps')||key==='value'&&(moneyHistories.has(historyKey)||rateHistories.has(historyKey))?decimalUnits(value):String(value);
  if(Array.isArray(value))return value.map(row=>toDraftValue(row,key,historyKey));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,entry])=>[field,toDraftValue(entry,field,key)]));
  return value;
}
function decode(value:unknown,issues:Issue[],recordId:string,path:string,key='',historyKey=''):unknown {
  if(Array.isArray(value))return value.map((row,i)=>decode(row,issues,recordId,`${path}.${i}`,key,historyKey));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([field])=>field!=='__draft').map(([field,entry])=>[field,decode(entry,issues,recordId,path?`${path}.${field}`:field,field,key)]));
  if(typeof value!=='string')return value;
  const isMoney=key.endsWith('Cents')||key==='value'&&moneyHistories.has(historyKey),isRate=key.endsWith('Bps')||key==='value'&&rateHistories.has(historyKey);
  const integers=new Set(['year','startYear','horizonYears','raiseMonth','raiseDay','priority','termMonths','vestingMonths','cliffMonths','numerator','denominator','baselineYear','completedValueEnrollmentYear']);
  const parser=isMoney?parseMoneyInput:isRate?parseRateInput:undefined;
  if(parser){const result=parser(value);if(result.status==='available')return result.value;issues.push(...result.issues.map(issue=>({...issue,recordId,field:path})));return value;}
  if(key==='awardedShares'||key==='openingHeldShares'){
    const entered=value.trim(),number=Number(entered);
    if(/^-?\d+(?:\.\d{1,6})?$/.test(entered)&&Number.isFinite(number)&&new Decimal(entered).abs().lte(Number.MAX_SAFE_INTEGER)&&new Decimal(entered).eq(new Decimal(number)))return number;
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter a finite ordinary share quantity with at most six decimal places; blank is unknown.',resolution:'Use digits and an optional decimal point, without exponents or separators, within the supported share range.'});return value;
  }
  if(key==='primaryArea'||key==='aduArea'){
    if(/^-?\d+(?:\.\d+)?$/.test(value.trim())&&Number.isFinite(Number(value)))return Number(value);
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter living area as an ordinary finite decimal; blank is unknown.',resolution:'Enter the measured living area without exponents or separators.'});return value;
  }
  if(integers.has(key)){
    if(/^-?\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value)))return Number(value);
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter a whole number; a blank value is unknown, not zero.',resolution:'Enter a valid whole number before saving.'});
  }
  return value;
}
export function fromDraftValue(value:RawObject,recordId:string):Readonly<{value:RawObject;issues:readonly Issue[]}>{const issues:Issue[]=[];return {value:decode(value,issues,recordId,'') as RawObject,issues};}
