import Decimal from 'decimal.js';
import {calendarDate,daysInMonth,isValidISODate,parseISODate} from '../../engine/dates';
import {element,parseMoneyInput,renderField,renderHistory,renderRows,valueAt,type FieldContext,type FieldPath} from '../fields';
import type {RawObject,WorkspaceController} from '../state';

function grantId(controller:WorkspaceController,context:FieldContext):string {
  const used=new Set<string>();
  const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;if('id' in value&&typeof value.id==='string')used.add(value.id);Object.values(value).forEach(visit);};
  visit(controller.getState().savedPlan);visit(controller.getState().drafts);visit(context.draft.value);
  let index=1;while(used.has(`${context.draft.recordId}-grant-${index}`))index++;
  return `${context.draft.recordId}-grant-${index}`;
}
export function newRsuGrant(controller:WorkspaceController,context:FieldContext):RawObject {
  return {id:grantId(controller,context),name:'Initial award',startDate:`${controller.getState().savedPlan.startYear}-01-01`,grantValueCents:'0.00',grantSharePriceCents:'0.00',vestingMonths:'48',vestingFrequency:'monthly',cliffMonths:'0',withholdingBps:'0.00',taxTreatment:'settle-at-vest',openingHeldShares:'0',openingBasis:{known:true,value:'0.00'}};
}
export function changeAccountType(controller:WorkspaceController,context:FieldContext,type:unknown):void {
  const value:RawObject={...context.draft.value,type};
  if(type==='rsu'){
    value.openingBalanceCents='0.00';value.openingIraBasis={known:false};
    value.rsu??={employerId:'',currentSharePriceCents:'0.00',grants:[newRsuGrant(controller,context)]};
  }else delete value.rsu;
  context.onChange([],value);
}
function awardedShares(grant:RawObject):string {
  if(grant.awardedShares!==undefined){const override=String(grant.awardedShares);return /^\d+(?:\.\d{1,6})?$/.test(override)&&new Decimal(override).isPositive()?new Decimal(override).toFixed().replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):'Unavailable';}
  const amount=parseMoneyInput(String(grant.grantValueCents??'')),price=parseMoneyInput(String(grant.grantSharePriceCents??''));
  if(amount.status!=='available'||price.status!=='available'||amount.value<=0||price.value<=0)return 'Enter a positive grant value and share price';
  return new Decimal(amount.value).div(price.value).toDecimalPlaces(6).toFixed();
}
function finalVest(grant:RawObject):string|undefined {
  const date=grant.startDate,term=Number(grant.vestingMonths);
  if(!isValidISODate(date)||!/^\d+$/.test(String(grant.vestingMonths))||!Number.isInteger(term)||term<1||term>600)return undefined;
  const {year,month,day}=parseISODate(date),end=year*12+month-1+term,endYear=Math.floor(end/12);
  return endYear<=9999?calendarDate(endYear,end%12+1,day):undefined;
}
function renderGrantPreview(root:HTMLElement,context:FieldContext,path:FieldPath,startYear:number):void {
  const summary=element('p');summary.dataset.rsuGrantPreview='';root.append(summary);
  const update=()=>{const grant=valueAt(context.draft.value,path) as RawObject,end=finalVest(grant);let years='Unavailable';if(end){const {year,month,day}=parseISODate(end);years=Math.max(0,((year-startYear)*12+month-1+(day-1)/daysInMonth(year,month))/12).toFixed(2);}
    summary.textContent=`Awarded shares: ${awardedShares(grant)} · Final vest date: ${end??'Unavailable'} · Years left at forecast start: ${years}`;};
  root.addEventListener('input',update);root.addEventListener('change',update);update();
}
export function renderRsuFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
  const startYear=controller.getState().savedPlan.startYear;
  renderField(root,context,['rsu','employerId'],'RSU employer ID',{hint:'Use the same employer ID as this owner’s salary when both come from the same employer.'});
  renderField(root,context,['rsu','currentSharePriceCents'],'Current share price ($)',{kind:'money',hint:`Assumed on Jan 1, ${startYear}. Grant prices determine awarded shares independently.`});
  renderField(root,context,['annualGrowthBps'],'Effective annual share price growth (%)',{kind:'rate',hint:'Price growth changes held asset value without generating cash.'});
  renderRows(root,context,['rsu','grants'],'RSU grant',()=>newRsuGrant(controller,context),(body,path)=>{
    renderField(body,context,[...path,'name'],'Grant name');renderField(body,context,[...path,'startDate'],'Vesting start date',{kind:'date',hint:'First vest occurs after the first monthly, quarterly or annual interval.'});
    renderField(body,context,[...path,'grantValueCents'],'Grant value ($)',{kind:'money'});renderField(body,context,[...path,'grantSharePriceCents'],'Grant share price ($)',{kind:'money',hint:'Award reference price; this is not an exercise price.'});
    const awarded=renderField(body,context,[...path,'awardedShares'],'Actual awarded shares (optional)',{optional:true,hint:'Blank uses grant value ÷ grant share price. Enter up to 6 decimal places.'});if(awarded instanceof HTMLInputElement)awarded.inputMode='decimal';
    renderField(body,context,[...path,'vestingMonths'],'Vesting term (months)',{kind:'integer',hint:'12 months = 1 year; 48 months = 4 years.'});
    renderField(body,context,[...path,'vestingFrequency'],'Vesting frequency',{kind:'select',options:[{value:'monthly',label:'Monthly'},{value:'quarterly',label:'Quarterly'},{value:'annual',label:'Annual'}]});
    renderField(body,context,[...path,'cliffMonths'],'Cliff (months)',{kind:'integer',hint:'0 means no cliff. A cliff catches up earned shares on its date.'});
    renderField(body,context,[...path,'withholdingBps'],'Shares sold for withholding (%)',{kind:'rate',hint:'0–100%. A withholding assumption, not a tax rate; sold shares fund modeled taxes.'});
    renderField(body,context,[...path,'taxTreatment'],'Settlement treatment',{kind:'select',options:[{value:'settle-at-vest',label:'Shares delivered at vest'},{value:'deferred',label:'Deferred settlement'}],hint:'Deferred settlement retains the service vesting schedule, while household tax and cash forecasts are unsupported.'});
    const held=renderField(body,context,[...path,'openingHeldShares'],'Opening held shares',{hint:`Actual net shares remaining immediately before Jan 1, ${startYear}; prior vesting is not reconstructed.`});if(held instanceof HTMLInputElement)held.inputMode='decimal';
    renderHistory(body,context,[...path,'openingBasis'],'Opening held-share basis ($)',{kind:'money',hint:'Unknown basis still permits held-value forecasts. Enter 0 only if confirmed.'});
    renderGrantPreview(body,context,path,startYear);
  });
  const assumptions=element('details');assumptions.append(element('summary','RSU valuation and tax assumptions'),element('p','Delivered stock creates compensation and held assets without creating spendable wage cash. Shares sold for withholding offset the modeled tax reserve; final federal, California and employee payroll liability uses combined salary and RSU wages.'),element('p','The withholding percentage is a withholding assumption, not a tax rate. Sale proceeds are valued at the vest price with no transaction fee or capital gain. Vesting and withholding use fractional-share estimates; actual broker rounding may differ. Remaining unvested and deferred unsettled shares are excluded from available assets.'),element('p','The reserve plans assessed liability; it does not forecast actual payroll remittances or refund dates.'),element('p','The share price grows from January 1 of the forecast start year, including before future grants start. Later discretionary sales and deferred-settlement tax timing are outside this forecast.'));
  for(const [label,url] of [['IRS RSU audit guide','https://www.irs.gov/pub/irs-pdf/p5992.pdf'],['IRS employee withholding guidance','https://www.irs.gov/publications/p15'],['IRS deferred compensation payroll guidance','https://www.irs.gov/publications/p15a'],['California equity compensation guidance','https://www.ftb.ca.gov/forms/misc/1004.html']]){const link=element('a',label);link.href=url!;link.target='_blank';link.rel='noopener noreferrer';assumptions.append(link,element('br'));}root.append(assumptions);
}
