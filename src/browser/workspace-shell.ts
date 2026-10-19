import {button, element} from './fields';
import type {EditTarget} from './edit-types';
import type {EditorViewSession} from './scenario-session';
import {destinations, type Destination, type WorkspaceRoute} from './workspace-route';

export function mountWorkspaceShell(root: HTMLElement, _view: EditorViewSession, actions: {navigate(destination: Destination): void; open(target: EditTarget, origin: HTMLElement | null): void; close(): void; surface(value: 'edit' | 'forecast'): void}): {overview: HTMLElement; collection: HTMLElement; editor: HTMLElement; update(route: WorkspaceRoute): void; dispose(): void} {
  const nav = element('nav'); nav.className = 'workspace-nav'; nav.setAttribute('aria-label', 'Workspace');
  for (const [destination, label] of destinations) {const tab = button(label, () => actions.navigate(destination)); tab.dataset.destination = destination; nav.append(tab);}
  const layout = element('div'); layout.className = 'workspace-layout';
  const collection = element('section'); collection.className = 'record-collection'; collection.dataset.collection = '';
  const overview = element('section'); overview.className = 'workspace-overview'; overview.setAttribute('aria-label', 'Financial forecast');
  const editor = element('section'); editor.className = 'focused-editor'; editor.setAttribute('aria-label', 'Financial editor');
  const surfaces = element('div'); surfaces.className = 'editor-surfaces'; surfaces.append(button('Edit', () => actions.surface('edit')), button('Forecast', () => actions.surface('forecast')), button('Close editor', actions.close));
  const impact=element('div');impact.className='impact-ribbon';impact.dataset.impactRibbon='';
  root.append(nav, surfaces, impact, layout); layout.append(collection, overview, editor);
  return {overview, collection, editor, update(route) {
    root.dataset.destination = route.destination; root.dataset.surface = route.surface; root.dataset.editing = String(!!route.editor);
    for (const tab of nav.querySelectorAll<HTMLButtonElement>('[data-destination]')) tab.setAttribute('aria-pressed', String(tab.dataset.destination === route.destination));
    surfaces.hidden = !route.editor; editor.hidden = !route.editor; overview.hidden = !route.editor && route.destination !== 'overview'; collection.hidden = !!route.editor || route.destination === 'overview';
    impact.hidden=!route.editor||route.surface!=='edit';
    if (route.editor) editor.dataset.activeEditor = ''; else delete editor.dataset.activeEditor;
    for (const tab of surfaces.querySelectorAll('button')) if (tab.textContent !== 'Close editor') tab.setAttribute('aria-pressed', String(tab.textContent?.toLowerCase() === route.surface));
  }, dispose() {nav.remove(); surfaces.remove(); layout.remove();}};
}
