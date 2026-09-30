'use client';
import {createContext,useCallback,useContext,useEffect} from 'react';
import {Toaster,toast} from 'sonner';
import {useMiniLocale} from './mini-locale';
import {CelebrationProvider} from './celebration';

type NoticeKind='success'|'error'|'info';
type NoticeOptions={id?:string;duration?:number};
const NoticeContext=createContext<(message:string,kind?:NoticeKind,options?:NoticeOptions)=>void>(()=>{});
export const useMiniNotice=()=>useContext(NoticeContext);

export function MiniNoticeProvider({children}:{children:React.ReactNode}){
  const {language}=useMiniLocale(),am=language==='am';
  const notify=useCallback((message:string,kind:NoticeKind='info',options?:NoticeOptions)=>{toast[kind](message,options)},[]);
  useEffect(()=>()=>{toast.dismiss()},[]);
  const top='calc(16px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))';
  return <NoticeContext.Provider value={notify}><CelebrationProvider>{children}</CelebrationProvider><Toaster position="top-right" closeButton richColors visibleToasts={2} duration={5000} offset={{top,right:16}} mobileOffset={{top,left:16,right:16}} containerAriaLabel={am?'ማሳወቂያዎች':'Notifications'} toastOptions={{style:{fontFamily:"'Poppins', 'Lowwin Ethiopic', sans-serif",fontSize:13},closeButtonAriaLabel:am?'ማሳወቂያውን ዝጋ':'Dismiss notification'}}/></NoticeContext.Provider>;
}
