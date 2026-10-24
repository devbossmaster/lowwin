'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRef,useState,type ReactNode} from 'react';
const WalletTopUpSheet=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
export function WalletTopUpTrigger({children,className,ariaLabel}:{children:ReactNode;className?:string;ariaLabel?:string}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLAnchorElement>(null);
 return <><Link ref={trigger} href="/wallet/deposit" prefetch={false} className={className} aria-label={ariaLabel} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();setOpen(true)}}}>{children}</Link>{open&&<WalletTopUpSheet onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
