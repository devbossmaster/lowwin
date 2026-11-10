'use client';
import dynamic from 'next/dynamic';
import {createPortal} from 'react-dom';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ChevronLeft,ChevronRight,Clock3,Plus,RefreshCw,Search,Wallet} from 'lucide-react';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {useMiniQueryState} from './mini-query-state';
import {paymentSummaryLabel} from '@/lib/payment-summary';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import type {TransactionRow,TransactionsPage as TransactionsResponse} from '@/lib/transactions';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './transactions-page.module.css';
const Details=dynamic(()=>import('./transaction-detail-sheet'),{ssr:false});
const TopUp=dynamic(()=>import('./wallet-top-up'),{ssr:false});
export function TransactionsPage(){const {queryIdentity}=useTelegram();return <OwnedTransactions key={queryIdentity??'guest'}/>}
function OwnedTransactions(){
 const {language}=useMiniLocale(),am=language==='am',t=(en:string,a:string)=>am?a:en,{queryIdentity}=useTelegram(),{params,set}=useMiniQueryState();
 const page=Math.max(1,Math.min(1000,Number(params.get('page'))||1)),type=['TOP_UP','BID'].includes(params.get('type')??'')?params.get('type')!:'ALL',q=(params.get('q')??'').slice(0,100);
 const [search,setSearch]=useState(q),[selected,setSelected]=useState<TransactionRow|null>(null),[topUp,setTopUp]=useState(false),[target,setTarget]=useState<Element|null>(null),trigger=useRef<HTMLElement|null>(null);
 const url=`/api/transactions?${new URLSearchParams({page:String(page),type,...(q?{q}:{})})}`;
 const history=usePrivateQuery<TransactionsResponse>(url,{keepPreviousData:true}),wallet=usePrivateQuery<WalletBalance>('/api/wallet');
 useEffect(()=>setSearch(q),[q]);useEffect(()=>{setTarget(document.querySelector('[data-transactions-header-action]'))},[]);
 const refresh=()=>{if(history.fetching||wallet.fetching)return;history.reload();wallet.reload()};
 const refreshButton=<button type="button" className={styles.refresh} onClick={refresh} disabled={history.fetching||wallet.fetching} aria-label={t('Refresh transactions','ግብይቶችን ያድሱ')} aria-busy={history.fetching||wallet.fetching}><RefreshCw size={19} className={history.fetching||wallet.fetching?styles.spin:undefined}/></button>;
 const date=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{timeZone:'Africa/Addis_Ababa',day:'numeric',month:'short',year:'numeric'}),time=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{timeZone:'Africa/Addis_Ababa',hour:'2-digit',minute:'2-digit'});
 const dayKey=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Addis_Ababa',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 const today=dayKey(new Date().toISOString()),yesterday=dayKey(new Date(Date.now()-86400000).toISOString());
 const groups=new Map<string,TransactionRow[]>();for(const item of history.data?.items??[]){const key=dayKey(item.createdAt);groups.set(key,[...(groups.get(key)??[]),item])}
 let balance:string|null=null;try{if(wallet.data?.available!==undefined)balance=centsToEtb(etbToCents(wallet.data.available))}catch{}
 return <section className={styles.page} data-transactions-page data-payment-history aria-label={t('Transactions','ግብይቶች')}>
  {target&&createPortal(refreshButton,target)}
  <div className={styles.balance}><div><span><Wallet size={16}/>{t('Available balance','ያለ ቀሪ ሂሳብ')}</span><strong data-transactions-balance>{balance!==null?`${balance} ETB`:<span className={styles.balancePlaceholder} aria-label={t('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>}</strong></div><button type="button" onClick={event=>{trigger.current=event.currentTarget;setTopUp(true)}}><Plus size={16}/>{t('Top up','ገንዘብ ያስገቡ')}</button></div>
  <form className={styles.search} onSubmit={event=>{event.preventDefault();set({q:search.trim()||null,page:null})}}><Search size={17} aria-hidden="true"/><input type="search" aria-label={t('Search transactions','ግብይቶችን ፈልግ')} placeholder={t('Search transactions','ግብይቶችን ፈልግ')} maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/><button type="submit">{t('Search','ፈልግ')}</button></form>
  <div className={styles.filters} aria-label={t('Transaction type','የግብይት አይነት')}>{[['ALL','All','ሁሉም'],['TOP_UP','Top-ups','የዋሌት ገቢ'],['BID','Bid fees','የጨረታ ክፍያ']].map(([value,en,a])=><button key={value} type="button" aria-pressed={type===value} onClick={()=>set({type:value==='ALL'?null:value,page:null})}>{t(en,a)}</button>)}</div>
  {history.error&&<p className={styles.notice} role="status">{t(history.data?'Showing saved activity. Refresh failed.':'Activity could not load. Please try again.',history.data?'የተቀመጠው መረጃ ይታያል። ማደስ አልተሳካም።':'ግብይቶችን ማምጣት አልተቻለም።')} <button type="button" onClick={history.reload}>{t('Retry','እንደገና')}</button></p>}
  {wallet.error&&<p className={styles.notice}>{t('Balance could not refresh.','ቀሪ ሂሳቡን ማደስ አልተቻለም።')} <button type="button" onClick={wallet.reload}>{t('Retry','እንደገና')}</button></p>}
  {!history.data&&!history.error?<TransactionsRowsSkeleton/>:history.data?.items.length===0?<div className={styles.empty}><Clock3 size={26}/><h2>{t(q?'No matching activity':'Your activity starts here',q?'የተዛመደ ግብይት የለም':'ግብይቶችዎ እዚህ ይታያሉ')}</h2><p>{t('Wallet top-ups and bid fees appear here, including payments still being checked.','የዋሌት ገቢዎችና የጨረታ ክፍያዎች እዚህ ይታያሉ።')}</p></div>:<div aria-busy={history.fetching} className={styles.activity} data-transactions-list>{[...groups].map(([day,items])=><section key={day}><h2>{day===today?t('Today','ዛሬ'):day===yesterday?t('Yesterday','ትላንት'):date.format(new Date(items[0].createdAt))}</h2><ul>{items.map(item=>{const Icon=item.direction==='incoming'?ArrowDownLeft:item.direction==='outgoing'?ArrowUpRight:Clock3;return <li key={`${item.source}:${item.id}`}><button type="button" className={styles.row} data-payment-id={item.id} data-direction={item.direction} disabled={history.isPlaceholderData} onClick={event=>{trigger.current=event.currentTarget;setSelected(item)}}><span className={styles.icon}><Icon size={19}/></span><span className={styles.description}><strong>{item.type==='TOP_UP'?t('Wallet top-up','የዋሌት ገቢ'):am?item.titleAm||item.title:item.title}</strong><span><time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time> · {item.paymentMethod==='wallet'?t('Wallet','ዋሌት'):item.paymentMethod||t('Payment','ክፍያ')}</span></span><span className={styles.amountStatus}><strong>{item.direction==='incoming'?'+':item.direction==='outgoing'?'−':''}{formatEtb(item.amount)}</strong><span data-summary={item.summary}>{paymentSummaryLabel(item.summary,am)}</span></span><ChevronRight size={15} aria-hidden="true"/></button></li>})}</ul></section>)}</div>}
  {(page>1||history.data?.nextPage)&&<nav className={styles.pagination} aria-label={t('Transaction pages','የግብይት ገጾች')}><button type="button" aria-label={t('Previous page','ያለፈው ገጽ')} disabled={page<=1||history.fetching} onClick={()=>set({page:page===2?null:String(page-1)})}><ChevronLeft size={18}/></button><span>{page}</span><button type="button" aria-label={t('Next page','ቀጣይ ገጽ')} disabled={!history.data?.nextPage||history.fetching} onClick={()=>set({page:String(history.data!.nextPage)})}><ChevronRight size={18}/></button></nav>}
  {selected&&<Details key={`${selected.source}:${selected.id}`} row={selected} trigger={trigger} onClose={()=>setSelected(null)}/>}
  {topUp&&<TopUp onClose={()=>setTopUp(false)} returnFocusRef={trigger}/>}
 </section>;
}
export function TransactionsRowsSkeleton(){return <div className={styles.skeleton} role="status" aria-label="Loading transactions" data-transactions-loading><span/><span/><span/></div>}
export function TransactionsSkeleton(){return <section className={styles.page} aria-busy="true"><div className={styles.balanceSkeleton}/><TransactionsRowsSkeleton/></section>}
