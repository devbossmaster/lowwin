'use client';
import {createContext,useCallback,useContext,useEffect} from 'react';
import {Toaster,toast} from 'sonner';
import {useMiniLocale} from './mini-locale';

type NoticeKind='success'|'error'|'info';
const NoticeContext=createContext<(message:string,kind?:NoticeKind)=>void>(()=>{});
export const useMiniNotice=()=>useContext(NoticeContext);

export function MiniNoticeProvider({children}:{children:React.ReactNode}){
  const {language}=useMiniLocale(),am=language==='am';
  const notify=useCallback((message:string,kind:NoticeKind='info')=>{toast[kind](message)},[]);
  useEffect(()=>()=>{toast.dismiss()},[]);
  const bottom='calc(90px + env(safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px))';
  return <NoticeContext.Provider value={notify}>{children}<Toaster position="bottom-center" closeButton richColors visibleToasts={2} duration={5000} offset={{bottom}} mobileOffset={{bottom,left:16,right:16}} containerAriaLabel={am?'ማሳወቂያዎች':'Notifications'} toastOptions={{style:{fontFamily:"'Poppins', 'Lowwin Ethiopic', sans-serif",fontSize:13},closeButtonAriaLabel:am?'ማሳወቂያውን ዝጋ':'Dismiss notification'}}/></NoticeContext.Provider>;
}
