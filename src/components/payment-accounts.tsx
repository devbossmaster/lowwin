'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useEffect,useId,useState} from 'react';
import Image from 'next/image';
import {Check,Copy,Wallet} from 'lucide-react';
import styles from './wallet-page.module.css';
import {DEPOSIT_CHANNELS,paymentChannelName} from '@/lib/payment-channels';

export type PaymentAccount={id:string;name:string;number:string;holder:string};
export function PaymentLogo({channel}:{channel:string}){
 if(channel==='manual')return <span className={styles.providerLogo}><Wallet size={24} aria-hidden="true"/></span>;
 if(channel==='mpesa')return <span className={`${styles.providerLogo} ${styles.mpesaLogo}`}><Image src="/icons/payments/mpesa.png" alt="" width={80} height={30}/></span>;
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
   {DEPOSIT_CHANNELS.map(channel=><button type="button" key={channel} aria-pressed={selected===channel} aria-expanded={selected===channel} aria-controls={selected===channel?id:undefined} disabled={busy||locked&&selected!==channel} onClick={()=>{if(selected!==channel){setCopied('');onSelect(channel)}}}><PaymentLogo channel={channel}/><strong>{paymentChannelName(channel)}</strong>{selected===channel&&<span className={styles.selected}><Check size={13}/></span>}</button>)}
  </div>
  {selected&&<section id={id} className={styles.accountDetails} aria-label={`${paymentChannelName(selected)} account details`}>
   <header><PaymentLogo channel={selected}/><div><small>{w("Selected payment account")}</small><strong>{paymentChannelName(selected)}</strong></div></header>
   {account?<><div className={styles.accountNumber}><div><small>{w("Account number")}</small><strong>{account.number}</strong></div><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(account.number);setCopied(w("Copied"))}catch{setCopied(w("Select the number to copy."))}}} aria-label={w("Copy account number")}><Copy size={14}/>{w("Copy")}</button></div><div className={styles.accountName}><small>{w("Account name")}</small><strong>{account.holder}</strong></div>{preview&&<p className={styles.hint}>{w("DEMO account · do not send money.")}</p>}{copied&&<p className={styles.hint} role="status">{copied}</p>}</>:<p className={styles.hint}>{w("Account details are not available yet.")}</p>}
  </section>}
 </>;
}
