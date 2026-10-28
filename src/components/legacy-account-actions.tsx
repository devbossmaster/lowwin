'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname,useSearchParams} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {chapaUuid} from '@/lib/chapa-client';

const WalletTopUpSheet=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet),{loading:()=>null});
const NotificationsInbox=dynamic(()=>import('./notifications-inbox').then(module=>module.NotificationsInbox),{loading:()=>null});

/** Compatibility URLs open current sheets, then remove the consumed intent. */
export function LegacyAccountActions(){
 const {queryIdentity,status}=useTelegram();
 return <AccountActionRoutes key={queryIdentity??'guest'} enabled={status==='authenticated'}/>;
}
function AccountActionRoutes({enabled}:{enabled:boolean}){
 const path=usePathname(),params=useSearchParams(),[open,setOpen]=useState<'topup'|'notifications'|null>(null),[returnId,setReturnId]=useState<string|undefined>();
 const candidate=params.get('chapa'),chapaId=params.getAll('chapa').length===1&&candidate&&chapaUuid.test(candidate)?candidate:undefined;
 const topup=path==='/profile'&&(params.get('topup')==='1'||!!chapaId),notifications=path==='/'&&params.get('notifications')==='1';
 useEffect(()=>{setOpen(null)},[path]);
 useEffect(()=>{
  if(!enabled||!topup&&!notifications)return;
  const url=new URL(window.location.href);url.searchParams.delete(topup?'topup':'notifications');
  // Clean the underlying route before the sheet adds its Back-button entry.
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  setReturnId(topup?chapaId:undefined);setOpen(topup?'topup':'notifications');
 },[enabled,path,topup,notifications,chapaId]);
 const close=()=>{setOpen(null);setReturnId(undefined);if(path==='/profile'){const url=new URL(window.location.href);url.searchParams.delete('chapa');url.searchParams.delete('topup');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}};
 if(!enabled)return null;
 if(open==='topup')return <WalletTopUpSheet onClose={close} initialChapaId={returnId}/>;
 if(open==='notifications')return <AccountSheet title={<MiniPhrase en="Notifications" am="ማሳወቂያዎች"/>} onClose={()=>setOpen(null)}><NotificationsInbox onNavigate={()=>setOpen(null)}/></AccountSheet>;
 return null;
}
