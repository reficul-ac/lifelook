export interface DisclosureOptions {
  readonly label: string;
  readonly accessibleLabel: string;
  readonly preview: string;
  readonly title: string;
  readonly renderDetails: (root: HTMLElement) => void;
}
export interface DisclosureController {
  createTrigger(options: DisclosureOptions): HTMLButtonElement;
  closeWithin(root: HTMLElement, restoreFocus?: boolean): void;
  dispose(): void;
}
const owners = new WeakMap<HTMLElement, DisclosureController>();
let sequence = 0;
function visible(node: HTMLElement): boolean {
  if (!node.isConnected) return false;
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true') return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector('summary')?.contains(node)) return false;
  }
  return true;
}
export function createDisclosureController(owner: HTMLElement): DisclosureController {
  owners.get(owner)?.dispose();
  const id = `disclosure-${++sequence}`;
  let preview: HTMLElement | undefined, panel: HTMLElement | undefined;
  let active: HTMLButtonElement | undefined, pinned = false, disposed = false, suppress = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() {if (timer !== undefined) clearTimeout(timer); timer=undefined;}
  function place() {
    const overlay = pinned ? panel : preview;
    if (!active || !overlay || overlay.hidden) return;
    if (!visible(active)) {close(false); return;}
    const margin=12, width=window.innerWidth, height=window.innerHeight;
    overlay.style.maxWidth=`${Math.max(0,width-2*margin)}px`;
    overlay.style.maxHeight=`${Math.max(0,height-2*margin)}px`;
    const triggerRect=active.getBoundingClientRect(), rect=overlay.getBoundingClientRect();
    const left=Math.max(margin,Math.min(triggerRect.left,width-rect.width-margin));
    const preferred=triggerRect.bottom+8;
    const top=preferred+rect.height<=height-margin?preferred:Math.max(margin,Math.min(triggerRect.top-rect.height-8,height-rect.height-margin));
    overlay.style.left=`${left}px`; overlay.style.top=`${top}px`;
  }
  function close(restore=false) {
    cancel(); const old=active; active=undefined; pinned=false;
    if(preview) preview.hidden=true; if(panel) panel.hidden=true;
    if(old){old.removeAttribute('aria-describedby');old.setAttribute('aria-expanded','false');}
    if(restore && old && visible(old)){suppress=true;old.focus();}
  }
  function delayedClose() {cancel();timer=setTimeout(()=>{if(!pinned)close(false);},150);}
  function ensurePreview() {
    if(preview) return preview;
    preview=document.createElement('div');preview.id=`${id}-preview`;preview.dataset.disclosurePreview='';preview.className='disclosure-preview';preview.setAttribute('role','tooltip');preview.hidden=true;
    preview.addEventListener('mouseenter',cancel); preview.addEventListener('mouseleave',delayedClose); document.body.append(preview); return preview;
  }
  function show(trigger: HTMLButtonElement, options: DisclosureOptions, newEntry=false) {
    if(disposed || !visible(trigger) || pinned) return;
    if(newEntry) suppress=false; if(suppress) return;
    cancel(); if(active!==trigger)close(false); active=trigger;
    const node=ensurePreview();node.textContent=options.preview;node.hidden=false;trigger.setAttribute('aria-describedby',node.id);place();
  }
  function activate(trigger: HTMLButtonElement, options: DisclosureOptions) {
    if(disposed || !visible(trigger)) return;
    if(active===trigger && pinned){close(true);return;}
    close(false); suppress=false;active=trigger;pinned=true;
    if(!panel){panel=document.createElement('section');panel.id=`${id}-panel`;panel.dataset.disclosurePanel='';panel.className='disclosure-panel';panel.setAttribute('role','region');document.body.append(panel);}
    panel.replaceChildren();panel.setAttribute('aria-label',options.title);panel.hidden=false;
    const heading=document.createElement('h3');heading.textContent=options.title;
    const button=document.createElement('button');button.type='button';button.textContent='Close';button.addEventListener('click',()=>close(true));
    const content=document.createElement('div');panel.append(button,heading,content);options.renderDetails(content);
    trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','true');place();button.focus();
  }
  const escape=(event: KeyboardEvent)=>{if(event.key==='Escape' && active){suppress=true;close(pinned);}};
  const outside=(event: Event)=>{const node=event.target as Node;if(active && !active.contains(node) && !panel?.contains(node) && !preview?.contains(node))close(false);};
  document.addEventListener('keydown',escape); document.addEventListener('pointerdown',outside);document.addEventListener('click',outside);
  window.addEventListener('resize',place); document.addEventListener('scroll',place,true);
  const observer=new MutationObserver(()=>{if(!owner.isConnected){controller.dispose();return;}if(active && !visible(active))close(false);});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','aria-hidden']});
  const controller: DisclosureController={
    createTrigger(options){
      const trigger=document.createElement('button');trigger.type='button';trigger.className='disclosure-trigger';trigger.textContent=options.label;trigger.setAttribute('aria-label',options.accessibleLabel);trigger.setAttribute('aria-expanded','false');
      trigger.addEventListener('mouseenter',()=>show(trigger,options,true));trigger.addEventListener('mouseleave',delayedClose);
      trigger.addEventListener('focus',()=>show(trigger,options));trigger.addEventListener('blur',()=>{suppress=false;delayedClose();});
      trigger.addEventListener('click',()=>activate(trigger,options));return trigger;
    },
    closeWithin(root,restoreFocus=false){if(active && root.contains(active))close(restoreFocus);},
    dispose(){if(disposed)return;disposed=true;close(false);preview?.remove();panel?.remove();observer.disconnect();document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);document.removeEventListener('click',outside);window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);if(owners.get(owner)===controller)owners.delete(owner);},
  };
  owners.set(owner,controller);return controller;
}
