'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {Toaster,toast} from 'sonner';
import {useMiniLocale} from './mini-locale';
import {CelebrationProvider} from './celebration';
import styles from './mini-notice.module.css';

type NoticeKind='success'|'error'|'info';
type NoticeOptions={id?:string;duration?:number};
type Notify=(message:string,kind?:NoticeKind,options?:NoticeOptions)=>void;
type NoticeDelivery=NoticeOptions&{toasterId?:string;onDismiss?:()=>void;onAutoClose?:()=>void};
type NoticeDispatch={show:(message:string,kind:NoticeKind,options:NoticeDelivery)=>string|number;dismiss:(id:string|number)=>void};
const NoticeContext=createContext<Notify>(()=>{});
const NoticeTargetContext=createContext<(id:string)=>(()=>void)>(()=>()=>{});
export const useMiniNotice=()=>useContext(NoticeContext);

/** Route each notice once, including callbacks created before a native dialog opens. */
export function createMiniNoticeRouting(dispatch:NoticeDispatch,onTargetChange:(id:string|null)=>void=()=>{}){
  const targets:{id:string;notices:Set<string|number>}[]=[];
  const activate=(id:string)=>{
    const target={id,notices:new Set<string|number>()};targets.push(target);onTargetChange(id);
    return()=>{
      const index=targets.indexOf(target);if(index<0)return;
      targets.splice(index,1);for(const notice of target.notices)dispatch.dismiss(notice);
      target.notices.clear();onTargetChange(targets.at(-1)?.id??null);
    };
  };
  const notify:Notify=(message,kind='info',options)=>{
    const target=targets.at(-1);
    let notice:string|number;
    const forget=()=>target?.notices.delete(notice);
    notice=dispatch.show(message,kind,{...options,...(target?{toasterId:target.id,id:options?.id?`${target.id}:${options.id}`:undefined}:{}),onDismiss:forget,onAutoClose:forget});
    target?.notices.add(notice);
  };
  return {activate,notify};
}

/** AccountSheet activates only after showModal, in the same order as the top layer. */
export function useMiniNoticeTarget(id:string){
  const activate=useContext(NoticeTargetContext);
  return useCallback(()=>activate(id),[activate,id]);
}

/** Descendant of the native dialog: z-index alone cannot escape its inert backdrop. */
export function MiniSheetToaster({id}:{id:string}){
  const {language}=useMiniLocale(),am=language==='am',previousFocus=useRef<HTMLElement|null>(null);
  const restoreFocus=(container:HTMLElement)=>{
    const dialog=container.closest('dialog'),target=previousFocus.current;
    requestAnimationFrame(()=>{
      if(!dialog?.open)return;
      if(target?.isConnected&&dialog.contains(target))target.focus({preventScroll:true});
      else dialog.querySelector<HTMLElement>('[data-sheet-close]')?.focus({preventScroll:true});
    });
  };
  return <div className={styles.sheetNotices} data-sheet-notices onFocusCapture={event=>{
    if(event.relatedTarget instanceof HTMLElement&&!event.currentTarget.contains(event.relatedTarget))previousFocus.current=event.relatedTarget;
  }} onClickCapture={event=>{
    if(event.target instanceof Element&&event.target.closest('[data-close-button]')&&event.currentTarget.contains(document.activeElement))restoreFocus(event.currentTarget);
  }} onKeyDownCapture={event=>{
    if(event.key!=='Escape'||!(event.target instanceof Element))return;
    const notice=event.target.closest('[data-sonner-toast]'),dismiss=notice?.querySelector<HTMLButtonElement>('[data-close-button]');
    if(dismiss){event.preventDefault();event.stopPropagation();dismiss.click();restoreFocus(event.currentTarget)}
  }}><Toaster id={id} className={styles.sheetToaster} position="top-center" hotkey={[]} closeButton visibleToasts={2} duration={5000} offset={12} mobileOffset={12} containerAriaLabel={am?'ማሳወቂያዎች':'Notifications'} toastOptions={{style:{fontFamily:"'Inter', 'Lowwin Ethiopic', sans-serif"},closeButtonAriaLabel:am?'ማሳወቂያውን ዝጋ':'Dismiss notification'}}/></div>;
}

export function MiniNoticeProvider({children}:{children:React.ReactNode}){
  const {language}=useMiniLocale(),am=language==='am';
  const [activeTarget,setActiveTarget]=useState<string|null>(null);
  const routing=useRef<ReturnType<typeof createMiniNoticeRouting>|null>(null);
  if(!routing.current)routing.current=createMiniNoticeRouting({show:(message,kind,options)=>toast[kind](message,options),dismiss:id=>{toast.dismiss(id)}},setActiveTarget);
  useEffect(()=>()=>{toast.dismiss()},[]);
  const top='calc(16px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))';
  return <NoticeContext.Provider value={routing.current.notify}><NoticeTargetContext.Provider value={routing.current.activate}><CelebrationProvider>{children}</CelebrationProvider></NoticeTargetContext.Provider><Toaster position="top-right" hotkey={activeTarget?[]:undefined} closeButton richColors visibleToasts={2} duration={5000} offset={{top,right:16}} mobileOffset={{top,left:16,right:16}} containerAriaLabel={am?'ማሳወቂያዎች':'Notifications'} toastOptions={{style:{fontFamily:"'Inter', 'Lowwin Ethiopic', sans-serif",fontSize:13},closeButtonAriaLabel:am?'ማሳወቂያውን ዝጋ':'Dismiss notification'}}/></NoticeContext.Provider>;
}
