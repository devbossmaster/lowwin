'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import styles from './mini-select.module.css';

type Option={value:string;label:string};
export function MiniSelect({label,value,options,onChange,disabled=false}:{label:string;value:string;options:Option[];onChange:(value:string)=>void;disabled?:boolean}){
  const id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  const selected=Math.max(0,options.findIndex(option=>option.value===value));
  useEffect(()=>{
    if(!open)return;
    root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[selected]?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open,selected]);
  return <div className={styles.select} ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();return}
    if(!open||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  }}>
    <button ref={trigger} className={styles.trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>setOpen(current=>!current)} onKeyDown={event=>{if(!open&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true)}}}>
      <span>{options[selected]?.label}</span><ChevronDown size={17} aria-hidden="true"/>
    </button>
    {open&&<div id={id} className={styles.options} role="listbox" aria-label={label}>{options.map(option=><button key={option.value} type="button" role="option" aria-selected={option.value===value} tabIndex={-1} onClick={()=>{setOpen(false);trigger.current?.focus();if(option.value!==value)onChange(option.value)}}><span>{option.label}</span>{option.value===value&&<Check size={16} aria-hidden="true"/>}</button>)}</div>}
  </div>;
}
