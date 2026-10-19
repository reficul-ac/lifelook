import { element,type FieldContext,type FieldPath } from '../fields';
import { registerFormSummary } from '../form-feedback';
import {fieldMemory,swapMode} from '../record-ui-state';
import { toDraftValue,type RawObject,type WorkspaceController } from '../state';
import { at,bookAmounts,books,booleanHistory,details,displayed,field,group,moneyHistory,rows,unknown,unknownCount,zeroBook } from './property-fields-shared';
function historyBook(root:HTMLElement,context:FieldContext,path:FieldPath,name:string):void {
  const history=at(context,path) as {known?:boolean;value?:RawObject}|undefined;
  const isZero=history?.known&&bookAmounts.every(([key])=>history.value?.[key]==='0.00')&&Array.isArray(history.value?.lossVintages)&&history.value.lossVintages.length===0;
  const shortName=name.replace(' rental tax history',' history'),owner=at(context,path.slice(0,-2)) as RawObject;const disclosure=details(root,shortName,{key:`${String(owner.id)}:${String(path[path.length-1])}`,status:!history?.known?'Unknown':isZero?'Confirmed zero':'Entered amounts'});disclosure.dataset.fieldGroup=path.join('.');registerFormSummary(disclosure,()=>{const current=at(context,path) as {known?:boolean;value?:RawObject}|undefined;return !current?.known?'Unknown':bookAmounts.every(([key])=>/^0(?:\.0{1,2})?$/.test(String(current.value?.[key]??'')))&&Array.isArray(current.value?.lossVintages)&&current.value.lossVintages.length===0?'Confirmed zero':'Entered amounts';});const section=group(disclosure,'Opening amounts');
  field(section,displayed(context,path,history?.known?isZero?'known-zero':'known':'unknown',value=>{
    const current=at(context,path) as {known?:boolean;value?:RawObject}|undefined,from=!current?.known?'unknown':bookAmounts.every(([key])=>/^0(?:\.0{1,2})?$/.test(String(current.value?.[key]??'')))&&Array.isArray(current.value?.lossVintages)&&current.value.lossVintages.length===0?'known-zero':'known';
    const fallback=value==='unknown'?unknown():{known:true,value:value==='known-zero'?toDraftValue(zeroBook):Object.fromEntries([...bookAmounts.map(([key])=>[key,'']),['lossVintages',[]]])};context.onChange(path,context.memory?swapMode(fieldMemory(context),`rental-history:${path.join('.')}`,from,String(value),current??unknown(),fallback):fallback);context.refresh();
  }),path,'History status',{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter amounts'},{value:'known-zero',label:'All amounts and losses are zero'}]});
  if(!history?.known)return;
  for(const [key,label]of bookAmounts)field(section,context,[...path,'value',key],label,{kind:'money'});
  const losses=group(section,'Rental loss history');losses.dataset.fieldGroup=[...path,'value','lossVintages'].join('.');losses.dataset.groupLabel='Rental loss history';
  rows(losses,context,[...path,'value','lossVintages'],'Rental loss vintage','Add rental loss vintage','Remove rental loss vintage',()=>({year:'',source:'passive',amountCents:'',activeParticipation:unknown(),qbiQualification:unknown()}),(row,p)=>{
    field(row,context,[...p,'year'],'Loss year',{kind:'integer'});field(row,context,[...p,'source'],'Loss source',{kind:'select',options:[{value:'at-risk',label:'At-risk'},{value:'passive',label:'Passive'}]});field(row,context,[...p,'amountCents'],'Loss amount',{kind:'money'});
    booleanHistory(row,context,[...p,'activeParticipation'],'Participation when loss arose');booleanHistory(row,context,[...p,'qbiQualification'],'QBI qualification when loss arose');
  });
}

export function renderPropertyHistory(root:HTMLElement,_controller:WorkspaceController,context:FieldContext):void {
 for(const [index,unit] of (at(context,['rentals']) as RawObject[]).entries()){
 const path:FieldPath=['rentals',index],project=at(context,['property','aduProject']) as RawObject|undefined,isProject=project?.rentalId===unit.id,node=details(root,`Rental tax and history — ${index+1}`,{key:`${String(unit.id)}:all-history`,status:`${unknownCount(unit)} unknown facts`});
 if(!isProject){for(const [book,label]of books)historyBook(node,context,[...path,'taxHistory',book],label);}
  const qbiDisclosure=details(node,'QBI history',{key:`${String(unit.id)}:qbi`,status:`${unknownCount(unit.qbi)} unknown facts`});qbiDisclosure.dataset.fieldGroup=[...path,'qbi'].join('.');registerFormSummary(qbiDisclosure,()=>`${unknownCount(at(context,[...path,'qbi']))} unknown facts`);const qbi=group(qbiDisclosure,'Qualified business income');booleanHistory(qbi,context,[...path,'qbi','qualification'],'QBI qualification');moneyHistory(qbi,context,[...path,'qbi','wagesCents'],'QBI wages');moneyHistory(qbi,context,[...path,'qbi','ubiaCents'],'Unadjusted qualified property basis (UBIA)');
  if(!isProject){const lossPath=[...path,'qbi','openingLossVintages'],losses=at(context,lossPath) as {known?:boolean;value?:readonly RawObject[]}|undefined;
  field(qbi,displayed(context,lossPath,losses?.known?'known':'unknown',value=>{context.onChange(lossPath,value==='known'?{known:true,value:[]}:unknown());context.refresh();}),lossPath,'QBI loss history',{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter losses'}]});
  if(losses?.known)qbi.append(element('small','No rows means confirmed no prior losses.'));
  if(losses?.known)rows(qbi,context,[...lossPath,'value'],'QBI loss vintage','Add QBI loss vintage','Remove QBI loss vintage',()=>({year:'',amountCents:''}),(row,p)=>{field(row,context,[...p,'year'],'Loss year',{kind:'integer'});field(row,context,[...p,'amountCents'],'Loss amount',{kind:'money'});});
  }else qbi.append(element('small','New-rental prior QBI losses start at confirmed zero; forecast losses carry forward automatically.'));

 }
}
