import {setField,getByRole} from '../helpers/property-editor';
import {applyEdit,openRecord} from '../helpers/workspace-ui';
import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,getByLabelText,queryByLabelText,within} from '@testing-library/dom';
import type {Account,AduProject} from '../../src/engine/model/plan';
import {unmountApp} from '../../src/browser/main';
import {mountWorkspace} from '../helpers/dom';
import {prepareEdit} from '../../src/browser/state';
import {makeAduPlan} from '../helpers/adu';

const broker:Account={id:'broker',name:'Build investments',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:50_000_000,annualGrowthBps:0,openingIraBasis:{known:false}};
const retirement:Account={...broker,id:'ira',name:'Retirement savings',type:'traditional-ira'};


function open(account:Account=broker,project:Partial<AduProject>={}){
 const mounted=mountWorkspace(makeAduPlan({horizonYears:1,accounts:[account,retirement]},project));
 openRecord(mounted.root,{kind:'record',section:'properties',recordId:'home'});return mounted;
}
function investmentForm(root:HTMLElement):HTMLElement{return root.querySelector('form[data-record-id="broker"]')!;}
afterEach(()=>{for(const node of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(node);document.body.replaceChildren();});

describe('ADU brokerage funding controls',()=>{
 it('offers saved taxable accounts beside Cash or Loan and saves the source independently of a partial loan',async()=>{
  const {root,controller}=open({...broker,openingTaxableBasis:{known:true,value:60_000_000}}),setup=getByRole(root,'group',{name:'ADU setup'});
  const source=getByLabelText(setup,'Pay construction cash from');expect(source).toBeVisible();expect(source).toHaveValue('household-cash');
  expect(within(source).getByRole('option',{name:'Build investments'})).toBeInTheDocument();expect(within(source).queryByRole('option',{name:'Retirement savings'})).toBeNull();
  setField(root,'Pay construction cash from','broker');expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent('Opening account balance: $500,000.00');expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent('Investment cost basis: $600,000.00');
  setField(root,'ADU funding','loan');setField(root,'ADU loan amount ($)','200000.00');setField(root,'ADU financing APR (%)','0.00');setField(root,'ADU financing term (months)','120');
  expect(getByLabelText(root,'Pay construction cash from')).toHaveValue('broker');expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent(/costs not covered by.*loan/i);
  await applyEdit(root);const state=controller.getState();expect(state.issues).toEqual([]);expect(state.savedPlan.properties[0]!.aduProject!.ownerFunding).toEqual({kind:'taxable-brokerage',accountId:'broker'});expect(state.savedPlan.properties[0]!.aduProject!.financing!.draws[0]!.amountCents).toBe(20_000_000);
  expect(JSON.parse(controller.exportBackup()).properties[0].aduProject.ownerFunding).toEqual({kind:'taxable-brokerage',accountId:'broker'});
 });
 it('labels unknown basis as a zero-basis planning assumption without saving a confirmed zero',async()=>{
  const {root,controller}=open();setField(root,'Pay construction cash from','broker');
  const setup=getByRole(root,'group',{name:'ADU setup'});expect(setup).toHaveTextContent(/cost basis.*unknown/i);expect(setup).toHaveTextContent(/zero.basis planning assumption/i);expect(setup).toHaveTextContent(/long.term/i);expect(setup).toHaveTextContent(/proportional/i);
  await applyEdit(root);expect(controller.getState().issues).toEqual([]);expect(controller.getState().savedPlan.accounts[0]!.openingTaxableBasis).toBeUndefined();
  setField(root,'Pay construction cash from','household-cash');await applyEdit(root);expect(controller.getState().savedPlan.properties[0]!.aduProject!.ownerFunding).toEqual({kind:'household-cash'});
 });
 it('opens the existing basis editor while preserving unfinished account and property edits',async()=>{
  const {root,controller}=open();openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});setField(investmentForm(root),'Account name','Unfinished account name');
  openRecord(root,{kind:'record',section:'properties',recordId:'home'});setField(root,'Pay construction cash from','broker');setField(root,'ADU living area (sq ft)','850');fireEvent.click(getByRole(root,'button',{name:'Edit account cost basis'}));
  const form=investmentForm(root);expect(getByLabelText(form,'Account name')).toHaveValue('Unfinished account name');expect(getByLabelText(form,'Investment cost basis at forecast start ($) history')).toHaveFocus();
  expect(form).toHaveTextContent(/amount paid.*still held.*January 1.*2026/i);setField(form,'Investment cost basis at forecast start ($) history','known');setField(investmentForm(root),'Investment cost basis at forecast start ($) value','320000.01');await applyEdit(investmentForm(root));
  expect(controller.getState().issues).toEqual([]);expect(controller.getState().savedPlan.accounts.find(account=>account.id==='broker')!.openingTaxableBasis).toEqual({known:true,value:32_000_001});
  openRecord(root,{kind:'record',section:'properties',recordId:'home'});expect(getByLabelText(root,'ADU living area (sq ft)')).toHaveValue('850');expect(getByLabelText(root,'Pay construction cash from')).toHaveValue('broker');expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent('Investment cost basis: $320,000.01');
 });
 it('edits basis in dollars and distinguishes confirmed zero from unknown',async()=>{
  const {root,controller}=open({...broker,openingTaxableBasis:{known:true,value:12_345_678}});openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});
  expect(getByLabelText(investmentForm(root),'Investment cost basis at forecast start ($) value')).toHaveValue('123456.78');
  setField(investmentForm(root),'Investment cost basis at forecast start ($) value','0.00');await applyEdit(investmentForm(root));expect(controller.getState().issues).toEqual([]);expect(controller.getState().savedPlan.accounts.find(a=>a.id==='broker')!.openingTaxableBasis).toEqual({known:true,value:0});
  setField(investmentForm(root),'Investment cost basis at forecast start ($) history','unknown');await applyEdit(investmentForm(root));expect(controller.getState().savedPlan.accounts.find(a=>a.id==='broker')!.openingTaxableBasis).toEqual({known:false});
 });
 it('explains invalid basis as a dollar amount and retains the unapplied text',async()=>{
  const {root,controller}=open();openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});setField(investmentForm(root),'Investment cost basis at forecast start ($) history','known');await applyEdit(investmentForm(root));
  const field=getByLabelText(investmentForm(root),'Investment cost basis at forecast start ($) value');expect(field).toHaveValue('');expect(field).toHaveAttribute('aria-invalid','true');expect(field.closest('.field-wrapper')).toHaveTextContent('Enter an amount; use 0 only if confirmed.');expect(controller.getState().savedPlan.accounts[0]!.openingTaxableBasis).toBeUndefined();
 });
 it('removes incompatible basis on a type change and keeps a referenced funding choice visible',async()=>{
  const {root,controller}=open({...broker,openingTaxableBasis:{known:true,value:10_000_000}},{ownerFunding:{kind:'taxable-brokerage',accountId:'broker'}});openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});
  setField(investmentForm(root),'Account type','traditional-ira');expect(queryByLabelText(investmentForm(root),'Investment cost basis at forecast start ($) history')).toBeNull();expect(controller.getState().drafts.broker!.value).not.toHaveProperty('openingTaxableBasis');
  await applyEdit(investmentForm(root));expect(controller.getState().savedPlan.accounts[0]!.type).toBe('taxable-brokerage');expect(prepareEdit(controller,{kind:'record',section:'accounts',recordId:'broker'})).toMatchObject({status:'invalid',issues:expect.arrayContaining([expect.objectContaining({recordId:'adu-project',field:'ownerFunding.accountId'})])});
  openRecord(root,{kind:'record',section:'properties',recordId:'home'});expect(getByLabelText(root,'Pay construction cash from')).toHaveValue('broker');
 });
 it('shows a rejected account save beside its action and reviews the linked construction source',async()=>{
  const {root,controller}=open({...broker,openingTaxableBasis:{known:true,value:10_000_000}},{ownerFunding:{kind:'taxable-brokerage',accountId:'broker'}});
  openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});setField(investmentForm(root),'Account type','traditional-ira');
  await applyEdit(investmentForm(root));
  const feedback=investmentForm(root).querySelector<HTMLElement>('[data-form-feedback]');
  expect(feedback).not.toBeNull();expect(feedback).toBeVisible();expect(feedback).toHaveTextContent('Construction investment funding requires a taxable brokerage account');
  expect(controller.getState().savedPlan.accounts[0]!.type).toBe('taxable-brokerage');expect(getByLabelText(investmentForm(root),'Account type')).toHaveValue('traditional-ira');
  fireEvent.click(getByRole(feedback!,'button',{name:'Review Synthetic new ADU'}));
  expect(getByLabelText(root,'Pay construction cash from')).toHaveFocus();expect(root.querySelector('[data-edit-target="properties:home"]')).toBeVisible();
  setField(root,'Pay construction cash from','household-cash');await applyEdit(root);
  openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});await applyEdit(investmentForm(root));
  expect(controller.getState().savedPlan.accounts.find(account=>account.id==='broker')!.type).toBe('traditional-ira');expect(investmentForm(root)).not.toHaveTextContent('Construction investment funding requires a taxable brokerage account');
 });
 it('caches taxable basis for RSU conversion and restores it on conversion back',async()=>{
  const {root,controller}=open({...broker,openingTaxableBasis:{known:true,value:10_000_000}});openRecord(root,{kind:'record',section:'accounts',recordId:'broker'});setField(investmentForm(root),'Account type','rsu');
  expect(controller.getState().drafts.broker!.value).not.toHaveProperty('openingTaxableBasis');expect(controller.getState().drafts.broker!.value).toHaveProperty('rsu');
  setField(investmentForm(root),'Account type','taxable-brokerage');expect(controller.getState().drafts.broker!.value).not.toHaveProperty('rsu');expect(getByLabelText(investmentForm(root),'Investment cost basis at forecast start ($) history')).toHaveValue('known');
 });
});
