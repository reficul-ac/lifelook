import type {Issue,PlanDocument,ProjectionResult} from '../../engine';
import {createAllocationPreviewScheduler} from '../allocation-preview';
import {button,element,parseRateInput,setAt,type FieldPath} from '../fields';
import {revealField} from '../form-feedback';
import {normalizeFieldPath,type IssueViewContext} from '../issue-presentation';
import {prepareAllocationPreview,type RawObject,type WorkspaceController,type WorkspaceOperation} from '../state';
import {renderAllocationPie} from '../views/cash-flow-allocation';
import {formatCents} from '../views/issues';

const object=(value:unknown):RawObject=>value&&typeof value==='object'?value as RawObject:{};
const entries=(value:RawObject):RawObject[]=>Array.isArray(value.entries)?value.entries:[];
const workplace=(type?:string)=>type==='traditional-401k'||type==='roth-401k';
const retirement=(type?:string)=>workplace(type)||type==='traditional-ira'||type==='roth-ira';
let controlSequence=0;
interface Control {node:HTMLInputElement|HTMLSelectElement;error:HTMLElement;path:string;setPath(path:string):void}
interface Row {root:HTMLElement;legend:HTMLElement;destination:Control;priority:Control;sponsorHost:HTMLElement;sponsor?:Control|undefined;amountHost:HTMLElement;mode:string;maximum?:Control|undefined;percent?:Control|undefined;slider?:Control|undefined;readout:HTMLElement}

