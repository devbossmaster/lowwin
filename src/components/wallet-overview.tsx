'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowDownLeft,ArrowUpRight,Check,ChevronRight,Copy,Gift,LoaderCircle,Plus,ReceiptText,RefreshCw,Wallet} from 'lucide-react';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {DepositBonusOffer} from '@/lib/deposit-bonus-preview';
import {depositBonusPreview} from '@/lib/deposit-bonus-preview';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {AccountSheet} from './account-sheet';
import {DepositBonusCard} from './deposit-bonus-card';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import {useTelegram} from './telegram-provider';
import styles from './wallet-sheet.module.css';

const WalletTopUp=dynamic(()=>import('./wallet-top-up'),{loading:()=>null});
type Filter='all'|'topup'|'bid'|'refund'|'bonus';
type Activity={id:string;at:string;type:Filter|'adjustment'|'hold';kind:string;delta:string;status:'confirmed'};
type History={items:Activity[];page:number;pageSize:number;hasNext:boolean};
type Bonuses={policy:DepositBonusOffer;items:{id:string;amount:string;remaining:string;creditedAt:string;expiresAt:string;status:'active'|'used'|'expired'}[];page:number;nextPage:number|null};
type Props={onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>};
export default function WalletOverview(props:Props){const {queryIdentity}=useTelegram();return <OwnedOverview key={queryIdentity??'guest'} {...props}/>}
function OwnedOverview({onClose,returnFocusRef}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const notice=useMiniNotice(),{queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const [topUp,setTopUp]=useState(false),[type,setType]=useState<Filter>('all'),[page,setPage]=useState(1),[selected,setSelected]=useState<Activity|null>(null);
 const wrapper=useRef<HTMLDivElement>(null),returnId=useRef<string|null>(null);
 const balance=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated&&!topUp,freshnessMs:15000});
 const history=usePrivateQuery<History>(`/api/wallet/history?page=${page}&type=${type}`,{enabled:authenticated&&!topUp,freshnessMs:15000});
 const bonuses=usePrivateQuery<Bonuses>('/api/wallet/bonuses?page=1',{enabled:authenticated&&!topUp,freshnessMs:30000});
 const policy=bonuses.data?.policy,offer=depositBonusPreview('0',policy);
 const filters:Array<[Filter,string,string]>=[['all','All','ሁሉም'],['topup','Top-ups','ገቢዎች'],['bid','Bid fees','የጨረታ ክፍያዎች'],['refund','Refunds','ተመላሾች'],...(bonuses.data?.policy.configured?[['bonus','Bonuses','ቦነሶች'] as [Filter,string,string]]:[])];
 const date=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 const day=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Africa/Addis_Ababa'});
 const choose=(next:Filter)=>{setType(next);setPage(1)};
 const label=(item:Activity)=>item.kind==='DEPOSIT_BONUS'?text('Deposit bonus','የገቢ ቦነስ'):item.kind==='DEPOSIT_BONUS_EXPIRY'?text('Bonus expired','ቦነሱ አብቅቷል'):item.kind==='PAYMENT_CREDIT'?text('Payment credited to wallet','ክፍያው በዋሌትዎ ገብቷል'):item.kind==='COMPENSATION'?text('Compensation','ካሳ'):item.type==='topup'?text('Wallet top-up','የዋሌት ገቢ'):item.type==='bid'?text('Bid submission fee','የጨረታ ማስገቢያ ክፍያ'):item.type==='refund'?text('Refund','ተመላሽ'):item.type==='hold'?text(etbToCents(item.delta)>0n?'Funds released':'Funds held',etbToCents(item.delta)>0n?'የተለቀቀ ገንዘብ':'የተያዘ ገንዘብ'):text('Balance adjustment','የቀሪ ሂሳብ ማስተካከያ');
 useEffect(()=>{if(selected||!returnId.current)return;const id=returnId.current,frame=requestAnimationFrame(()=>wrapper.current?.querySelector<HTMLButtonElement>(`[data-wallet-entry-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame)},[selected]);
 if(topUp)return <WalletTopUp onClose={onClose} returnFocusRef={returnFocusRef}/>;
 const title=<span className={styles.title}><Wallet size={20} aria-hidden="true"/>{text(selected?'Wallet activity details':'Wallet',selected?'የዋሌት እንቅስቃሴ ዝርዝር':'ዋሌት')}</span>;
 return <AccountSheet title={title} onClose={onClose} onBack={selected?()=>setSelected(null):undefined} returnFocusRef={returnFocusRef}>
 <div ref={wrapper} className={styles.overview} data-wallet-overview>
  {selected?<section className={styles.activityDetail}>
   <span className={styles.activityStatus}><Check size={14} aria-hidden="true"/>{text('Completed','ተጠናቋል')}</span>
   <h3>{label(selected)}</h3><strong className={styles.activityAmount} data-direction={etbToCents(selected.delta)>0n?'incoming':'outgoing'}>{etbToCents(selected.delta)>0n?'+':'−'}{formatEtb(selected.delta.replace(/^-/,'')).replace('ETB ','')} <small>ETB</small></strong>
   <dl className={styles.activityInfo}><div><dt>{text('Date','ቀን')}</dt><dd>{date.format(new Date(selected.at))}</dd></div><div><dt>{text('Account','መለያ')}</dt><dd>{text('Lowwin Wallet','Lowwin ዋሌት')}</dd></div><div><dt>{text('Activity reference','የእንቅስቃሴ መለያ')}</dt><dd><span>{selected.id}</span><button type="button" aria-label={text('Copy activity reference','የእንቅስቃሴ መለያውን ይቅዱ')} onClick={()=>{void navigator.clipboard.writeText(selected.id).then(()=>notice(text('Reference copied','መለያው ተቀድቷል'),'success')).catch(()=>notice(text('Could not copy. Select the reference to copy it.','መቅዳት አልተቻለም። መለያውን መርጠው ይቅዱ።'),'error'))}}><Copy size={15} aria-hidden="true"/></button></dd></div></dl>
   <button type="button" className={styles.balanceTopUp} onClick={()=>setSelected(null)}>{text('Back to wallet','ወደ ዋሌት ተመለስ')}</button>
  </section>:<>
   <section className={styles.balance} aria-label={text('Available balance','ለመጠቀም ያለ ቀሪ ሂሳብ')}>
    <div className={styles.balanceGrid}><div><span className={styles.balanceLabel}><Wallet size={22} aria-hidden="true"/>{text('Available for bids','ለጨረታ ያለ ገንዘብ')}</span><strong className={styles.balanceAmount} data-wallet-overview-balance>{balance.data?<>{centsToEtb(etbToCents(balance.data.available))} <small>ETB</small></>:authenticated?<span className={styles.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ')}</strong></div>
     {offer.active&&policy&&<div className={styles.bonusTile}><Gift size={25} aria-hidden="true"/><strong>+{policy.percent}%</strong><span>{text('Deposit bonus','የገቢ ቦነስ')}</span><small>{text(`${policy.validityDays} days validity`,`${policy.validityDays} ቀናት የሚቆይ`)}</small></div>}
    </div>
    {balance.data?.cashAvailable!==undefined&&<div className={styles.split}><span>{text('Deposited funds','ያስገቡት ገንዘብ')} <b>{balance.data.cashAvailable} ETB</b></span><span>{text('Active bonus','ያለ ቦነስ')} <b>{balance.data.bonusAvailable} ETB</b></span></div>}
   </section>
   <button className={styles.balanceTopUp} type="button" onClick={()=>{if(authenticated)setTopUp(true);else openRegistration()}}><Plus size={18} aria-hidden="true"/>{text(authenticated?'Add funds':'Log in to add funds',authenticated?'ገንዘብ ያስገቡ':'ገንዘብ ለማስገባት ይግቡ')}</button>
   <p className={styles.hint}>{text('Use wallet funds for auction submission fees. Withdrawals are not available.','የዋሌት ገንዘብን ለጨረታ ማስገቢያ ክፍያ ይጠቀሙ። ገንዘብ ማውጣት አይቻልም።')}</p>
   {balance.error&&<p className={styles.error} role="status">{text(balance.data?'Showing your saved balance.':'Balance is unavailable.',balance.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.retry} type="button" onClick={balance.reload}>{text('Retry','እንደገና')}</button></p>}
   <Link className={styles.historyLink} href="/payments" prefetch={false} onClick={onClose}><ReceiptText size={18} aria-hidden="true"/><span>{text('Transactions','\u130d\u1265\u12ed\u1276\u127d')}</span><ChevronRight size={17} aria-hidden="true"/></Link>
   <div className={styles.offerSpace}><DepositBonusCard policy={policy}/></div>
   {bonuses.data?.policy.configured&&<section className={styles.bonusLots} aria-labelledby="wallet-bonus-heading"><h3 id="wallet-bonus-heading"><Gift size={18} aria-hidden="true"/>{text('Deposit bonuses','የገቢ ቦነሶች')}</h3>{bonuses.data.items.length?<ul>{bonuses.data.items.map(item=><li key={item.id}><div><strong>+{item.amount} ETB</strong><span>{item.status==='active'?text(`${item.remaining} ETB remaining`,`${item.remaining} ብር ቀርቷል`):text(item.status==='used'?'Used':'Expired',item.status==='used'?'ተጠቅመዋል':'አብቅቷል')}</span></div><small>{text(item.status==='expired'?'Expired':'Expires',item.status==='expired'?'አብቅቷል':'የሚያበቃበት')} {day.format(new Date(item.expiresAt))}</small></li>)}</ul>:<p className={styles.hint}>{text('Your deposit bonuses will appear here.','የገቢ ቦነሶችዎ እዚህ ይታያሉ።')}</p>}</section>}
   {bonuses.error&&<p className={styles.error} role="status">{text('Bonus details could not refresh.','የቦነስ ዝርዝሮችን ማደስ አልተቻለም።')} <button className={styles.retry} type="button" onClick={bonuses.reload}>{text('Retry','እንደገና')}</button></p>}
   <section className={styles.history} aria-labelledby="wallet-history-heading"><div className={styles.historyHeading}><h3 id="wallet-history-heading">{text('Wallet activity','የዋሌት እንቅስቃሴ')}</h3><button className={styles.iconButton} type="button" aria-label={text('Refresh wallet history','የዋሌት ታሪክን ያድሱ')} disabled={!authenticated||history.fetching} onClick={()=>{history.reload();balance.reload();bonuses.reload()}}><RefreshCw size={16} aria-hidden="true"/></button></div>
    <div className={styles.filters} aria-label={text('Wallet history filters','የዋሌት ታሪክ ማጣሪያዎች')}>{filters.map(([filter,en,translated])=><button key={filter} type="button" aria-pressed={type===filter} onClick={()=>choose(filter)}>{text(en,translated)}</button>)}</div>
    {history.error&&<p className={styles.error} role="status">{text(history.data?'Showing saved history.':'Wallet history is unavailable.',history.data?'የተቀመጠው ታሪክ ይታያል።':'የዋሌት ታሪኩ አይገኝም።')} <button className={styles.retry} type="button" onClick={history.reload}>{text('Retry','እንደገና')}</button></p>}
    {authenticated&&!history.data&&!history.error&&<p className={styles.loading} role="status"><LoaderCircle size={17} className={styles.spin} aria-hidden="true"/>{text('Loading history…','ታሪክ በመጫን ላይ…')}</p>}
    {history.data&&!history.data.items.length&&<div className={styles.empty}><ReceiptText size={25} aria-hidden="true"/><p>{text('No wallet activity to show yet.','ገና የሚታይ የዋሌት እንቅስቃሴ የለም።')}</p></div>}
    {history.data&&<ul className={styles.entries} aria-busy={history.fetching}>{history.data.items.map(item=>{let delta:bigint;try{delta=etbToCents(item.delta)}catch{return null}const incoming=delta>0n,Icon=incoming?ArrowDownLeft:ArrowUpRight;return <li key={item.id} data-wallet-entry data-direction={incoming?'incoming':'outgoing'}><button className={`${styles.entry} ${styles.historyButton}`} data-wallet-entry-id={item.id} type="button" onClick={()=>{returnId.current=item.id;setSelected(item)}}><span className={styles.movement} aria-hidden="true"><Icon size={18}/></span><span className={styles.details}><strong>{label(item)}</strong><time dateTime={item.at}>{date.format(new Date(item.at))}</time></span><strong className={styles.entryAmount}><span>{incoming?'+':'−'}{formatEtb(item.delta.replace(/^-/,'')).replace('ETB ','')}</span><small>ETB</small></strong><ChevronRight size={15} aria-hidden="true"/></button></li>})}</ul>}
    {history.data&&(page>1||history.data.hasNext)&&<nav className={styles.pagination} aria-label={text('Wallet history pages','የዋሌት ታሪክ ገጾች')}><button type="button" disabled={page<=1||history.fetching} onClick={()=>setPage(value=>value-1)}>{text('Previous','ወደ ኋላ')}</button><span>{page}</span><button type="button" disabled={!history.data.hasNext||history.fetching} onClick={()=>setPage(value=>value+1)}>{text('Next','ቀጣይ')}</button></nav>}
   </section>
  </>}
 </div></AccountSheet>;
}
