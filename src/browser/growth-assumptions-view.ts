import type {Issue} from '../engine';
import type {EditPreviewCoordinator} from './edit-types';
import type {IssueViewContext} from './issue-presentation';
import type {RawObject, WorkspaceController} from './state';
import {createGrowthDraft} from './growth-assumptions';
import {mountNumericControl} from './ui/numeric-control';

interface GrowthAssumptionsOptions {
  readonly preview: EditPreviewCoordinator;
  activate(): boolean;
  isCurrent(): boolean;
  readonly context: IssueViewContext;
}
type CategoryKey = 'stocksBps' | 'propertyBps';
type MembershipKey = 'inheritAccountIds' | 'inheritPropertyIds';
const object = (raw: unknown): RawObject => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RawObject : {};
const ids = (raw: unknown): string[] => Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
const rate = (bps: number) => `${(bps / 100).toFixed(2)}%`;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}

/** One mounted editor for the scenario-owned defaults and explicit membership transaction. */
export function mountGrowthAssumptions(root: HTMLElement, controller: WorkspaceController, options: GrowthAssumptionsOptions): {
  update(): void;
  reveal(field: string): void;
  dispose(): void;
} {
  root.replaceChildren(); root.classList.add('growth-assumptions');
  root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Growth assumptions');
  root.append(element('h2', 'Growth assumptions'));
  let disposed = false;
  const current = () => !disposed && root.isConnected && options.isCurrent();
  const owns = () => options.preview.getState().target?.kind === 'growth-assumptions';
  const competing = () => options.preview.getState().target !== null && !owns();
  const acquire = () => current() && !competing() && (owns() || options.activate() && owns());
  const action = (label: string, run: () => void) => {
    const node = element('button', label); node.type = 'button';
    node.addEventListener('click', () => {if (current() && node.isConnected && !node.disabled) run();}); return node;
  };
  const stage = (write: (value: RawObject) => RawObject, commit = false) => {
    if (!acquire()) {update(); return;}
    const draft = controller.getGrowthDraft();
    controller.editGrowthDraft({...draft, value: write(draft.value)});
    if (commit) options.preview.request(true);
  };
  const commit = () => {if (current() && owns()) options.preview.request(true);};
  const resume = action('Edit growth assumptions', () => {if (options.activate()) update();});
  root.append(resume);
  function makeCategory(key: CategoryKey, title: string, label: string, membership: MembershipKey, minUnits: number, maxUnits: number) {
    const group = element('fieldset'); group.append(element('legend', title));
    const summary = element('p'), proposal = element('small'), inputHost = element('div');
    summary.className = 'growth-category-summary'; proposal.className = 'growth-proposal';
    const setup = action('Set default', () => stage(value => ({...value, defaults: {...object(value.defaults), [key]: key === 'stocksBps' ? '7.70' : ''}}), true));
    const numeric = mountNumericControl(inputHost, {label, field: `growthAssumptions.${key}`, kind: 'rate', raw: '', slider: {minUnits, maxUnits, stepUnits: 10},
      onInput: raw => stage(value => ({...value, defaults: {...object(value.defaults), [key]: raw}})), onCommit: commit});
    const noMembers = element('small', 'Affects no assets. Choose assets using defaults to review membership.');
    group.append(summary, proposal, setup, inputHost, noMembers); root.append(group);
    return {key, title, label, membership, group, summary, proposal, setup, inputHost, numeric, noMembers};
  }
  const stocks = makeCategory('stocksBps', 'Stock accounts', 'Stock account growth (%)', 'inheritAccountIds', -1000, 2000);
  const properties = makeCategory('propertyBps', 'Properties', 'Property appreciation (%)', 'inheritPropertyIds', -500, 1500);
  const review = element('details'); review.className = 'growth-membership'; review.append(element('summary', 'Choose assets using defaults'));
  const membershipGroups = new Map<MembershipKey, {group: HTMLFieldSetElement; list: HTMLElement; all: HTMLButtonElement; clear: HTMLButtonElement; rows: Map<string, {label: HTMLLabelElement; input: HTMLInputElement; caption: HTMLElement; summary: HTMLElement}>}>();
  for (const [key, label] of [['inheritAccountIds', 'Stock account membership'], ['inheritPropertyIds', 'Property membership']] as const) {
    const group = element('fieldset'), list = element('div'); group.append(element('legend', label));
    const all = action('Select all', () => stage(value => ({...value, [key]: key === 'inheritAccountIds' ? controller.getState().savedPlan.accounts.filter(account => account.type !== 'rsu').map(account => account.id) : controller.getState().savedPlan.properties.map(property => property.id)}), true));
    const clear = action('Clear selection', () => stage(value => ({...value, [key]: []}), true));
    const actions = element('div'); actions.className = 'growth-membership-actions'; actions.append(all, clear);
    group.append(actions, list); review.append(group); membershipGroups.set(key, {group, list, all, clear, rows: new Map()});
  }
  const independent = element('div'); independent.className = 'growth-independent-assets'; review.append(independent); root.append(review);
  const feedback = element('div'), status = element('p'), persistence = element('p');
  feedback.className = 'growth-feedback'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.growthStatus = 'inactive';
  persistence.className = 'growth-persistence';
  const apply = action('Apply growth changes', () => {if (acquire() && options.preview.getState().status === 'valid') options.preview.apply();});
  const discard = action('Discard edits', () => {if (acquire()) options.preview.discard();});
  const actions = element('div'); actions.className = 'growth-actions'; actions.append(apply, discard);
  root.append(status, actions, feedback, persistence);
  let issueSignature = '', independentSignature = '';
  function showIssues(issues: readonly Issue[]) {
    const signature = JSON.stringify(issues); if (signature === issueSignature) return; issueSignature = signature;
    options.context.disclosures.closeWithin(feedback, false); feedback.replaceChildren();
    for (const category of [stocks, properties]) category.numeric.input.removeAttribute('aria-invalid');
    if (!issues.length) return;
    const list = element('ul'); feedback.append(list);
    for (const issue of issues) {
      const row = element('li', issue.explanation); row.className = `issue-${issue.severity}`;
      const category = [stocks, properties].find(category => issue.field === `growthAssumptions.${category.key}`);
      if (category && issue.severity === 'error') category.numeric.input.setAttribute('aria-invalid', 'true');
      if (category || issue.field === 'inheritAccountIds' || issue.field === 'inheritPropertyIds') row.append(action(`Review ${category?.label ?? 'asset membership'}`, () => reveal(issue.field!)));
      row.append(options.context.disclosures.createTrigger({label: 'Details', accessibleLabel: `Details: ${category?.label ?? 'growth assumptions'}`, title: 'Growth assumptions input', preview: issue.explanation, renderDetails: node => {node.append(element('p', issue.explanation), element('p', issue.resolution));}}));
      list.append(row);
    }
  }
  function update() {
    if (disposed) return;
    const state = controller.getState(), draft = competing() ? createGrowthDraft(state.savedPlan) : controller.getGrowthDraft(), defaults = object(draft.value.defaults), preview = options.preview.getState();
    const blocked = competing() || !options.isCurrent(), retained = !!state.growthDraft && !owns();
    resume.hidden = !competing() && !retained; resume.disabled = !options.isCurrent();
    for (const category of [stocks, properties]) {
      const configured = Object.hasOwn(defaults, category.key), raw = String(defaults[category.key] ?? ''), members = ids(draft.value[category.membership]);
      category.inputHost.hidden = !configured; category.setup.hidden = configured; category.setup.disabled = blocked;
      category.numeric.update(raw);
      for (const input of category.inputHost.querySelectorAll('input')) input.disabled = blocked;
      const noun = category.key === 'stocksBps' ? members.length === 1 ? 'account' : 'accounts' : members.length === 1 ? 'property' : 'properties';
      category.summary.textContent = `${configured ? raw.trim() ? `${raw}% annual` : 'Enter a default rate' : 'Unconfigured'} · ${members.length} ${noun} using default`;
      category.proposal.textContent = state.growthDraft && !competing() && configured ? 'Proposed · Apply after reviewing the preview.' : '';
      category.proposal.hidden = !category.proposal.textContent;
      category.noMembers.hidden = !configured || members.length > 0;
    }
    for (const [key, group] of membershipGroups) {
      const selected = ids(draft.value[key]), records = key === 'inheritAccountIds' ? state.savedPlan.accounts.filter(account => account.type !== 'rsu').map(account => ({id: account.id, name: account.name, rate: account.annualGrowthBps})) : state.savedPlan.properties.map(property => ({id: property.id, name: property.name, rate: property.appreciationBps}));
      const present = new Set(records.map(record => record.id));
      for (const [id, row] of group.rows) if (!present.has(id)) {row.label.remove(); group.rows.delete(id);}
      records.forEach((record, index) => {
        let row = group.rows.get(record.id);
        if (!row) {
          const label = element('label'), input = element('input'), caption = element('span'), summary = element('small');
          label.className = 'growth-membership-row'; input.type = 'checkbox'; input.name = `${key}.${record.id}`;
          input.addEventListener('change', () => {
            if (!current() || !input.isConnected || input.disabled) return;
            stage(value => ({...value, [key]: input.checked ? [...ids(value[key]).filter(id => id !== record.id), record.id] : ids(value[key]).filter(id => id !== record.id)}), true);
          });
          label.append(input, caption, summary); row = {label, input, caption, summary}; group.rows.set(record.id, row);
        }
        row.input.setAttribute('aria-label', record.name); row.input.checked = selected.includes(record.id); row.input.disabled = blocked;
        row.caption.textContent = record.name; row.summary.textContent = `Custom ${rate(record.rate)} retained`;
        if (group.list.children[index] !== row.label) group.list.insertBefore(row.label, group.list.children[index] ?? null);
      });
      group.all.disabled = group.clear.disabled = blocked;
    }
    const rsus = state.savedPlan.accounts.filter(account => account.type === 'rsu'), signature = JSON.stringify(rsus.map(account => [account.id, account.name, account.annualGrowthBps, account.rsu?.priceTargets?.length]));
    if (signature !== independentSignature) {
      independentSignature = signature; independent.replaceChildren();
      for (const account of rsus) independent.append(element('p', `${account.name} · ${account.rsu?.priceTargets?.length ? 'Scheduled' : 'Custom'} · Own rate ${rate(account.annualGrowthBps)} · Independent of stock default`));
    }
    const active = owns(), mode = active ? preview.status : 'inactive'; status.dataset.growthStatus = mode;
    status.textContent = mode === 'pending' ? 'Draft · Updating preview' : mode === 'valid' ? 'Preview · Not applied' : mode === 'invalid' ? 'Draft · Paused — review inputs' : mode === 'stale' ? 'Draft · Stale — applied growth inputs changed' : mode === 'failed' ? 'Draft · Calculation failed' : state.growthDraft ? active ? 'Draft · No financial change' : 'Draft · Resume to preview' : 'Applied growth assumptions';
    apply.disabled = blocked || !active || mode !== 'valid' || !preview.current;
    discard.disabled = blocked || !state.growthDraft;
    persistence.textContent = state.persisted ? 'Saved locally' : 'Not saved locally · Applied inputs remain available in memory. Export a backup from Settings.';
    showIssues(active ? preview.issues : []);
  }
  function reveal(field: string) {
    if (!current()) return;
    const category = [stocks, properties].find(category => field === `growthAssumptions.${category.key}`);
    if (category) {(category.inputHost.hidden ? category.setup : category.numeric.input).focus(); return;}
    const membership = membershipGroups.get(field as MembershipKey);
    if (membership) {review.open = true; const input = membership.list.querySelector<HTMLInputElement>('input:not(:disabled)'); if (input) input.focus(); else {membership.group.tabIndex = -1; membership.group.focus();}}
  }
  const unsubscribeController = controller.subscribe(update), unsubscribePreview = options.preview.subscribe(update);
  update();
  return {update, reveal, dispose() {
    if (disposed) return; disposed = true;
    unsubscribeController(); unsubscribePreview(); stocks.numeric.dispose(); properties.numeric.dispose();
    options.context.disclosures.closeWithin(feedback, false);
  }};
}