/** A separate policy transaction. Controls survive preview and unrelated record updates. */
export function mountCashFlowAllocationEditor(root:HTMLElement,controller:WorkspaceController,context:IssueViewContext):{dispose():void}{
  root.replaceChildren();root.classList.add('allocation-editor');
  const form=element('form');form.setAttribute('aria-label','Cash flow allocation');form.append(element('h2','Cash flow allocation'));
  const intro=element('p','Allocate the same annual cash flow after taxes and expenses. Existing deposits count toward each total account target.');form.append(intro);
  const yearHost=element('div'),rowHost=element('div'),overflowHost=element('div'),feedback=element('div'),status=element('p'),remaining=element('p'),chart=element('div');status.setAttribute('role','status');status.dataset.allocationStatus='';feedback.dataset.allocationFeedback='';remaining.dataset.allocationRemaining='';chart.dataset.allocationPreview='';
  form.append(yearHost,rowHost,button('Add allocation',add),overflowHost,button('Apply allocation',()=>controller.applyAllocation()),button('Discard allocation edits',()=>controller.discardAllocationDraft()),feedback,status,remaining,chart);root.append(form);form.addEventListener('submit',event=>{event.preventDefault();controller.applyAllocation();});
  let disposed=false,selectedYear=controller.getState().savedPlan.startYear,sequence=0;
  let lastValid:{plan:PlanDocument;projection:ProjectionResult}|undefined,previewStatus:'pending'|'valid'|'invalid'|'failed'|'inactive'='inactive',previewIssues:readonly Issue[]=[];
  let savedIdentity=controller.getState().savedPlan,draftIdentity=controller.getState().allocationDraft;
  const rows=new Map<string,Row>();let initialized=false;
  const draft=()=>controller.getAllocationDraft();
  const edit=(path:FieldPath,value:unknown)=>{const current=draft();controller.editAllocationDraft({...current,value:setAt(current.value,path,value)});};
  const index=(id:string)=>entries(draft().value).findIndex(row=>row.id===id);
  function field(host:HTMLElement,label:string,path:string,kind:'text'|'select'|'checkbox'|'range',write:(value:string|boolean)=>void):Control{
    const wrapper=element('div');wrapper.className='field-wrapper';const caption=element('label',label),node=kind==='select'?element('select'):element('input'),error=element('small');node.id=`allocation-field-${++controlSequence}`;caption.htmlFor=node.id;node.setAttribute('aria-label',label);node.dataset.fieldLabel=label;
    if(node instanceof HTMLInputElement){node.type=kind==='checkbox'?'checkbox':kind==='range'?'range':'text';if(kind==='range'){node.min='0';node.max='100';node.step='0.01';}else node.inputMode='decimal';}
    error.id=`${node.id}-error`;error.className='field-error';error.dataset.allocationFieldError='';wrapper.append(caption,node,error);host.append(wrapper);
    const control:Control={node,error,path,setPath(next){this.path=next;node.dataset.field=next;node.name=next;}};control.setPath(path);
    node.addEventListener(kind==='select'||kind==='checkbox'?'change':'input',()=>write(node instanceof HTMLInputElement&&node.type==='checkbox'?node.checked:node.value));return control;
  }
  const year=field(yearHost,'Allocation year','','select',value=>{selectedYear=Number(value);renderPreview();});delete year.node.dataset.field;
  const overflow=field(overflowHost,'Excess allocation account','overflow.destination.accountId','select',value=>edit(['overflow','destination'],destination(String(value))));
  overflow.node.parentElement!.dataset.fieldGroup='overflow.destination';overflow.node.parentElement!.dataset.groupLabel='Excess allocation account';
  const overflowSponsorHost=element('div');overflowHost.append(overflowSponsorHost);let overflowSponsor:Control|undefined;
  function options(control:Control,choices:readonly {value:string;label:string}[],value:string){
    const node=control.node as HTMLSelectElement,next=[...choices];if(!next.some(choice=>choice.value===value))next.push({value,label:`Unavailable (${value||'no selection'})`});
    const signature=JSON.stringify(next);if(node.dataset.options!==signature){node.replaceChildren(...next.map(choice=>{const option=element('option',choice.label);option.value=choice.value;return option;}));node.dataset.options=signature;}if(node.value!==value)node.value=value;
  }
  function destination(value:string):RawObject{return value==='cash'?{kind:'cash'}:{kind:'account',accountId:value};}
  function add(){
    const used=new Set<string>();const scan=(value:unknown)=>{if(!value||typeof value!=='object')return;const raw=object(value);if(typeof raw.id==='string')used.add(raw.id);Object.values(raw).forEach(scan);};scan(controller.getState());scan(draft().value);let id:string;do{id=`allocation-entry-${++sequence}`;}while(used.has(id));
    edit(['entries'],[...entries(draft().value),{id,priority:String(entries(draft().value).length+1),destination:{kind:'cash'},amount:{kind:'percent',percentBps:'0.00'}}]);
  }
  function createRow(id:string):Row{
    const row=element('fieldset'),legend=element('legend');row.append(legend);
    const dest=field(row,'Allocation destination','','select',value=>{
      const i=index(id);if(i<0)return;const current=draft(),next=setAt(current.value,['entries',i,'destination'],destination(String(value))),account=controller.getState().savedPlan.accounts.find(a=>a.id===value);
      if(object(entries(next)[i]?.amount).kind==='max-annual'&&!retirement(account?.type))entries(next)[i]!.amount={kind:'percent',percentBps:'0.00'};
      controller.editAllocationDraft({...current,value:next});
    });
    const priority=field(row,'Allocation priority','','text',value=>edit(['entries',index(id),'priority'],value));priority.node.inputMode='numeric';
    const sponsorHost=element('div'),amountHost=element('div'),readout=element('p');readout.dataset.allocationReadout=id;row.append(sponsorHost,amountHost,readout,button('Remove allocation',()=>edit(['entries'],entries(draft().value).filter(entry=>entry.id!==id))));
    return {root:row,legend,destination:dest,priority,sponsorHost,amountHost,readout,mode:''};
  }
  function syncSponsor(host:HTMLElement,current:Control|undefined,dest:RawObject,path:string,label:string,write:(value:string|boolean)=>void):Control|undefined{
    const plan=controller.getState().savedPlan,account=plan.accounts.find(a=>a.id===dest.accountId);
    if(dest.kind!=='account'||!workplace(account?.type)){host.replaceChildren();return undefined;}
    const control=current??field(host,label,path,'select',write);control.setPath(path);
    options(control,[{value:'',label:'Choose the sponsoring employer’s salary'},...plan.salaries.filter(s=>s.ownerId===account?.ownerId).map(s=>({value:s.id,label:s.name}))],String(dest.sponsoringSalaryId??''));return control;
  }
  function syncControls(){
    const state=controller.getState(),current=draft(),plan=state.savedPlan;form.dataset.recordId=current.recordId;
    selectedYear=Math.max(plan.startYear,Math.min(plan.startYear+plan.horizonYears-1,selectedYear));options(year,Array.from({length:plan.horizonYears},(_,i)=>({value:String(plan.startYear+i),label:String(plan.startYear+i)})),String(selectedYear));
    const choices=[{value:'cash',label:'Cash / savings'},...plan.accounts.filter(a=>a.type!=='rsu').map(a=>({value:a.id,label:a.name}))],active=new Set<string>();
    entries(current.value).forEach((entry,i)=>{
      const id=String(entry.id);active.add(id);let row=rows.get(id);if(!row){row=createRow(id);rows.set(id,row);rowHost.append(row.root);}row.legend.textContent=`Allocation ${i+1}`;
      const prefix=`entries.${i}`,dest=object(entry.destination),amount=object(entry.amount),account=plan.accounts.find(a=>a.id===dest.accountId);
      row.amountHost.dataset.fieldGroup=`${prefix}.amount`;row.amountHost.dataset.groupLabel='Allocation amount';
      row.destination.node.parentElement!.dataset.fieldGroup=`${prefix}.destination`;row.destination.setPath(`${prefix}.destination.accountId`);options(row.destination,choices,dest.kind==='cash'?'cash':String(dest.accountId??''));row.priority.setPath(`${prefix}.priority`);if(row.priority.node.value!==String(entry.priority??''))row.priority.node.value=String(entry.priority??'');
      row.sponsor=syncSponsor(row.sponsorHost,row.sponsor,dest,`${prefix}.destination.sponsoringSalaryId`,'Allocation sponsoring salary',value=>edit(['entries',index(id),'destination','sponsoringSalaryId'],value||undefined));
      const mode=`${retirement(account?.type)}:${amount.kind}`;
      if(row.mode!==mode){
        context.disclosures.closeWithin(row.amountHost,false);row.amountHost.replaceChildren();row.maximum=row.percent=row.slider=undefined;row.mode=mode;
        if(retirement(account?.type))row.maximum=field(row.amountHost,'Max out for the year',`${prefix}.amount.kind`,'checkbox',value=>edit(['entries',index(id),'amount'],value?{kind:'max-annual'}:{kind:'percent',percentBps:'0.00'}));
        if(amount.kind==='max-annual')row.amountHost.append(element('p',retirement(account?.type)?'Automatic annual maximum · calculated for the selected year.':'Annual maximum is unavailable for this destination. Choose an eligible retirement account.'));
        else {
          row.percent=field(row.amountHost,'Allocation percentage (%)',`${prefix}.amount.percentBps`,'text',value=>edit(['entries',index(id),'amount','percentBps'],value));
          row.slider=field(row.amountHost,'Allocation percentage slider',`${prefix}.amount.percentBps`,'range',value=>edit(['entries',index(id),'amount','percentBps'],Number(value).toFixed(2)));
          // The exact text is the canonical review target; the range shares its value.
          delete row.slider.node.dataset.field;
        }
      }
      row.maximum?.setPath(`${prefix}.amount.kind`);if(row.maximum)(row.maximum.node as HTMLInputElement).checked=amount.kind==='max-annual';
      row.percent?.setPath(`${prefix}.amount.percentBps`);if(row.percent){const raw=String(amount.percentBps??'');if(row.percent.node.value!==raw)row.percent.node.value=raw;const parsed=parseRateInput(raw);if(parsed.status==='available'&&parsed.value>=0&&parsed.value<=10000&&row.slider)row.slider.node.value=String(parsed.value/100);}
    });
    for(const [id,row] of rows)if(!active.has(id)){context.disclosures.closeWithin(row.root,false);row.root.remove();rows.delete(id);}
    const dest=object(object(current.value.overflow).destination);options(overflow,choices,dest.kind==='cash'?'cash':String(dest.accountId??''));overflowSponsor=syncSponsor(overflowSponsorHost,overflowSponsor,dest,'overflow.destination.sponsoringSalaryId','Excess sponsoring salary',value=>edit(['overflow','destination','sponsoringSalaryId'],value||undefined));
  }
  function syncFeedback(issues:readonly Issue[]){
    context.disclosures.closeWithin(feedback,false);feedback.replaceChildren();for(const control of form.querySelectorAll<HTMLElement>('[data-field]')){control.removeAttribute('aria-invalid');control.removeAttribute('aria-describedby');}for(const error of form.querySelectorAll<HTMLElement>('[data-allocation-field-error]'))error.replaceChildren();
    const current=draft();const seen=new Set<string>();
    for(const issue of issues){
      let path=normalizeFieldPath(issue.field??'').replace(/^cashFlowAllocation\.?/,'');const i=entries(current.value).findIndex(row=>row.id===issue.recordId);if(i>=0&&!path.startsWith('entries.'))path=`entries.${i}${path?'.'+path:''}`;
      const relevant=issue.recordId===current.recordId||i>=0||issue.recordId===object(current.value.overflow).id||issue.field?.startsWith('cashFlowAllocation');if(!relevant)continue;if(issue.recordId===object(current.value.overflow).id&&!path.startsWith('overflow'))path=`overflow${path?'.'+path:''}`;
      const key=JSON.stringify(issue);if(seen.has(key))continue;seen.add(key);
      const control=[...form.querySelectorAll<HTMLElement>('[data-field]')].find(node=>node.dataset.field===path)||[...form.querySelectorAll<HTMLElement>('[data-field]')].find(node=>node.dataset.field?.startsWith(path+'.'));
      const message=path.endsWith('percentBps')&&issue.code==='invalid-input'?(issue.explanation.startsWith('An integer from ')?'Enter a percentage from 0% to 100%.':issue.explanation.includes('ordinary decimal')?'Use a percentage with up to 2 decimal places, without commas.':issue.explanation):issue.explanation;
      const label=control?.dataset.fieldLabel??'Cash flow allocation',line=element('p',message+' ');
      if(control){const error=control.parentElement?.querySelector<HTMLElement>('[data-allocation-field-error]');if(error){error.textContent=message;if(issue.severity==='error'){control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',error.id);}}line.append(button(`Review ${label}`,()=>{context.disclosures.closeWithin(root,false);revealField(form,control.dataset.field!.split('.'));}));revealField(form,control.dataset.field!.split('.'),false);}
      line.append(context.disclosures.createTrigger({label:'Details',accessibleLabel:`Details: ${label} allocation input`,title:`${label} · allocation input`,preview:message,renderDetails:node=>node.append(element('p',issue.explanation),element('p',issue.resolution))}));feedback.append(line);
    }
  }
  function renderPreview(){
    status.textContent=previewStatus==='inactive'?'No allocation policy applied.':previewStatus==='valid'?(controller.getState().allocationDraft?'Allocation preview · edits not applied':'Applied allocation'):previewStatus==='pending'?(lastValid?'Stale preview · updating allocation preview.':'Updating allocation preview.'):previewStatus==='invalid'?(lastValid?'Invalid allocation edits · Stale preview shows the last valid allocation.':'Invalid allocation edits · no valid preview available.'):(lastValid?'Allocation preview failed · Stale preview shows the last valid allocation.':'Allocation preview failed · no valid preview available.');
    const report=lastValid?.projection.years.find(year=>year.year===selectedYear)?.cashFlowAllocation;
    if(report&&lastValid)renderAllocationPie(chart,report,lastValid.plan,context);else{context.disclosures.closeWithin(chart,false);chart.replaceChildren();}
    remaining.textContent='';
    if(report?.status==='available'){
      const value=report.value,percent=(cents:number)=>value.originalCashFlowCents>0?`${(cents/value.originalCashFlowCents*100).toFixed(2)}%`:'N/A · no positive budget';
      remaining.textContent=`Remaining before excess: ${formatCents(value.excessOfferedCents)} · ${percent(value.excessOfferedCents)} of original cash flow.`;
      for(const [id,row] of rows){const source=lastValid?.plan.cashFlowAllocation?.entries.find(entry=>entry.id===id);if(!source){row.readout.textContent='Preview pending for this allocation.';continue;}
        const request=source.amount.kind==='percent'?`Requested: ${(source.amount.percentBps/100).toFixed(2)}%. `:'Automatic annual maximum. ';
        if(source.destination.kind==='cash')row.readout.textContent=`${request}Saving target: ${formatCents(value.explicitCashTargetCents)} · Actual earmark: ${formatCents(value.explicitCashCents)} · Actual share: ${percent(value.explicitCashCents)} · Shortfall: ${formatCents(value.explicitCashShortfallCents)}.`;
        else{const accountId=source.destination.accountId,account=value.accounts.find(account=>account.accountId===accountId);row.readout.textContent=account?`${request}Total target: ${formatCents(account.targetCents)} · ${percent(account.targetCents)}. Actual funded: ${formatCents(account.actualCents)} · Actual share: ${percent(account.actualCents)}. Existing deposits included: ${formatCents(account.existingCents)}. Annual maximum top up: ${formatCents(account.maximumCents)}. Shortfall: ${formatCents(account.shortfallCents)}.`:'Funding is unavailable for this destination.';}
      }
    }else for(const row of rows.values())row.readout.textContent=report?'Funding is unavailable for the selected year.':'No valid funding preview for the selected year.';
  }
  const scheduler=createAllocationPreviewScheduler(controller,preview=>{
    if(disposed)return;
    if(preview.status==='calculated'){const prepared=prepareAllocationPreview(controller);if(prepared.status!=='ready')return;lastValid={plan:prepared.plan,projection:preview.projection};previewStatus='valid';previewIssues=[];}else{previewStatus=preview.status;previewIssues=preview.issues;}
    syncFeedback([...previewIssues,...controller.getState().issues]);renderPreview();
  });
  function update(operation?:WorkspaceOperation){
    if(disposed)return;const state=controller.getState(),changed=state.savedPlan!==savedIdentity||state.allocationDraft!==draftIdentity;
    if(initialized&&!changed&&!operation)return;initialized=true;
    const cleared=draftIdentity!==undefined&&state.allocationDraft===undefined;savedIdentity=state.savedPlan;draftIdentity=state.allocationDraft;syncControls();
    if(cleared||changed&&!state.allocationDraft){lastValid=state.savedPlan.cashFlowAllocation?{plan:state.savedPlan,projection:state.projection}:undefined;previewStatus=lastValid?'valid':'inactive';previewIssues=[];}
    else if(changed&&state.allocationDraft){previewStatus='pending';previewIssues=[];scheduler.request();}
    if(operation?.kind==='save'&&operation.recordId===draft().recordId&&!operation.result.accepted){previewIssues=operation.result.issues;previewStatus=previewIssues.some(issue=>issue.code==='calculation-failed')?'failed':'invalid';}
    syncFeedback([...previewIssues,...state.issues]);renderPreview();
  }
  const unsubscribe=controller.subscribe(update);
  if(savedIdentity.cashFlowAllocation){lastValid={plan:savedIdentity,projection:controller.getState().projection};previewStatus='valid';}
  update();if(draftIdentity){previewStatus='pending';scheduler.request();renderPreview();}
  return {dispose(){if(disposed)return;disposed=true;unsubscribe();scheduler.dispose();context.disclosures.closeWithin(root,false);}};
}
