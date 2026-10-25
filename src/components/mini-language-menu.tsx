'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Check,ChevronDown,Languages} from 'lucide-react';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

/** The compact account language control, shared in presentation and locale state. */
export function MiniLanguageMenu(){
 const {language,setLanguage,t}=useMiniLocale(),[open,setOpen]=useState(false);
 const container=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[open]);
 function moveFocus(event:ReactKeyboardEvent<HTMLDivElement>){
  const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]),index=options.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();
  }else if(event.key==='Tab'){setOpen(false);button.current?.focus()}
 }
 return <div className={styles.language} ref={container}>
  <button ref={button} type="button" className={styles.languageButton} aria-label={`${t('language')}: ${language==='en'?'English':'አማርኛ'}`} aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true)}}}><Languages size={16} strokeWidth={1.75} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'EN':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={open} size={10} strokeWidth={1.75} aria-hidden="true"/></button>
  {open&&<div ref={menu} id={id} className={styles.languageMenu} role="menu" aria-label={t('language')} onKeyDown={moveFocus}>{([['en','English'],['am','አማርኛ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} lang={value} onClick={()=>{setLanguage(value as MiniLanguage);setOpen(false);button.current?.focus()}}><span>{label}</span>{language===value&&<Check size={15} strokeWidth={1.75} aria-hidden="true"/>}</button>)}</div>}
 </div>;
}
