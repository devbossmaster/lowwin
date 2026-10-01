'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useEffect,useId,useState} from 'react';
import Image from 'next/image';
import {Check,Copy} from 'lucide-react';
import styles from './wallet-page.module.css';

export type PaymentAccount={id:string;name:string;number:string;holder:string};
export function PaymentLogo({channel}:{channel:string}){
 return <span className={`${styles.providerLogo} ${channel==='cbe'?styles.cbeLogo:''}`}><Image src={`/icons/payments/${channel==='cbe'?'cbe.png':'telebirr.jpg'}`} alt="" width={channel==='cbe'?168:36} height={channel==='cbe'?98:36}/></span>;
}
export function PaymentAccounts({accounts,selected,onSelect,locked=false,busy=false,preview=false}:{accounts:PaymentAccount[];selected:string|null;onSelect:(id:string)=>void;locked?:boolean;busy?:boolean;preview?:boolean}){
 const w=useWalletCopy();
 const [copied,setCopied]=useState(''),id=useId();
 const account=accounts.find(item=>item.id===selected);
 useEffect(()=>{setCopied('')},[selected]);
 return <>
  <div className={styles.sectionHeading}><h3>{w("Payment account")}</h3><span>{w("Tap to select")}</span></div>
  <div className={styles.methods} role="group" aria-label={w("Payment account")}>
   {(['telebirr','cbe'] as const).map(channel=><button type="button" key={channel} aria-pressed={selected===channel} aria-expanded={selected===channel} aria-controls={selected===channel?id:undefined} disabled={busy||locked&&selected!==channel} onClick={()=>{if(selected!==channel){setCopied('');onSelect(channel)}}}><PaymentLogo channel={channel}/><strong>{channel==='cbe'?'CBE':'Telebirr'}</strong>{selected===channel&&<span className={styles.selected}><Check size={13}/></span>}</button>)}
  </div>
  {selected&&<section id={id} className={styles.accountDetails} aria-label={`${selected==='cbe'?'CBE':'Telebirr'} account details`}>
   <header><PaymentLogo channel={selected}/><div><small>{w("Selected payment account")}</small><strong>{selected==='cbe'?'CBE':'Telebirr'}</strong></div></header>
   {account?<><div className={styles.accountNumber}><div><small>{w("Account number")}</small><strong>{account.number}</strong></div><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(account.number);setCopied(w("Copied"))}catch{setCopied(w("Select the number to copy."))}}} aria-label={w("Copy account number")}><Copy size={14}/>{w("Copy")}</button></div><div className={styles.accountName}><small>{w("Account name")}</small><strong>{account.holder}</strong></div>{preview&&<p className={styles.hint}>{w("DEMO account · do not send money.")}</p>}{copied&&<p className={styles.hint} role="status">{copied}</p>}</>:<p className={styles.hint}>{w("Account details are not available yet.")}</p>}
  </section>}
 </>;
}
