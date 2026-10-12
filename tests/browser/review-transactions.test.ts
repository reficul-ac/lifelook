import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, getByLabelText, getByRole } from '@testing-library/dom';
import type { PlanDocument } from '../../src/engine';
import { validatePlan } from '../../src/engine';
import { createWorkspace } from '../../src/browser/state';
import { loadPlan, PLAN_STORAGE_KEY, restorePlan } from '../../src/browser/storage';
import { renderPropertiesForm } from '../../src/browser/forms/properties';
import { renderExpensesDebtsForm } from '../../src/browser/forms/expenses-debts';
import { makePlan } from '../helpers/plans';

function plan(): PlanDocument {
  return makePlan({ properties: [{ id: 'home', name: 'Home', role: 'primary', purchaseDate: '2025-01-01', purchasePriceCents: 0, downPaymentCents: 0, openingValueCents: 0, appreciationBps: 0, appreciationOverrides: [], loans: [] }], expenses: [{ id: 'insurance', name: 'Insurance', amountCents: 10000, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, propertyId: 'home', use: 'shared', taxCategory: 'homeowners-insurance' }] });
}
function workspace() {
  const initial = plan(), values = new Map([[PLAN_STORAGE_KEY, JSON.stringify(initial)]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  return { controller: createWorkspace(initial, storage), storage };
}
function editProperty(controller: ReturnType<typeof createWorkspace>) {
  const draft = controller.getDraft('properties', 'home');
  controller.editDraft('home', { ...draft, value: { ...draft.value, property: { ...draft.value.property as object, name: 'Draft home' } } });
}
function editExpense(controller: ReturnType<typeof createWorkspace>, amount = '200.00') {
  const draft = controller.getDraft('expenses', 'insurance');
  controller.editDraft('insurance', { ...draft, value: { ...draft.value, amountCents: amount } });
}
afterEach(() => document.body.replaceChildren());
describe('review: atomic save, restore and overlapping drafts', () => {
  it('rejects an impossible expense allocation before changing any saved or calculated state', () => {
    const { controller, storage } = workspace(), before = controller.getState(), bytes = storage.getItem(PLAN_STORAGE_KEY);
    const draft = controller.getDraft('expenses', 'insurance');
    controller.editDraft('insurance', { ...draft, value: { ...draft.value, allocationOverride: { numerator: '1', denominator: '2' } } });
    expect(controller.saveRecord('insurance').accepted).toBe(false);
    expect(controller.getState().savedPlan).toBe(before.savedPlan);
    expect(controller.getState().projection).toBe(before.projection);
    expect(controller.getState().persisted).toBe(before.persisted);
    expect(controller.getState().drafts.insurance?.value.allocationOverride).toEqual({ numerator: '1', denominator: '2' });
    expect(storage.getItem(PLAN_STORAGE_KEY)).toBe(bytes);
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({ recordId: 'insurance', field: 'allocationOverride' }));
  });
  it('rejects an uncalculable restore and preserves the original stored document', () => {
    const { controller, storage } = workspace(), current = controller.getState().savedPlan, bytes = storage.getItem(PLAN_STORAGE_KEY);
    const invalid = { ...current, expenses: current.expenses.map(e => ({ ...e, allocationOverride: { numerator: 1, denominator: 2 } })) };
    expect(validatePlan(invalid).ok).toBe(false);
    const restored = restorePlan(JSON.stringify(invalid), current, storage);
    expect(restored.accepted).toBe(false); expect(restored.plan).toBe(current);
    expect(storage.getItem(PLAN_STORAGE_KEY)).toBe(bytes);
    expect(loadPlan(storage).status).toBe('loaded');
    storage.setItem(PLAN_STORAGE_KEY, JSON.stringify(invalid));
    expect(loadPlan(storage)).toMatchObject({ status: 'invalid', raw: JSON.stringify(invalid) });
  });
  it('rejects a stale property bundle while retaining the newer saved linked expense and raw draft', () => {
    const { controller, storage } = workspace(); editProperty(controller); editExpense(controller);
    expect(controller.saveRecord('insurance').accepted).toBe(true);
    const before = controller.getState(), bytes = storage.getItem(PLAN_STORAGE_KEY);
    expect(controller.saveProperty('home').accepted).toBe(false);
    expect(controller.getState().savedPlan).toBe(before.savedPlan); expect(controller.getState().projection).toBe(before.projection);
    expect(controller.getState().persisted).toBe(before.persisted); expect(storage.getItem(PLAN_STORAGE_KEY)).toBe(bytes);
    expect(controller.getState().savedPlan.expenses[0]?.amountCents).toBe(20000);
    expect(controller.getState().drafts.home?.value.property).toMatchObject({ name: 'Draft home' });
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({ code: 'stale-record-draft', recordId: 'home' }));
  });
  it('rejects an expense draft made stale by a property save', () => {
    const { controller, storage } = workspace(); editExpense(controller);
    const draft = controller.getDraft('properties', 'home');
    controller.editDraft('home', { ...draft, value: { ...draft.value, expenses: (draft.value.expenses as object[]).map(e => ({ ...e, amountCents: '300.00' })) } });
    expect(controller.saveProperty('home').accepted).toBe(true);
    const before = controller.getState(), bytes = storage.getItem(PLAN_STORAGE_KEY);
    expect(controller.saveRecord('insurance').accepted).toBe(false);
    expect(controller.getState().savedPlan).toBe(before.savedPlan); expect(controller.getState().projection).toBe(before.projection);
    expect(storage.getItem(PLAN_STORAGE_KEY)).toBe(bytes);
    expect(controller.getState().savedPlan.expenses[0]?.amountCents).toBe(30000);
    expect(controller.getState().drafts.insurance?.value.amountCents).toBe('200.00');
  });
  it('allows an unrelated household save before saving a property draft', () => {
    const { controller } = workspace(); editProperty(controller);
    const draft = controller.getDraft('household', 'household');
    controller.editDraft('household', { ...draft, value: { ...draft.value, openingCashCents: '50.00' } });
    expect(controller.saveRecord('household').accepted).toBe(true); expect(controller.saveProperty('home').accepted).toBe(true);
    expect(controller.getState().savedPlan.revision).toBe(2); expect(controller.getState().savedPlan.openingCashCents).toBe(5000);
    expect(controller.getState().savedPlan.properties[0]?.name).toBe('Draft home');
  });
  it('retains the original snapshot when a draft is edited after a linked save', () => {
    const { controller } = workspace(), draft = controller.getDraft('properties', 'home');
    editExpense(controller); controller.saveRecord('insurance');
    controller.editDraft('home', { ...draft, value: { ...draft.value, property: { ...draft.value.property as object, name: 'Old draft' } } });
    expect(controller.saveProperty('home').accepted).toBe(false);
    expect(controller.getState().savedPlan.expenses[0]?.amountCents).toBe(20000);
  });
  it('reloads a conflicting property through a native button without clearing an independent draft', () => {
    const { controller } = workspace(); editProperty(controller); editExpense(controller); controller.saveRecord('insurance');
    const pending = controller.beginAdd('accounts'); controller.saveProperty('home');
    const root = document.createElement('section'); document.body.append(root); renderPropertiesForm(root, controller);
    fireEvent.click(getByRole(root, 'button', { name: 'Discard property edits and reload saved values' }));
    expect(getByLabelText(root, 'Property name')).toHaveValue('Home');
    expect(controller.getDraft('properties', 'home').value.expenses).toMatchObject([{ amountCents: '200.00' }]);
    expect(controller.getState().drafts[pending]).toBeDefined(); expect(controller.getState().drafts.home).toBeUndefined();
    editProperty(controller); expect(controller.saveProperty('home').accepted).toBe(true);
    expect(controller.getState().savedPlan.expenses[0]?.amountCents).toBe(20000);
  });
  it('reloads a conflicting expense through a native button', () => {
    const { controller } = workspace(); editExpense(controller);
    const draft = controller.getDraft('properties', 'home');
    controller.editDraft('home', { ...draft, value: { ...draft.value, expenses: (draft.value.expenses as object[]).map(e => ({ ...e, amountCents: '300.00' })) } });
    controller.saveProperty('home'); controller.saveRecord('insurance');
    const root = document.createElement('section'); document.body.append(root); renderExpensesDebtsForm(root, controller);
    fireEvent.click(getByRole(root, 'button', { name: 'Discard expense record edits and reload saved values' }));
    expect(getByLabelText(root, 'Expense amount ($)')).toHaveValue('300.00');
    expect(controller.getState().drafts.insurance).toBeUndefined();
  });
});
