'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRef,useState,type ReactNode} from 'react';
const WalletOverview=dynamic(()=>import('./wallet-overview'),{loading:()=>null});
export function WalletOverviewTrigger({children,className,ariaLabel,title,ariaBusy,disabled=false}:{children:ReactNode;className?:string;ariaLabel?:string;title?:string;ariaBusy?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLAnchorElement>(null);
 return <><Link ref={trigger} href="/profile#wallet" prefetch={false} className={className} aria-label={ariaLabel} title={title} aria-busy={ariaBusy||undefined} aria-disabled={disabled||undefined} tabIndex={disabled?-1:undefined} onClick={event=>{if(disabled){event.preventDefault();return}if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();setOpen(true)}}}>{children}</Link>{open&&<WalletOverview onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
