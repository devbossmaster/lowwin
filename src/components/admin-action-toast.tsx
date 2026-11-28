'use client';

import {useEffect,useId} from 'react';
import {Toaster,toast,type ExternalToast} from 'sonner';

const adminToasterId='lowwin-admin';
type NoticeKind='success'|'error'|'info';
type NoticeOptions=Pick<ExternalToast,'action'|'id'>;

export function notifyAdminAction(message:string,kind:NoticeKind='success',options:NoticeOptions={}){
 return toast[kind](message,{toasterId:adminToasterId,duration:kind==='error'?7000:3000,...options});
}

export function AdminActionToastHost(){
 return <Toaster id={adminToasterId} position="top-right" offset={20} mobileOffset={12} closeButton richColors visibleToasts={3} containerAriaLabel="Admin notifications" toastOptions={{style:{fontFamily:'var(--font-sans)'},closeButtonAriaLabel:'Dismiss notification'}}/>;
}

export function AdminActionToast({message,kind='info'}:{message:string|null|undefined;kind?:NoticeKind}){
 const id=useId();
 useEffect(()=>{
  if(!message)return;
  notifyAdminAction(message,kind,{id});
  return()=>{toast.dismiss(id)};
 },[id,kind,message]);
 return null;
}
