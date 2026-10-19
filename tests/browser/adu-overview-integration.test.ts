import {expect,it} from 'vitest';
import {fireEvent,waitFor,within} from '@testing-library/dom';
import {toDraftValue} from '../../src/browser/state';
import {mountWorkspace} from '../helpers/dom';
import {makeAduPlan} from '../helpers/adu';

it('starts the applied comparison when the first ADU is applied and follows the forecast year',async()=>{
 const completed=makeAduPlan(),{aduProject,...home}=completed.properties[0]!;
 const {root,controller}=mountWorkspace({...completed,properties:[{...home,role:'primary'}],rentals:[]});
 const draft=controller.getDraft('properties','home');
 controller.editDraft('home',{...draft,value:toDraftValue({property:completed.properties[0],rentals:completed.rentals,expenses:[]})});
 expect(controller.saveProperty('home')).toMatchObject({accepted:true});
 const comparison=root.querySelector<HTMLElement>('.applied-project-comparison')!;
 await waitFor(()=>expect(comparison.querySelector('[data-testid="adu-owner-commitment"]')).not.toBeNull());
 expect(comparison).toHaveTextContent('ADU build versus no build · 2026');
 fireEvent.change(within(root).getByLabelText('Forecast year'),{target:{value:'2027'}});
 expect(comparison).toHaveTextContent('ADU build versus no build · 2027');
});

it('shows a retry action when the supported comparison worker fails',async()=>{
 let created=0;
 class BrokenWorker {
  onerror:((event:Event)=>void)|null=null;
  onmessageerror:((event:Event)=>void)|null=null;
  constructor(){created++;queueMicrotask(()=>this.onerror?.(new Event('error')));}
  postMessage(){}
  terminate(){}
 }
 const {vi}=await import('vitest');vi.stubGlobal('Worker',BrokenWorker);
 try {
  const {root}=mountWorkspace(makeAduPlan());
  await waitFor(()=>expect(root.querySelector('.applied-project-comparison button')).not.toBeNull());
  fireEvent.click(root.querySelector('.applied-project-comparison > summary')!);
  expect(within(root).getByRole('button',{name:'Retry comparison'})).toBeVisible();
  expect(root).toHaveTextContent('Applied ADU comparison is unavailable');
  fireEvent.click(within(root).getByRole('button',{name:'Retry comparison'}));
  await waitFor(()=>expect(created).toBe(2));
 } finally {vi.unstubAllGlobals();}
});
