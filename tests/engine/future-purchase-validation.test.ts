import {describe,expect,it} from 'vitest';
import {validatePlan} from '../../src/engine/validation';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';

const broker={id:'brokerage',name:'Purchase savings',ownerId:'owner-a',type:'taxable-brokerage' as const,openingBalanceCents:20_000_000,annualGrowthBps:0,openingIraBasis:{known:false as const}};
describe('future property purchase inputs',()=>{
 it('accepts a future acquisition and its purchase mortgage',()=>{
  expect(validatePlan(makeFuturePurchasePlan()).ok).toBe(true);
 });
 it('accepts an all-cash purchase outside the forecast without inventing a mortgage',()=>{
  expect(validatePlan(makeFuturePurchasePlan({}, {purchaseDate:'2040-01-02',downPaymentCents:80_000_000,loans:[]})).ok).toBe(true);
 });
 it('requires the down payment and acquisition mortgages to cover the purchase price',()=>{
  const result=validatePlan(makeFuturePurchasePlan({}, {loans:[]}));
  expect(result.ok).toBe(false);if(!result.ok)expect(result.issues).toContainEqual(expect.objectContaining({recordId:'future-home',field:'loans'}));
 });
 it('accepts a saved taxable brokerage as the down-payment source',()=>{
  const plan=makeFuturePurchasePlan({accounts:[broker]});
  const property={...plan.properties[0]!,purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}};
  expect(validatePlan({...plan,properties:[property]}).ok).toBe(true);
 });
 it.each(['missing','retirement'])('rejects an unavailable or incompatible source: %s',source=>{
  const plan=makeFuturePurchasePlan({accounts:[source==='retirement'?{...broker,type:'traditional-ira'}:broker]});
  const result=validatePlan({...plan,properties:[{...plan.properties[0]!,purchaseFunding:{kind:'taxable-brokerage',accountId:source==='missing'?'removed':'brokerage'}}]});
  expect(result.ok).toBe(false);if(!result.ok)expect(result.issues).toContainEqual(expect.objectContaining({recordId:'future-home',field:'purchaseFunding.accountId'}));
 });
 it('rejects a future refinance and a loan balance that already exists before purchase',()=>{
  const plan=makeFuturePurchasePlan(),property=plan.properties[0]!,loan=property.loans[0]!;
  for(const [changed,field] of [[{...loan,originationDate:'2027-07-01'},'originationDate'],[{...loan,openingBalance:{known:true as const,value:1}},'openingBalance']] as const){
   const result=validatePlan({...plan,properties:[{...property,loans:[changed]}]});
   expect(result.ok).toBe(false);if(!result.ok)expect(result.issues).toContainEqual(expect.objectContaining({recordId:loan.id,field}));
  }
 });
 it('validates the declared building share for purchase tax estimates',()=>{
  const plan=makeFuturePurchasePlan();
  for(const buildingShareBps of [-1,10001,8000.5]){
   const result=validatePlan({...plan,properties:[{...plan.properties[0]!,purchaseTaxEstimation:{mode:'simple',buildingShareBps}}]});
   expect(result.ok).toBe(false);if(!result.ok)expect(result.issues).toContainEqual(expect.objectContaining({field:'purchaseTaxEstimation.buildingShareBps'}));
  }
 });
});
