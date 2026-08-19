import { forwardRef, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Info, MoreHorizontal } from "lucide-react";

export const ActionButton=forwardRef<HTMLButtonElement,React.ButtonHTMLAttributes<HTMLButtonElement>&{tier?:"primary"|"secondary"|"quiet"}>(function ActionButton({tier="secondary",children,...props},ref){
  return <button ref={ref} {...props} className={["action-button",`action-${tier}`,props.className].filter(Boolean).join(" ")}>{children}</button>;
});

export type MenuItem={label:string;icon?:ReactNode;danger?:boolean;disabled?:boolean;onSelect:(invoker?:HTMLButtonElement|null)=>void};
export function AnchoredMenu({label,items,icon,primary=false}: {label:string;items:MenuItem[];icon?:ReactNode;primary?:boolean}){
  const [open,setOpen]=useState(false), root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), timer=useRef<number>(), id=useId();
  const close=()=>{window.clearTimeout(timer.current);setOpen(false)};
  useEffect(()=>{if(!open)return;const outside=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))close()};const keys=(e:KeyboardEvent)=>{if(e.key==="Escape"){close();root.current?.querySelector<HTMLButtonElement>("button")?.focus()}};document.addEventListener("mousedown",outside);document.addEventListener("keydown",keys);return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",keys)}},[open]);
  function keyDown(e:React.KeyboardEvent){const nodes=[...root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')??[]],at=nodes.indexOf(document.activeElement as HTMLButtonElement);if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();nodes[(at+(e.key==="ArrowDown"?1:-1)+nodes.length)%nodes.length]?.focus()}if(e.key==="Home"){e.preventDefault();nodes[0]?.focus()}if(e.key==="End"){e.preventDefault();nodes.at(-1)?.focus()}}
  return <div className="anchored-menu" ref={root} onPointerEnter={()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setOpen(true),120)}} onPointerLeave={()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setOpen(false),180)}}>
    <ActionButton ref={trigger} tier={primary?"primary":"secondary"} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(x=>!x)}>{icon}{label}<ChevronDown size={14}/></ActionButton>
    {open&&<div id={id} className="menu-popover" role="menu" aria-label={label} onKeyDown={keyDown}>{items.map((item,i)=><button key={`${item.label}-${i}`} role="menuitem" disabled={item.disabled} className={item.danger?"danger-item":undefined} onClick={()=>{close();item.onSelect(trigger.current)}}>{item.icon}{item.label}</button>)}</div>}
  </div>;
}

export function OverflowMenu({label,items}:{label:string;items:MenuItem[]}){return <AnchoredMenu label={label} icon={<MoreHorizontal size={17}/>} items={items}/>}

export function InfoPopover({label,children}:{label:string;children:ReactNode}){
  const [open,setOpen]=useState(false),root=useRef<HTMLSpanElement>(null),id=useId();
  useEffect(()=>{if(!open)return;const dismiss=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener("mousedown",dismiss);return()=>document.removeEventListener("mousedown",dismiss)},[open]);
  return <span className="info-control" ref={root} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><button aria-label={label} aria-describedby={open?id:undefined} aria-expanded={open} onFocus={()=>setOpen(true)} onBlur={e=>{if(!root.current?.contains(e.relatedTarget as Node))setOpen(false)}} onClick={()=>setOpen(x=>!x)}><Info size={14}/></button>{open&&<span className="info-popover" role="tooltip" id={id}>{children}</span>}</span>;
}

export function DetailDisclosure({label,storageKey,children}:{label:string;storageKey?:string;children:ReactNode}){
  const [open,setOpen]=useState(()=>{if(!storageKey)return false;try{return JSON.parse(localStorage.getItem(storageKey)??"false")===true}catch{return false}});
  useEffect(()=>{if(storageKey)localStorage.setItem(storageKey,JSON.stringify(open))},[open,storageKey]);
  return <details className="detail-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{label}<ChevronDown size={16}/></summary><div className="disclosure-body">{children}</div></details>;
}
