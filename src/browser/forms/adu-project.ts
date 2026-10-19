import { valueAt,type FieldContext } from '../fields';
import { fieldMemory } from '../record-ui-state';
import type { WorkspaceController } from '../state';
import { renderAduBasics } from './adu-basics';
import { renderAduFunding } from './adu-funding';
import { renderAduTaxFields } from './adu-tax-fields';

/** Every group writes through the owning property's unchanged bundle context. */
export function renderAduProjectFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):HTMLElement {
 if(!valueAt(context.draft.value,['property','aduProject']))return root;
 renderAduBasics(root,controller,context);renderAduFunding(root,controller,context);renderAduTaxFields(root,controller,context);
 const memory=fieldMemory(context);
 for(const detail of root.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]')){
  const key=detail.dataset.propertyDisclosure!;detail.open=context.ui?.editorView?.propertyDisclosures.get(key)??memory.openGroups.has(key);detail.addEventListener('toggle',()=>{if(!detail.isConnected)return;if(detail.open)memory.openGroups.add(key);else memory.openGroups.delete(key);context.ui?.editorView?.propertyDisclosures.set(key,detail.open);});
 }
 return root.querySelector<HTMLElement>('[data-adu-advanced]')!;
}
