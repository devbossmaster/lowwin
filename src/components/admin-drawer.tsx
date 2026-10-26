'use client';
import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
export function AdminDrawer({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.querySelector('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close.current()}if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus()}},[]);
 return <div className="admin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><section className="admin-detail-drawer" ref={ref} role="dialog" aria-modal="true" aria-labelledby="admin-drawer-title"><header><h2 id="admin-drawer-title">{title}</h2><button className="secondary" aria-label="Close details" onClick={onClose}><X size={18}/></button></header><div>{children}</div></section></div>
}
