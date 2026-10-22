'use client';

import {useEffect,useId,useRef,type ReactNode,type RefObject} from 'react';
import {X} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import styles from './account-sheet.module.css';

/** Native modal focus containment, Escape handling, and focus restoration. Mount only while open. */
export function AccountSheet({title,onClose,children,footer,returnFocusRef}:{title:ReactNode;onClose:()=>void;children:ReactNode;footer?:ReactNode;returnFocusRef?:RefObject<HTMLElement|null>}){
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),close=useRef(onClose),titleId=useId();
  const {language}=useMiniLocale();
  close.current=onClose;
  useEffect(()=>{
    const element=dialog.current,previous=document.activeElement as HTMLElement|null;
    const scroll=document.body.style.overflow;
    element?.showModal();document.body.style.overflow='hidden';closeButton.current?.focus({preventScroll:true});
    const viewport=window.visualViewport;let frame=0;
    const fitViewport=()=>{
      if(!element)return;
      const height=viewport?.height??window.innerHeight,inset=Math.max(0,window.innerHeight-height-(viewport?.offsetTop??0));
      element.style.setProperty('--sheet-viewport-height',`${Math.round(height)}px`);
      element.style.setProperty('--sheet-keyboard-inset',`${Math.round(inset)}px`);
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        const active=document.activeElement;
        if(active instanceof HTMLElement&&element.contains(active)&&active.matches('input,textarea,select,[contenteditable="true"]'))active.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      });
    };
    fitViewport();window.addEventListener('resize',fitViewport);viewport?.addEventListener('resize',fitViewport);element?.addEventListener('focusin',fitViewport);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',fitViewport);viewport?.removeEventListener('resize',fitViewport);element?.removeEventListener('focusin',fitViewport);element?.close();document.body.style.overflow=scroll;requestAnimationFrame(()=>{const target=returnFocusRef?.current??previous;if(target?.isConnected)target.focus({preventScroll:true})})};
  },[]);
  return <dialog ref={dialog} className={styles.sheet} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();close.current()}} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close.current()}}}>
    <div className={styles.handle} aria-hidden="true"/>
    <header className={styles.header}><h2 id={titleId}>{title}</h2><button ref={closeButton} type="button" onClick={onClose} aria-label={language==='am'?'ዝጋ':'Close'}><X size={19} aria-hidden="true"/></button></header>
    <div className={styles.body}>{children}</div>
    {footer&&<footer className={styles.footer}>{footer}</footer>}
  </dialog>;
}
