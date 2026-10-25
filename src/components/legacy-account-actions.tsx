'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname,useSearchParams} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';

const WalletTopUpSheet=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet),{loading:()=>null});
const NotificationsInbox=dynamic(()=>import('./notifications-inbox').then(module=>module.NotificationsInbox),{loading:()=>null});

/** Compatibility URLs open current sheets, then remove the consumed intent. */
export function LegacyAccountActions(){
 const {queryIdentity,status}=useTelegram();
 return <AccountActionRoutes key={queryIdentity??'guest'} enabled={status==='authenticated'}/>;
}
function AccountActionRoutes({enabled}:{enabled:boolean}){
 const path=usePathname(),params=useSearchParams(),[open,setOpen]=useState<'topup'|'notifications'|null>(null);
 const topup=path==='/profile'&&params.get('topup')==='1',notifications=path==='/'&&params.get('notifications')==='1';
 useEffect(()=>{setOpen(null)},[path]);
 useEffect(()=>{
  if(!enabled||!topup&&!notifications)return;
  const url=new URL(window.location.href);url.searchParams.delete(topup?'topup':'notifications');
  // Clean the underlying route before the sheet adds its Back-button entry.
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  setOpen(topup?'topup':'notifications');
 },[enabled,path,topup,notifications]);
 if(!enabled)return null;
 if(open==='topup')return <WalletTopUpSheet onClose={()=>setOpen(null)}/>;
 if(open==='notifications')return <AccountSheet title={<MiniPhrase en="Notifications" am="ማሳወቂያዎች"/>} onClose={()=>setOpen(null)}><NotificationsInbox onNavigate={()=>setOpen(null)}/></AccountSheet>;
 return null;
}
