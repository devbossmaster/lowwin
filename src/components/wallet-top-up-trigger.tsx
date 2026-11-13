'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRef,useState,type ReactNode} from 'react';
import {useTelegram} from './telegram-provider';
import {warmTopUpConfiguration} from './top-up-prefetch';
const WalletTopUpSheet=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
export function WalletTopUpTrigger({children,className,ariaLabel,disabled=false}:{children:ReactNode;className?:string;ariaLabel?:string;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLAnchorElement>(null);
 const {queryIdentity}=useTelegram();
 const warm=()=>{if(!disabled){warmTopUpConfiguration(queryIdentity);void import('./wallet-top-up')}};
 return <><Link ref={trigger} href="/wallet/deposit" prefetch={false} className={className} aria-label={ariaLabel} aria-disabled={disabled||undefined} tabIndex={disabled?-1:undefined} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} onClick={event=>{if(disabled){event.preventDefault();return}if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();warm();setOpen(true)}}}>{children}</Link>{open&&<WalletTopUpSheet onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
