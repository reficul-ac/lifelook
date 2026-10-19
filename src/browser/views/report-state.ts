import type {DisclosureController,DisclosureOptions} from '../disclosures';

export interface ReportViewState {
 tableView:'balance-sheet'|'financial-overview';
 expanded:Set<string>;
 scroll:Map<string,{top:number;left:number}>;
}
export function createReportViewState():ReportViewState{return {tableView:'balance-sheet',expanded:new Set(),scroll:new Map()};}

/** Stable triggers keep the shared overlay attached to the current report cause. */
export function createReportDisclosureScope(disclosures:DisclosureController):{controller:DisclosureController;begin():void;finish():boolean;dispose():void} {
 interface Entry {trigger:HTMLButtonElement;options:DisclosureOptions;forwarded:DisclosureOptions;detailRoot?:HTMLElement}
 const entries=new Map<string,Entry>(),counts=new Map<string,number>(),used=new Set<string>();
 const controller:DisclosureController={
  createTrigger(options){
   const identity=JSON.stringify([options.accessibleLabel,options.title]),index=counts.get(identity)??0;counts.set(identity,index+1);const key=`${identity}:${index}`;used.add(key);
   const existing=entries.get(key);
   if(existing){existing.options=options;Object.assign(existing.forwarded,{label:options.label,accessibleLabel:options.accessibleLabel,preview:options.preview,title:options.title});existing.trigger.textContent=options.label;return existing.trigger;}
   const entry:Entry={options,forwarded:{...options,renderDetails(node){entry.detailRoot=node;entry.options.renderDetails(node);}},trigger:null as unknown as HTMLButtonElement};entry.trigger=disclosures.createTrigger(entry.forwarded);entries.set(key,entry);return entry.trigger;
  },
  closeWithin:disclosures.closeWithin,
  dispose(){for(const entry of entries.values())disclosures.closeWithin(entry.trigger,false);entries.clear();},
 };
 return {controller,begin(){counts.clear();used.clear();},finish(){
  let resolved=false;
  for(const [key,entry] of entries){
   if(!used.has(key)){if(entry.trigger.getAttribute('aria-expanded')==='true')resolved=true;disclosures.closeWithin(entry.trigger,false);entries.delete(key);}
   else if(entry.detailRoot?.isConnected&&entry.trigger.getAttribute('aria-expanded')==='true'){entry.detailRoot.replaceChildren();entry.options.renderDetails(entry.detailRoot);}
  }
  return resolved;
 },dispose:controller.dispose};
}

/** Reconcile inert report structure while installing freshly rendered actions. */
export function reconcileReportRegion(root:HTMLElement,next:HTMLElement,state:ReportViewState,key:string):void {
 const keyed=(node:Element):string|null=>{
  if(node instanceof HTMLElement&&node.dataset.reportKey)return node.dataset.reportKey;
  if(node instanceof HTMLButtonElement&&node.hasAttribute('aria-controls')&&!node.classList.contains('disclosure-trigger'))return `toggle:${node.getAttribute('aria-controls')}`;
  if(node.id&&/^(months|tax-explanation)-/.test(node.id))return `region:${node.id}`;
  if(node instanceof HTMLDetailsElement)return `details:${node.querySelector(':scope > summary')?.textContent??''}`;
  if(node instanceof HTMLElement&&node.matches('.projection-table-wrap,.detail-table-wrap,.allocation-table-wrap,.forecast-summary-wrap'))return `scroll:${node.querySelector('caption')?.textContent??node.getAttribute('aria-label')??''}`;
  return null;
 };
 const scopedKey=(node:Element):string|null=>{const own=keyed(node);if(!own)return null;const parents:string[]=[];for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement){const id=keyed(parent);if(id)parents.unshift(id);}return [...parents,own].join('/');};
 const retained=new Map<string,Element>();
 for(const node of root.querySelectorAll('*')){
  const id=scopedKey(node);if(!id)continue;retained.set(id,node);
  if(node instanceof HTMLDetailsElement){if(node.open)state.expanded.add(`${key}:${id}`);else state.expanded.delete(`${key}:${id}`);}
  else if(node instanceof HTMLElement)state.scroll.set(`${key}:${id}`,{top:node.scrollTop,left:node.scrollLeft});
 }
 function reconcile(parent:HTMLElement,incoming:HTMLElement):void {
  const children=[...incoming.children];
  for(const child of children){
   const id=scopedKey(child),existing=id?retained.get(id):undefined;
   if(existing instanceof HTMLElement&&child instanceof HTMLElement){
    reconcile(existing,child);
    if(existing instanceof HTMLButtonElement&&child instanceof HTMLButtonElement){existing.onclick=child.onclick;existing.textContent=child.textContent;existing.setAttribute('aria-expanded',child.getAttribute('aria-expanded')??'false');}
    if(existing.id&&/^(months|tax-explanation)-/.test(existing.id))existing.hidden=child.hidden;
    child.replaceWith(existing);
    if(existing instanceof HTMLDetailsElement)existing.open=state.expanded.has(`${key}:${id}`);
    else {const position=state.scroll.get(`${key}:${id}`);if(position){existing.scrollTop=position.top;existing.scrollLeft=position.left;}}
   }else if(child instanceof HTMLElement)reconcile(child,child);
  }
  if(parent!==incoming)parent.replaceChildren(...incoming.childNodes);
 }
 reconcile(root,next);
}
