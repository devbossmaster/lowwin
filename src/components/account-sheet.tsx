'use client';

import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import styles from './account-sheet.module.css';
import {useSheetBack} from './use-sheet-back';
const FooterTarget=createContext<HTMLElement|null>(null);
export function AccountSheetFooter({children}:{children:ReactNode}){const target=useContext(FooterTarget);return target?createPortal(children,target):null}

/** Native modal focus containment, Escape handling, and focus restoration. Mount only while open. */
export function AccountSheet({title,onClose,children,footer,footerPortal=false,headerActions,returnFocusRef,size='content'}:{title:ReactNode;onClose:()=>void;children:ReactNode;footer?:ReactNode;footerPortal?:boolean;headerActions?:ReactNode;returnFocusRef?:RefObject<HTMLElement|null>;size?:'content'|'payment'}){
  const dismiss=useSheetBack(onClose);
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),close=useRef(onClose),titleId=useId();
  const {language}=useMiniLocale();
  const [footerTarget,setFooterTarget]=useState<HTMLElement|null>(null);
  close.current=dismiss;
  useEffect(()=>{
    const element=dialog.current,previous=document.activeElement as HTMLElement|null;
    const scroll=document.body.style.overflow,initialHeight=window.innerHeight;
    element?.showModal();document.body.style.overflow='hidden';closeButton.current?.focus({preventScroll:true});
    const viewport=window.visualViewport;let frame=0;
    const keyboardField=(node:Element|null)=>node instanceof HTMLElement&&(node.isContentEditable||node instanceof HTMLTextAreaElement||node instanceof HTMLSelectElement||node instanceof HTMLInputElement&&!['radio','checkbox','button','submit','reset','hidden','file','range','color'].includes(node.type));
    const fitViewport=()=>{
      if(!element)return;
      const height=viewport?.height??window.innerHeight,inset=Math.max(0,window.innerHeight-height-(viewport?.offsetTop??0));
      element.style.setProperty('--sheet-viewport-height',`${Math.round(height)}px`);
      element.style.setProperty('--sheet-keyboard-inset',`${Math.round(inset)}px`);
      const focused=document.activeElement;
      const keyboardOpen=focused instanceof HTMLElement&&element.contains(focused)&&keyboardField(focused)&&(height<initialHeight-100||inset>100);
      element.dataset.keyboardOpen=String(keyboardOpen);
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        const active=document.activeElement;
        if(keyboardOpen&&active instanceof HTMLElement&&element.contains(active)&&keyboardField(active))active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      });
    };
    fitViewport();window.addEventListener('resize',fitViewport);viewport?.addEventListener('resize',fitViewport);element?.addEventListener('focusin',fitViewport);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',fitViewport);viewport?.removeEventListener('resize',fitViewport);element?.removeEventListener('focusin',fitViewport);element?.close();document.body.style.overflow=scroll;requestAnimationFrame(()=>{const target=returnFocusRef?.current??previous;if(target?.isConnected)target.focus({preventScroll:true})})};
  },[]);
  return <dialog ref={dialog} className={styles.sheet} data-size={size} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();close.current()}} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close.current()}}}>
    <div className={styles.handle} aria-hidden="true"/>
    <header className={styles.header}><h2 id={titleId}>{title}</h2><div className={styles.headerActions}>{headerActions}<button ref={closeButton} type="button" onClick={dismiss} aria-label={language==='am'?'ዝጋ':'Close'}><X size={19} aria-hidden="true"/></button></div></header>
    <FooterTarget.Provider value={footerTarget}><div className={styles.body}>{children}</div></FooterTarget.Provider>
    {(footer||footerPortal)&&<footer ref={footerPortal?setFooterTarget:undefined} className={styles.footer}>{footer}</footer>}
  </dialog>;
}
