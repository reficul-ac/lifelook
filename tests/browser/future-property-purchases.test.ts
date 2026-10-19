import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,getByLabelText,getByRole,within} from '@testing-library/dom';
import {unmountApp} from '../../src/browser/main';
import {resolveIssueTargets} from '../../src/browser/issue-presentation';
import {mountWorkspace,setField} from '../helpers/dom';
import {makePlan} from '../helpers/plans';

function open(){
 const mounted=mountWorkspace(makePlan({startYear:2027,horizonYears:4,openingCashCents:50_000_000,accounts:[{id:'broker',name:'Standard brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:50_000_000,annualGrowthBps:0,openingIraBasis:{known:false},openingTaxableBasis:{known:true,value:30_000_000}},{id:'ira',name:'Retirement savings',ownerId:'owner-a',type:'traditional-ira',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}]}));
 fireEvent.click(getByRole(mounted.root,'button',{name:'Properties'}));fireEvent.click(getByRole(mounted.root,'button',{name:'Add property'}));
 const id=Object.values(mounted.controller.getState().drafts).find(draft=>draft.section==='properties')!.recordId;
 const form=()=>mounted.root.querySelector<HTMLElement>(`form[data-record-id="${id}"]`)!;
 return {...mounted,id,form};
}
function future(){const mounted=open();setField(mounted.form(),'Purchase date','2029-01-02');setField(mounted.form(),'Purchase price ($)','800000.00');setField(mounted.form(),'Down payment ($)','160000.00');return mounted;}
afterEach(()=>{for(const root of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(root);document.body.replaceChildren();});

describe('future property purchase setup',()=>{
 it('defaults purchase-date market value to price and preserves an entered valuation',()=>{
  const {form,controller,id}=future();
  expect(getByLabelText(form(),'Property market value at purchase ($)')).toHaveValue('800000.00');
  setField(form(),'Purchase price ($)','825000.00');expect(getByLabelText(form(),'Property market value at purchase ($)')).toHaveValue('825000.00');
  setField(form(),'Property market value at purchase ($)','850000.00');setField(form(),'Purchase price ($)','830000.00');
  expect(getByLabelText(form(),'Property market value at purchase ($)')).toHaveValue('850000.00');
  expect(controller.getState().drafts[id]!.value.property).toMatchObject({purchaseDate:'2029-01-02',openingValueCents:'850000.00'});
  expect(form()).not.toHaveTextContent('must exist by Jan 1');
 });
 it('offers taxable down-payment sources and preserves the property while editing account basis',()=>{
  const {root,form,controller,id}=future();const source=getByLabelText(form(),'Pay down payment from');
  expect(within(source).getByRole('option',{name:'Standard brokerage'})).toBeInTheDocument();expect(within(source).queryByRole('option',{name:'Retirement savings'})).toBeNull();
  setField(form(),'Property name','Long Beach Rental');setField(form(),'Pay down payment from','broker');
  fireEvent.click(getByRole(form(),'button',{name:'Edit account cost basis'}));
  const account=root.querySelector<HTMLElement>('form[data-record-id="broker"]')!;
  expect(getByLabelText(account,'Investment cost basis at forecast start ($) history')).toHaveFocus();
  expect(controller.getState().drafts[id]!.value.property).toMatchObject({name:'Long Beach Rental',purchaseFunding:{kind:'taxable-brokerage',accountId:'broker'}});
  fireEvent.click(getByRole(root,'button',{name:'Properties'}));expect(getByLabelText(form(),'Pay down payment from')).toHaveValue('broker');expect(getByLabelText(form(),'Purchase price ($)')).toHaveValue('800000.00');
 });
 it('starts a new rental, mortgage and expenses at the future purchase rather than forecast start',()=>{
  const {form,controller,id}=future();setField(form(),'Property role','rental');
  expect(getByLabelText(form(),'Monthly rent receipts ($)')).toBeVisible();expect(getByLabelText(form(),'Available for rent date')).toHaveValue('2029-01-02');expect(getByLabelText(form(),'Lease income start date')).toHaveValue('2029-01-02');
  expect(getByLabelText(form(),'Purchase tax calculation')).toHaveValue('simple');expect(getByLabelText(form(),'Estimated building share (%)')).toHaveValue('80.00');
  fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));
  expect(getByLabelText(form(),'Mortgage amount ($)')).toHaveValue('640000.00');expect(getByLabelText(form(),'First payment date')).toHaveValue('2029-02-28');expect(getByLabelText(form(),'Mortgage APR (%)')).toBeVisible();expect(getByLabelText(form(),'Mortgage term (months)')).toHaveValue('360');
  fireEvent.click(getByRole(form(),'button',{name:'Add property expense'}));expect(getByLabelText(form(),'Property expense start date')).toHaveValue('2029-01-02');
  const draft=controller.getState().drafts[id]!.value as any;expect(draft.property.loans[0]).toMatchObject({originationDate:'2029-01-02',acquisitionDate:'2029-01-02'});expect(draft.rentals).toHaveLength(1);expect(draft.rentals[0].taxHistory.federal).toEqual({known:false});
 });
 it('updates purchase defaults when closing moves while preserving a separately entered lease start',()=>{
  const {form,controller,id}=future();setField(form(),'Property role','rental');fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));fireEvent.click(getByRole(form(),'button',{name:'Add property expense'}));
  setField(form(),'Lease income start date','2029-06-01');setField(form(),'Purchase date','2029-02-20');
  expect(getByLabelText(form(),'Available for rent date')).toHaveValue('2029-02-20');expect(getByLabelText(form(),'Lease income start date')).toHaveValue('2029-06-01');expect(getByLabelText(form(),'First payment date')).toHaveValue('2029-03-31');expect(getByLabelText(form(),'Property expense start date')).toHaveValue('2029-02-20');
  expect((controller.getState().drafts[id]!.value as any).property.loans[0].originationDate).toBe('2029-02-20');
 });
 it('routes a funding-source validation issue to the source picker on an unsaved property',()=>{
  const {form,controller,id}=future();setField(form(),'Pay down payment from','broker');
  const targets=resolveIssueTargets({code:'invalid-input',recordId:id,field:'purchaseFunding.accountId',severity:'error',explanation:'Choose a taxable brokerage.',resolution:'Review the funding source.'},controller.getState());
  expect(targets).toMatchObject([{section:'Properties',recordId:id,field:'property.purchaseFunding'}]);
 });
 it('keeps the calculated mortgage in sync through incomplete price edits without replacing a manual principal',()=>{
  const {form}=future();fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));
  setField(form(),'Purchase price ($)','');setField(form(),'Purchase price ($)','900000.00');expect(getByLabelText(form(),'Mortgage amount ($)')).toHaveValue('740000.00');expect(getByLabelText(form(),'Property market value at purchase ($)')).toHaveValue('900000.00');
  setField(form(),'Mortgage amount ($)','700000.00');setField(form(),'Purchase price ($)','950000.00');expect(getByLabelText(form(),'Mortgage amount ($)')).toHaveValue('700000.00');
 });
 it('allows the suggested rental unit to be removed and added again',()=>{
  const {form,controller,id}=future();setField(form(),'Property role','rental');
  fireEvent.click(getByRole(form(),'button',{name:'Remove rental unit'}));expect((controller.getState().drafts[id]!.value.rentals as unknown[])).toHaveLength(0);
  fireEvent.click(getByRole(form(),'button',{name:'Add rental unit'}));expect(getByLabelText(form(),'Available for rent date')).toHaveValue('2029-01-02');expect((controller.getState().drafts[id]!.value.rentals as unknown[])).toHaveLength(1);
 });
 it.each([['2027-01-01','2027-02-28'],['2026-12-15','2027-01-31']])('moves generated purchase dates back to %s without leaving the mortgage in the future',(date,firstPayment)=>{
  const {form,controller,id}=future();setField(form(),'Property role','rental');fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));fireEvent.click(getByRole(form(),'button',{name:'Add property expense'}));
  setField(form(),'Lease income start date','2029-06-01');setField(form(),'Purchase date',date);
  const draft=controller.getState().drafts[id]!.value as any;
  expect(draft.property.loans[0]).toMatchObject({originationDate:date,acquisitionDate:date,firstPaymentDate:firstPayment});expect(draft.rentals[0]).toMatchObject({availableDate:date,rentStartDate:'2029-06-01'});expect(draft.expenses[0].startDate).toBe(date);
 });
 it('preserves a separately entered first payment when purchase moves back to forecast start',()=>{
  const {form,controller,id}=future();fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));setField(form(),'First payment date','2030-01-31');setField(form(),'Purchase date','2027-01-01');
  expect((controller.getState().drafts[id]!.value as any).property.loans[0]).toMatchObject({originationDate:'2027-01-01',acquisitionDate:'2027-01-01',firstPaymentDate:'2030-01-31'});
 });
 it('preserves saved historical mortgage dates while correcting an old property purchase date',()=>{
  const {form,controller,id}=open();setField(form(),'Purchase date','2020-01-01');setField(form(),'Purchase price ($)','800000.00');setField(form(),'Down payment ($)','160000.00');fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));fireEvent.click(getByRole(form(),'button',{name:'Save property'}));
  expect(controller.getState().savedPlan.properties).toHaveLength(1);
  setField(form(),'Purchase date','2021-01-01');expect((controller.getState().drafts[id]!.value as any).property.loans[0]).toMatchObject({originationDate:'2020-01-01',acquisitionDate:'2020-01-01',firstPaymentDate:'2027-01-31'});
 });
 it('moves an unsaved mortgage created before selecting a future closing date',()=>{
  const {form,controller,id}=open();setField(form(),'Purchase date','2020-01-01');setField(form(),'Purchase price ($)','800000.00');setField(form(),'Down payment ($)','160000.00');fireEvent.click(getByRole(form(),'button',{name:'Add loan'}));
  setField(form(),'Purchase date','2029-01-02');expect((controller.getState().drafts[id]!.value as any).property.loans[0]).toMatchObject({originationDate:'2029-01-02',acquisitionDate:'2029-01-02',firstPaymentDate:'2029-02-28'});
 });
});
