import {describe,expect,it} from 'vitest';
import {addSimpleAduFinancing,setAduCompletionDate,setSimpleAduLoanAmount} from '../../src/browser/adu-project-setup';
import type {PropertyDraftBundle} from '../../src/browser/adu-project-draft';
import {fromDraftValue,type RawObject} from '../../src/browser/state';

function fixture():PropertyDraftBundle {
 return {property:{id:'home',role:'primary-with-adu',aduProject:{id:'project',rentalId:'owned',completionDate:'2026-12-31',
  costs:[{id:'stage',paymentDate:'2026-12-31',amountCents:'300000.00',treatments:{federal:{known:true,value:{buildingBasisCents:'300000.00'}}}}],
  taxQualifications:{federal:{known:true,value:true}},propertyTax:{originalExpenseExcludesAdu:{known:true,value:true}},
 }},rentals:[{id:'owned',availableDate:'2027-01-01',rentStartDate:'2027-01-01'},{id:'unrelated',availableDate:'2027-01-01',rentStartDate:'2027-01-01'}],expenses:[{id:'expense',amountCents:'123.00'}]};
}
const project=(bundle:PropertyDraftBundle)=>bundle.property.aduProject as Record<string,any>;
function ids(){let count=0;return(kind:string)=>`${kind}-${++count}`;}

