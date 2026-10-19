import {describe,expect,it} from 'vitest';
import type {Account,PlanDocument} from '../../src/engine/model/plan';
import {validatePlan} from '../../src/engine/validation';
import {makeAduPlan} from '../helpers/adu';

const broker:Account={id:'broker',name:'Saved brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:10_000_000,annualGrowthBps:0,openingIraBasis:{known:false}};
function document(basis:unknown,funding:unknown):PlanDocument {
 const source=makeAduPlan({accounts:[{...broker,...(basis===undefined?{}:{openingTaxableBasis:basis})} as Account]});
 return {...source,properties:source.properties.map(p=>({...p,aduProject:{...p.aduProject!,...(funding===undefined?{}:{ownerFunding:funding})}}))} as unknown as PlanDocument;
}
describe('brokerage construction funding inputs',()=>{
 it.each([undefined,{known:false},{known:true,value:0},{known:true,value:15_000_000}])('preserves optional or nonnegative basis even above market value: %j',basis=>{
  const result=validatePlan(document(basis,{kind:'taxable-brokerage',accountId:'broker'}));expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.plan.accounts[0]).toMatchObject(broker);expect((result.plan.accounts[0] as any).openingTaxableBasis).toEqual(basis);
  expect((result.plan.properties[0]!.aduProject as any).ownerFunding).toEqual({kind:'taxable-brokerage',accountId:'broker'});
 });
 it.each([{known:true,value:-1},{known:true,value:1.5},{known:false,value:0},{known:true},{known:'yes'},null])('rejects invalid brokerage basis: %j',basis=>{
  const result=validatePlan(document(basis,undefined));expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({recordId:'broker',field:expect.stringMatching(/^openingTaxableBasis/)}));
 });
 it('rejects brokerage basis on retirement accounts',()=>{
  const source=document({known:false},undefined),result=validatePlan({...source,accounts:[{...source.accounts[0]!,type:'traditional-ira'}]});
  expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({recordId:'broker',field:'openingTaxableBasis'}));
 });
 it.each([undefined,{kind:'household-cash'}])('retains household cash compatibility: %j',funding=>{
  const result=validatePlan(document(undefined,funding));expect(result.ok).toBe(true);if(result.ok)expect((result.plan.properties[0]!.aduProject as any).ownerFunding).toEqual(funding);
 });
 it.each([{kind:'other'},{kind:'taxable-brokerage'},{kind:'taxable-brokerage',accountId:'missing'},{kind:'household-cash',accountId:'broker'},null])('rejects invalid funding selection: %j',funding=>{
  const result=validatePlan(document(undefined,funding));expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({recordId:'adu-project',field:expect.stringMatching(/^ownerFunding/)}));
 });
 it.each(['traditional-ira','roth-ira','traditional-401k','roth-401k'])('keeps the dependency visible when a selected account becomes %s',type=>{
  const source=document(undefined,{kind:'taxable-brokerage',accountId:'broker'}),result=validatePlan({...source,accounts:[{...broker,type} as Account]});
  expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({recordId:'adu-project',field:'ownerFunding.accountId'}));
 });
 it('keeps the dependency visible when the selected account is deleted',()=>{
  const source=document(undefined,{kind:'taxable-brokerage',accountId:'broker'}),result=validatePlan({...source,accounts:[]});
  expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({recordId:'adu-project',field:'ownerFunding.accountId',code:'dangling-reference'}));
 });
});
