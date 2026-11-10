'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useState,type RefObject} from 'react';
import {ArrowDownLeft,ArrowUpRight,LoaderCircle,Plus,ReceiptText,RefreshCw,Wallet} from 'lucide-react';
import type {WalletBalance} from '@/modules/wallet/balance';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {AccountSheet} from './account-sheet';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import styles from './wallet-sheet.module.css';

const WalletTopUp=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
type Filter='all'|'topup'|'bid'|'refund';
type History={items:{id:string;at:string;type:Filter|'adjustment'|'hold';kind:string;delta:string;status:'confirmed'}[];page:number;pageSize:number;hasNext:boolean};
type Props={onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>};
export default function WalletOverview(props:Props){const {queryIdentity}=useTelegram();return <OwnedOverview key={queryIdentity??'guest'} {...props}/>}
function OwnedOverview({onClose,returnFocusRef}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const [topUp,setTopUp]=useState(false),[type,setType]=useState<Filter>('all'),[page,setPage]=useState(1);
 const balance=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated&&!topUp,freshnessMs:15000});
 const history=usePrivateQuery<History>(`/api/wallet/history?page=${page}&type=${type}`,{enabled:authenticated&&!topUp,freshnessMs:15000});
 const filters:Array<[Filter,string,string]>=[['all','All','ሁሉም'],['topup','Top-ups','ገቢዎች'],['bid','Bid fees','የጨረታ ክፍያዎች'],['refund','Refunds','ተመላሾች']];
 const date=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 const choose=(next:Filter)=>{setType(next);setPage(1)};
 if(topUp)return <WalletTopUp onClose={onClose} returnFocusRef={returnFocusRef}/>;
 return <AccountSheet title={<span className={styles.title}><Wallet size={20}/>{text('Wallet','ዋሌት')}</span>} onClose={onClose} returnFocusRef={returnFocusRef}>
  <div className={styles.overview} data-wallet-overview>
   <section className={styles.balance} aria-label={text('Available balance','ለመጠቀም ያለ ቀሪ ሂሳብ')}><span className={styles.balanceLabel}><Wallet size={16} aria-hidden="true"/>{text('Wallet · ETB','ዋሌት · ETB')}</span><strong className={styles.balanceAmount} data-wallet-overview-balance>{balance.data?<>{centsToEtb(etbToCents(balance.data.available))} <small>ETB</small></>:authenticated?<span className={styles.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ')}</strong><button className={styles.balanceTopUp} type="button" onClick={()=>{if(authenticated)setTopUp(true);else openRegistration()}}><Plus size={18} aria-hidden="true"/>{text(authenticated?'Top up':'Log in to top up',authenticated?'ገንዘብ ያስገቡ':'ገንዘብ ለማስገባት ይግቡ')}</button></section>
   <p className={styles.hint}>{text('Use your available balance to pay auction submission fees.','ያለዎትን ቀሪ ሂሳብ ለጨረታ ማስገቢያ ክፍያዎች ይጠቀሙ።')}</p>
   {balance.error&&<p className={styles.error} role="status">{text(balance.data?'Showing your saved balance.':'Balance is unavailable.',balance.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.retry} type="button" onClick={balance.reload}>{text('Retry','እንደገና')}</button></p>}
   <section className={styles.history} aria-labelledby="wallet-history-heading"><div className={styles.historyHeading}><h3 id="wallet-history-heading">{text('History','ታሪክ')}</h3><button className={styles.iconButton} type="button" aria-label={text('Refresh wallet history','የዋሌት ታሪክን ያድሱ')} disabled={!authenticated||history.fetching} onClick={()=>{history.reload();balance.reload()}}><RefreshCw size={16} aria-hidden="true"/></button></div>
    <div className={styles.filters} aria-label={text('Wallet history filters','የዋሌት ታሪክ ማጣሪያዎች')}>{filters.map(([filter,en,translated])=><button key={filter} type="button" aria-pressed={type===filter} onClick={()=>choose(filter)}>{text(en,translated)}</button>)}</div>
    {history.error&&<p className={styles.error} role="status">{text(history.data?'Showing saved history.':'Wallet history is unavailable.',history.data?'የተቀመጠው ታሪክ ይታያል።':'የዋሌት ታሪኩ አይገኝም።')} <button className={styles.retry} type="button" onClick={history.reload}>{text('Retry','እንደገና')}</button></p>}
    {authenticated&&!history.data&&!history.error&&<p className={styles.loading} role="status"><LoaderCircle size={17} className={styles.spin}/>{text('Loading history…','ታሪክ በመጫን ላይ…')}</p>}
    {history.data&&!history.data.items.length&&<div className={styles.empty}><ReceiptText size={25} aria-hidden="true"/><p>{text(type==='all'?'No wallet activity yet.':type==='topup'?'No wallet top-ups yet.':type==='bid'?'No wallet bid fees yet.':'No refunds yet.',type==='all'?'ገና የዋሌት እንቅስቃሴ የለም።':type==='topup'?'ገና የዋሌት ገቢዎች የሉም።':type==='bid'?'ገና የዋሌት ጨረታ ክፍያዎች የሉም።':'ገና ተመላሾች የሉም።')}</p></div>}
    {history.data&&<ul className={styles.entries} aria-busy={history.fetching}>{history.data.items.map(item=>{let delta:bigint;try{delta=etbToCents(item.delta)}catch{return null}const incoming=delta>0n,Icon=incoming?ArrowDownLeft:ArrowUpRight;const label=item.kind==='PAYMENT_CREDIT'?text('Payment credited to wallet','ክፍያው በዋሌትዎ ገብቷል'):item.kind==='COMPENSATION'?text('Compensation','ካሳ'):item.type==='topup'?text('Wallet top-up','የዋሌት ገቢ'):item.type==='bid'?text('Bid submission fee','የጨረታ ማስገቢያ ክፍያ'):item.type==='refund'?text('Refund','ተመላሽ'):item.type==='hold'?text(incoming?'Funds released':'Funds held',incoming?'የተለቀቀ ገንዘብ':'የተያዘ ገንዘብ'):text('Balance adjustment','የቀሪ ሂሳብ ማስተካከያ');return <li key={item.id} className={styles.entry} data-wallet-entry data-direction={incoming?'incoming':'outgoing'}><span className={styles.movement} aria-hidden="true"><Icon size={18}/></span><span className={styles.details}><strong>{label}</strong><time dateTime={item.at}>{date.format(new Date(item.at))}</time></span><strong className={styles.entryAmount}><span>{incoming?'+':'−'}{formatEtb(incoming?item.delta:item.delta.replace(/^-/,'')).replace('ETB ','')}</span><small>ETB</small></strong></li>})}</ul>}
    {history.data&&(page>1||history.data.hasNext)&&<nav className={styles.pagination} aria-label={text('Wallet history pages','የዋሌት ታሪክ ገጾች')}><button type="button" disabled={page<=1||history.fetching} onClick={()=>setPage(value=>value-1)}>{text('Previous','ወደ ኋላ')}</button><span>{page}</span><button type="button" disabled={!history.data.hasNext||history.fetching} onClick={()=>setPage(value=>value+1)}>{text('Next','ቀጣይ')}</button></nav>}
    <Link className={styles.historyLink} href="/payments" prefetch={false} onClick={onClose}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>
   </section>
  </div>
 </AccountSheet>;
}
