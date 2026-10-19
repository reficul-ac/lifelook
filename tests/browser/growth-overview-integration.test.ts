import {afterEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import * as previews from '../../src/browser/edit-preview';
import type {EditPreviewCoordinator} from '../../src/browser/edit-types';
import {mountWorkspace,setField} from '../helpers/dom';
import {openCollection,openRecord} from '../helpers/workspace-ui';
import {makeGrowthPlan} from '../helpers/growth';
import {installPreviewWorker} from '../helpers/preview-worker';
import {reviewTarget} from '../../src/browser/navigation';
import {unmountApp} from '../../src/browser/main';
import {prepareEdit} from '../../src/browser/state';
const target={kind:'growth-assumptions'} as const;
let clock:ReturnType<typeof installPreviewWorker>,coordinator:EditPreviewCoordinator;
function setup(){
 clock=installPreviewWorker();const actual=previews.createEditPreviewCoordinator;
 const factory=vi.spyOn(previews,'createEditPreviewCoordinator').mockImplementation((...args)=>{coordinator=actual(...args);return coordinator;});
 const harness=mountWorkspace(makeGrowthPlan({horizonYears:3}));return {...harness,factory};
}
function rail(root:HTMLElement){return within(root).getByRole('region',{name:'Growth assumptions'});}
function configureStocks(root:HTMLElement){fireEvent.click(within(rail(root)).getAllByRole('button',{name:'Set default'})[0]!);}
function preview(){coordinator.request(true);clock.flush();clock.workers.at(-1)!.reply();}
afterEach(()=>{for(const root of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(root);clock?.restore();vi.restoreAllMocks();});
describe('chart-led growth workspace',()=>{
 it('shows one primary net-worth chart, a slim rail and retained detailed reports',()=>{
  const {root,manager,factory}=setup();expect(factory).toHaveBeenCalledTimes(1);
  const chart=within(root).getByRole('img',{name:'Net worth over time'}),controls=rail(root),table=within(root).getByRole('table',{name:'Annual balance sheet'});
  expect(chart).toBeVisible();expect(controls).toBeVisible();expect(chart.compareDocumentPosition(table)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(controls.compareDocumentPosition(table)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(manager.getActiveSession().view.selections.forecastYear).toBe(2028);
  expect(within(root).getByRole('combobox',{name:'Forecast year'})).toHaveValue('2028');
  expect(within(root).getByText('Forecast charts',{selector:'summary'})).toBeInTheDocument();
  expect(within(root).getByText('Forecast details',{selector:'summary'})).toBeInTheDocument();
  expect(root.querySelectorAll('svg[aria-label="Net worth over time"]')).toHaveLength(1);
  expect(root.querySelector('svg[aria-label="Income, expenses and cash flow"]')).toBeInTheDocument();
 });
 it('keeps growth and record drafts separate while switching the single report owner',()=>{
  const {root,controller}=setup();configureStocks(root);expect(coordinator.getState().target).toEqual(target);
  const stock=controller.getGrowthDraft();controller.editGrowthDraft({...stock,value:{...stock.value,inheritAccountIds:['stock']}});preview();
  const editor=openRecord(root,{kind:'record',section:'accounts',recordId:'stock'});expect(coordinator.getState().target).toEqual({kind:'record',section:'accounts',recordId:'stock'});expect(controller.getState().growthDraft).toBeDefined();
  setField(editor,'Account name','Unfinished name');const raw=controller.getState().drafts.stock;
  const growth=rail(root);expect(growth.querySelectorAll('input:not([disabled])')).toHaveLength(0);
  fireEvent.click(within(growth).getByRole('button',{name:'Edit growth assumptions'}));expect(root.querySelector('[data-active-editor]')).toBeNull();expect(coordinator.getState().target).toEqual(target);expect(controller.getState().drafts.stock).toBe(raw);
  preview();fireEvent.click(within(growth).getByRole('button',{name:'Apply growth changes'}));expect(controller.getState().savedPlan.accounts[0]!.name).not.toBe('Unfinished name');expect(controller.getState().drafts.stock).toBe(raw);expect(prepareEdit(controller,{kind:'record',section:'accounts',recordId:'stock'}).status).toBe('stale');
 });
 it('keeps passive controls from stealing a record preview and rejects old work on navigation',()=>{
  const {root,controller}=setup();configureStocks(root);const oldInput=rail(root).querySelector<HTMLInputElement>('[data-field="growthAssumptions.stocksBps"]')!;
  clock.flush(100);const old=clock.workers.at(-1)!;
  openRecord(root,{kind:'record',section:'accounts',recordId:'stock'});fireEvent.input(oldInput,{target:{value:'9.00'}});expect(coordinator.getState().target?.kind).toBe('record');expect(controller.getGrowthDraft().value.defaults).toEqual({stocksBps:'7.70'});
  old.reply();expect(coordinator.getState().current).toBeNull();openCollection(root,'income');expect(coordinator.getState().target).toBeNull();expect(controller.getState().growthDraft).toBeDefined();
 });
 it('keeps selected-year chart, exact totals, table and mobile impact in sync',()=>{
  const {root,manager}=setup();configureStocks(root);const input=rail(root).querySelector<HTMLInputElement>('[data-field="growthAssumptions.stocksBps"]')!;input.focus();preview();expect(input).toHaveFocus();expect(input.isConnected).toBe(true);
  const chart=within(root).getByRole('img',{name:'Net worth over time'}),svg=chart as unknown as SVGSVGElement,paths=[...svg.querySelectorAll('path')];
  fireEvent.keyDown(chart,{key:'Home'});expect(manager.getActiveSession().view.selections.forecastYear).toBe(2026);expect(within(root).getByRole('combobox',{name:'Forecast year'})).toHaveValue('2026');
  expect(root.querySelector('[data-growth-impact]')).toHaveTextContent('2026');expect(root.querySelector('[data-growth-impact]')).toHaveTextContent('Net worth');
  expect([...svg.querySelectorAll('path')]).toEqual(paths);expect(root.querySelector('[data-testid="balance-2026-net-worth"]')).toBeInTheDocument();
 });
 it('routes a default issue to the matching input ahead of the Household route',()=>{
  const {root,controller}=setup();reviewTarget(root,{section:'Household',recordId:'household',field:'growthAssumptions.propertyBps',label:'Review property default'});
  expect(document.activeElement).toHaveTextContent('Set default');expect(controller.getState().growthDraft).toBeUndefined();fireEvent.click(document.activeElement!);
  reviewTarget(root,{section:'Household',recordId:'household',field:'growthAssumptions.propertyBps',label:'Review property default'});
  expect(root.querySelector('[data-active-editor]')).toBeNull();expect(coordinator.getState().target).toEqual(target);
  expect(document.activeElement).toHaveAttribute('data-field','growthAssumptions.propertyBps');
 });
 it('resumes a retained draft on return while forks/exports contain applied data only',()=>{
  const {root,manager,controller}=setup();configureStocks(root);preview();const oldApply=within(rail(root)).getByRole('button',{name:'Apply growth changes'});
  expect(root.querySelector('[data-testid="draft-status"]')).toHaveTextContent('Growth draft');
  const source=manager.getActiveSession();source.view.growthChart={horizon:'all',showComparison:false};expect(manager.forkScenario(manager.captureTarget('master')!,'Experiment').accepted).toBe(true);
  const fork=manager.getActiveSession();expect(fork.controller.getState().growthDraft).toBeUndefined();expect(fork.view.growthChart).toEqual(source.view.growthChart);expect(fork.view.growthChart).not.toBe(source.view.growthChart);
  fireEvent.click(oldApply);expect(controller.getState().savedPlan.revision).toBe(0);expect(manager.exportWorkspace()).not.toContain('7.70');expect(manager.exportWorkspace()).not.toContain('growthChart');
  manager.switchScenario('master');expect(coordinator.getState().target).toBeNull();expect(rail(root)).toHaveTextContent('Draft');expect(root.querySelector('.overview-source')).toHaveTextContent('Applied results');
  fireEvent.click(within(rail(root)).getByRole('button',{name:'Edit growth assumptions'}));expect(coordinator.getState().target).toEqual(target);preview();expect(root.querySelector('.overview-source')).toHaveTextContent('Preview · Growth assumptions');
 });
});