describe('simple ADU draft setup',()=>{
 it('creates one attributed loan draw with unanswered amounts and tax history',()=>{
  const source=fixture(),before=structuredClone(source),nextId=ids(),result=addSimpleAduFinancing(source,nextId),loan=project(result).financing;
  expect(loan).toMatchObject({id:expect.any(String),name:expect.any(String),aprBps:'',termMonths:'360',collateralPropertyId:'home',firstAmortizingPaymentMonth:'2027-01',draws:[{id:expect.any(String),month:'2026-12',amountCents:'',costAllocations:[{costId:'stage',amountCents:''}]}],interestTaxRows:[],proceedsHistoryComplete:{known:false},rentalInterestQualified:{known:false},financingAtRiskQualification:{known:false}});
  expect(loan.id).not.toBe(loan.draws[0].id);
  expect(project(result).costs).toEqual(project(source).costs);expect(source).toEqual(before);
  expect(addSimpleAduFinancing(result,nextId)).toBe(result);
 });

 it('retains entered loan amount text and IDs in its draw and cost attribution',()=>{
  const nextId=ids(),source=addSimpleAduFinancing(fixture(),nextId),before=structuredClone(source),originalLoan=project(source).financing;
  const result=setSimpleAduLoanAmount(source,'not an amount',nextId),loan=project(result).financing;
  expect(loan.id).toBe(originalLoan.id);expect(loan.draws[0].id).toBe(originalLoan.draws[0].id);
  expect(loan.draws[0].amountCents).toBe('not an amount');expect(loan.draws[0].costAllocations).toEqual([{costId:'stage',amountCents:'not an amount'}]);
  expect(project(result).costs).toEqual(project(source).costs);expect(source).toEqual(before);
  expect(project(setSimpleAduLoanAmount(fixture(),'100000.00',nextId)).financing.draws[0].amountCents).toBe('100000.00');
 });

 it('uses the retained date anchor when financing is selected during a blank completion edit',()=>{
  const source=setAduCompletionDate(fixture(),''),before=structuredClone(source),financed=addSimpleAduFinancing(source,ids());
  expect(project(financed).completionDate).toBe('');
  expect(project(financed).financing).toMatchObject({firstAmortizingPaymentMonth:'2027-01',draws:[{month:'2026-12'}]});
  const result=setAduCompletionDate(financed,'2027-08-15');
  expect(project(result).financing).toMatchObject({firstAmortizingPaymentMonth:'2027-09',draws:[{month:'2027-08'}]});
  expect(project(result).costs[0].paymentDate).toBe('2027-08-15');expect(source).toEqual(before);
 });

 it('leaves financing dates unanswered when invalid completion has no known anchor',()=>{
  const source=fixture();project(source).completionDate='bad';
  const before=structuredClone(source),result=addSimpleAduFinancing(source,ids());
  expect(project(result).completionDate).toBe('bad');
  expect(project(result).financing).toMatchObject({firstAmortizingPaymentMonth:'',draws:[{month:''}]});
  expect(source).toEqual(before);
 });

 it('moves unchanged completion defaults together and preserves all other records and answers',()=>{
  const source=addSimpleAduFinancing(fixture(),ids()),before=structuredClone(source),result=setAduCompletionDate(source,'2027-08-15');
  expect(project(result).completionDate).toBe('2027-08-15');expect(project(result).costs[0].paymentDate).toBe('2027-08-15');
  expect(result.rentals[0]).toMatchObject({availableDate:'2027-09-01',rentStartDate:'2027-09-01'});
  expect(project(result).financing).toMatchObject({firstAmortizingPaymentMonth:'2027-09',draws:[{month:'2027-08'}]});
  expect(project(result).costs[0].treatments).toEqual(project(source).costs[0].treatments);
  expect(project(result).taxQualifications).toEqual(project(source).taxQualifications);expect(project(result).propertyTax).toEqual(project(source).propertyTax);
  expect(result.rentals[1]).toBe(source.rentals[1]);expect(result.expenses).toBe(source.expenses);expect(source).toEqual(before);
 });

 it('preserves individually customized dates while moving the remaining defaults',()=>{
  const source=addSimpleAduFinancing(fixture(),ids()),owned=project(source);
  owned.costs[0].paymentDate='2026-11-01';owned.financing.draws[0].month='2026-11';owned.financing.firstAmortizingPaymentMonth='2027-06';
  (source.rentals[0] as Record<string,unknown>).availableDate='2027-03-15';
  const before=structuredClone(source),result=setAduCompletionDate(source,'2027-08-15');
  expect(project(result).costs[0].paymentDate).toBe('2026-11-01');expect(project(result).financing).toEqual(owned.financing);
  expect(result.rentals[0]).toMatchObject({availableDate:'2027-03-15',rentStartDate:'2027-09-01'});expect(source).toEqual(before);
 });

 it.each(['2027-','2027-02-29','bad'])('retains incomplete or invalid completion text without propagating %s',date=>{
  const source=addSimpleAduFinancing(fixture(),ids()),before=structuredClone(source),result=setAduCompletionDate(source,date);
  const {__draft,...entered}=project(result);
  expect(entered).toEqual({...project(source),completionDate:date});expect(result.rentals).toBe(source.rentals);expect(source).toEqual(before);
 });

 it('moves generated dates after a native date edit emits blank and incomplete text',()=>{
  const source=addSimpleAduFinancing(fixture(),ids()),before=structuredClone(source),blank=setAduCompletionDate(source,''),blankBefore=structuredClone(blank);
  const incomplete=setAduCompletionDate(blank,'2027-'),result=setAduCompletionDate(incomplete,'2027-08-15');
  expect(project(blank).completionDate).toBe('');expect(project(incomplete).completionDate).toBe('2027-');
  expect(project(result).costs[0].paymentDate).toBe('2027-08-15');expect(result.rentals[0]).toMatchObject({availableDate:'2027-09-01',rentStartDate:'2027-09-01'});
  expect(project(result).financing).toMatchObject({firstAmortizingPaymentMonth:'2027-09',draws:[{month:'2027-08'}]});
  expect(blank).toEqual(blankBefore);expect(source).toEqual(before);
  const decoded=fromDraftValue(result as unknown as RawObject,'home');
  expect((decoded.value.property as RawObject).aduProject).not.toHaveProperty('__draft');
 });

 it('preserves customized schedules when correcting an intermediate blank completion',()=>{
  const source=addSimpleAduFinancing(fixture(),ids()),owned=project(source);
  owned.costs[0].paymentDate='2026-11-01';owned.financing.draws[0].month='2026-11';owned.financing.firstAmortizingPaymentMonth='2027-06';
  (source.rentals[0] as RawObject).availableDate='2027-03-15';
  const before=structuredClone(source),result=setAduCompletionDate(setAduCompletionDate(source,''),'2027-08-15');
  expect(project(result).costs[0].paymentDate).toBe('2026-11-01');expect(project(result).financing).toEqual(owned.financing);
  expect(result.rentals[0]).toMatchObject({availableDate:'2027-03-15',rentStartDate:'2027-09-01'});expect(source).toEqual(before);
 });

 it('preserves staged costs and complex existing loan schedules',()=>{
  for(const kind of ['multiple-costs','multiple-draws','multiple-allocations','interest-rows']){
   const source=addSimpleAduFinancing(fixture(),ids()),owned=project(source);
   if(kind==='multiple-costs')owned.costs.push({...owned.costs[0],id:'second-stage'});
   if(kind==='multiple-draws')owned.financing.draws.push({...owned.financing.draws[0],id:'second-draw'});
   if(kind==='multiple-allocations')owned.financing.draws[0].costAllocations.push({costId:'other-stage',amountCents:'100.00'});
   if(kind==='interest-rows')owned.financing.interestTaxRows.push({id:'interest',month:'2026-12',treatments:{federal:{known:false}}});
   const before=structuredClone(source),result=setAduCompletionDate(source,'2027-08-15');
   expect(project(result).financing).toEqual(owned.financing);expect(setSimpleAduLoanAmount(source,'200000.00',ids())).toBe(source);
   if(kind==='multiple-costs')expect(project(result).costs).toBe(owned.costs);
   expect(source).toEqual(before);
  }
 });

 it('leaves a missing project and a multistage project without a new simple loan',()=>{
  const empty:PropertyDraftBundle={property:{id:'home'},rentals:[],expenses:[]};
  expect(setAduCompletionDate(empty,'2027-08-15')).toBe(empty);expect(addSimpleAduFinancing(empty,ids())).toBe(empty);expect(setSimpleAduLoanAmount(empty,'100.00',ids())).toBe(empty);
  const source=fixture();project(source).costs.push({...project(source).costs[0],id:'second-stage'});
  expect(addSimpleAduFinancing(source,ids())).toBe(source);
 });
});
