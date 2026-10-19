import type {Available,BasisPoints,Cents,Issue} from '../engine';
import {MAX_CENTS} from '../engine/money';
function parseUnits(text:string,limit:number,label:string):Available<number>{
  const trimmed=text.trim();
  const issue:Issue={code:'invalid-input',field:label,severity:'error',explanation:`Enter ${label} as an ordinary decimal with at most two decimal places; blank is unknown.`,resolution:'Use digits and an optional decimal point, without exponents or separators.'};
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(trimmed))return {status:'needs-data',issues:[issue]};
  const negative=trimmed.startsWith('-'),unsigned=negative?trimmed.slice(1):trimmed,[whole='',fraction='']=unsigned.split('.');
  const exact=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(exact>BigInt(limit))return {status:'needs-data',issues:[{...issue,explanation:`This ${label} exceeds the supported input range.`}]};
  return {status:'available',value:Number(negative?-exact:exact)};
}
export const parseMoneyInput=(text:string):Available<Cents>=>parseUnits(text,MAX_CENTS,'money');
export const parseRateInput=(text:string):Available<BasisPoints>=>parseUnits(text,100000,'rate');
