'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRef,useState,type ReactNode} from 'react';
import {useTelegram} from './telegram-provider';
import {warmTopUpConfiguration} from './top-up-prefetch';
const WalletOverview=dynamic(()=>import('./wallet-overview'),{loading:()=>null});
export function WalletOverviewTrigger({children,className,ariaLabel,title,ariaBusy,disabled=false}:{children:ReactNode;className?:string;ariaLabel?:string;title?:string;ariaBusy?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLAnchorElement>(null);
 const {queryIdentity}=useTelegram();
 const warm=()=>{if(!disabled){warmTopUpConfiguration(queryIdentity);void import('./wallet-overview');void import('./wallet-top-up')}};
 return <><Link ref={trigger} href="/profile#wallet" prefetch={false} className={className} aria-label={ariaLabel} title={title} aria-busy={ariaBusy||undefined} aria-disabled={disabled||undefined} tabIndex={disabled?-1:undefined} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} onClick={event=>{if(disabled){event.preventDefault();return}if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();warm();setOpen(true)}}}>{children}</Link>{open&&<WalletOverview onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
