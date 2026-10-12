import {afterEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {createDisclosureController, type DisclosureController} from '../../src/browser/disclosures';

let controller: DisclosureController;
afterEach(() => {controller?.dispose(); vi.useRealTimers(); document.body.replaceChildren();});
function setup() {
  const owner = document.createElement('main'); document.body.replaceChildren(owner);
  controller = createDisclosureController(owner);
  const trigger = controller.createTrigger({label:'Needs data', accessibleLabel:'Needs data: Federal income tax, 2027', preview:'Confirm 3 household tax answers.', title:'Federal income tax · 2027', renderDetails: node => {node.textContent = '<img src=x onerror=alert(1)> Exact explanation and next step';}});
  owner.append(trigger); return {owner, trigger};
}
describe('shared disclosures', () => {
  it('builds details lazily, associates preview and returns focus on Escape', () => {
    const {trigger} = setup();
    expect(document.querySelector('[data-disclosure-panel]')).toBeNull();
    trigger.focus();
    const tooltip = within(document.body).getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip).toHaveTextContent('Confirm 3 household tax answers.');
    fireEvent.click(trigger);
    const panel = within(document.body).getByRole('region', {name:'Federal income tax · 2027'});
    expect(panel).toHaveTextContent('<img src=x onerror=alert(1)>'); expect(panel.querySelector('img')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(within(panel).getByRole('button', {name:'Close'}));
    fireEvent.keyDown(document, {key:'Escape'});
    expect(panel).not.toBeVisible(); expect(document.activeElement).toBe(trigger);
    expect(tooltip).not.toBeVisible();
    fireEvent.mouseEnter(trigger); expect(tooltip).toBeVisible();
  });
  it('lets the pointer move to the preview and cancels pending close on disposal', () => {
    vi.useFakeTimers(); const {trigger} = setup();
    fireEvent.mouseEnter(trigger); const tooltip = within(document.body).getByRole('tooltip');
    fireEvent.mouseLeave(trigger); vi.advanceTimersByTime(100); fireEvent.mouseEnter(tooltip); vi.advanceTimersByTime(150);
    expect(tooltip).toBeVisible(); fireEvent.mouseLeave(tooltip); vi.advanceTimersByTime(150); expect(tooltip).not.toBeVisible();
    fireEvent.mouseEnter(trigger); fireEvent.mouseLeave(trigger); controller.dispose(); vi.runAllTimers();
    expect(document.querySelector('[data-disclosure-preview]')).toBeNull();
  });
  it('allows a fresh keyboard focus after dismissing a hover-only preview',()=>{
    const {trigger}=setup();fireEvent.mouseEnter(trigger);fireEvent.keyDown(document,{key:'Escape'});expect(within(document.body).queryByRole('tooltip')).toBeNull();
    trigger.focus();expect(within(document.body).getByRole('tooltip')).toBeVisible();
  });
  it('preserves destination focus on outside dismissal or navigation and supports reopening', () => {
    const {owner, trigger} = setup(); const destination=document.createElement('input'); owner.append(destination);
    fireEvent.click(trigger); destination.focus(); fireEvent.pointerDown(destination); expect(document.activeElement).toBe(destination);
    expect(trigger).toHaveAttribute('aria-expanded','false');
    fireEvent.click(trigger); destination.focus(); controller.closeWithin(owner,false); expect(document.activeElement).toBe(destination);
    owner.hidden=true; fireEvent.mouseEnter(trigger); expect(within(document.body).queryByRole('tooltip')).toBeNull();
    owner.hidden=false; fireEvent.click(trigger); expect(within(document.body).getByRole('region')).toBeVisible();
  });
  it('cleans overlays on remount and detachment without breaking retained triggers', async () => {
    const {owner, trigger} = setup(); fireEvent.click(trigger); controller=createDisclosureController(owner);
    expect(document.querySelector('[data-disclosure-panel]')).toBeNull();
    const next=controller.createTrigger({label:'Help',accessibleLabel:'Help',preview:'Preview',title:'Help',renderDetails:node=>{node.textContent='Details';}}); owner.append(next); fireEvent.click(next);
    owner.remove(); await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.querySelector('[data-disclosure-panel]')).toBeNull();
  });
  it('closes when a containing details or navigation section hides the trigger', async () => {
    const {owner,trigger}=setup(); const details=document.createElement('details'); details.open=true; details.append(trigger); owner.append(details);
    fireEvent.click(trigger); details.open=false; await new Promise(resolve=>setTimeout(resolve,0));
    expect(trigger).toHaveAttribute('aria-expanded','false'); details.open=true; fireEvent.click(trigger);
    expect(within(document.body).getByRole('region')).toBeVisible(); trigger.remove(); await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.querySelector('[data-disclosure-panel]')).not.toBeVisible();
  });
});
