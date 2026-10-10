'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';

import {WalletFunding} from '@/components/wallet-funding';
import {useMiniPage,useMiniQueryState} from '@/components/mini-query-state';
import { useEffect } from 'react';
import Link from 'next/link';
import {Clock3,RefreshCw,Wallet as WalletIcon} from 'lucide-react';
import { useTelegram } from '@/components/telegram-provider';
import { IdentityState } from '@/components/identity-state';
import { PersonalPagination,usePrivateQuery } from '@/components/private-query';
import { formatEtb,etbToCents } from '@/lib/money';
import styles from '@/components/wallet-page.module.css';
type WalletView={page:number;total:number;totalPages:number;wallet:{available:string;held:string};activity:{id:string;kind:string;at:string;availableDelta:string;heldDelta:string}[]};
type FundingAvailability={options?:{enabled:boolean}};
const names:Record<string,string>={ADMIN_CREDIT:'Funds added by admin',TOPUP_CREDIT:'Verified transfer credit',TOPUP_REVERSAL:'Reviewed top-up correction',DEMO_CREDIT:'DEMO ETB credit',DEV_CREDIT:'Development ETB credit',HOLD_RESERVE:'Auction ETB reserved',HOLD_RELEASE:'Auction ETB released',BID_FEE:'Auction entry fee',AUCTION_WIN_CHARGE:'Winning ETB amount charged',AUCTION_FEE_REFUND:'Cancelled auction fee refund'};
export default function Wallet() {const w=useWalletCopy();
  const {status,me}=useTelegram();
  const fundingQuery=usePrivateQuery<FundingAvailability>('/api/wallet/top-ups?page=1');
  const previewQuery=usePrivateQuery<unknown>('/api/wallet/preview',{enabled:fundingQuery.data?.options?.enabled===false});
  const fundingReady=(!!fundingQuery.data||!!fundingQuery.error)&&(fundingQuery.data?.options?.enabled!==false||!!previewQuery.data||!!previewQuery.error);
  const [page,setPage]=useMiniPage(),{params,set}=useMiniQueryState();
  const tab=params.get('tab')==='transactions'?'transactions':'add',transactionType=params.get('type')==='activity'?'activity':'deposits';
  const setTab=(value:string)=>set({tab:value==='add'?null:value}),setTransactionType=(value:string)=>set({type:value==='deposits'?null:value,page:null});
  const activityQuery=usePrivateQuery<WalletView>(`/api/wallet?page=${page}`);
  const view=status==='authenticated'?activityQuery.data:null,error=activityQuery.error,loading=activityQuery.fetching;
  useEffect(()=>{const refresh=()=>activityQuery.reload();window.addEventListener('lowin-wallet-updated',refresh);return()=>window.removeEventListener('lowin-wallet-updated',refresh)},[activityQuery.reload]);
  const wallet=view?.wallet??me?.wallet;
  if(status==='loading'||status==='authenticated'&&(!view&&!error||!fundingReady))return <MiniRouteSkeleton/>;
  return <section className={styles.page}><h1 className="sr-only">{w("Wallet")}</h1>
    {status==='authenticated'&&wallet?<div className={styles.balance}><span className={styles.balanceLabel}>{w("Available balance")}{me?.wallet.demo&&<small>DEMO</small>}</span><strong className={styles.amount}>{formatEtb(wallet.available).replace('ETB ','')} ETB</strong>{etbToCents(wallet.held)>0n&&<p className={styles.held}>{formatEtb(wallet.held)} {w("held for auctions")}</p>}<Link className={styles.addMoney} href="#add-etb" onClick={()=>setTab('add')}>{w("Add money")}</Link></div>:<IdentityState/>}
    <nav className={styles.tabs} aria-label={w('Wallet sections')}><button type="button" aria-pressed={tab==='add'} onClick={()=>setTab('add')}>{w('Add money')}</button><button type="button" aria-pressed={tab==='transactions'} onClick={()=>setTab('transactions')}>{w('Transactions')}</button></nav>
    {tab==='transactions'&&<div className={styles.transactionFilters} role="group" aria-label={w('Transaction type')}><button type="button" aria-pressed={transactionType==='deposits'} onClick={()=>setTransactionType('deposits')}>{w('Deposits')}</button><button type="button" aria-pressed={transactionType==='activity'} onClick={()=>setTransactionType('activity')}>{w('Wallet activity')}</button></div>}
    <WalletFunding view={tab==='add'?'deposit':transactionType==='deposits'?'deposits':'hidden'} onContinue={()=>setTab('add')}/>
    {status==='authenticated'&&<section hidden={tab!=='transactions'||transactionType!=='activity'} className={styles.transactionSection} aria-label={w('Wallet activity')}><div className={styles.sectionHeading}><h2>{w("Wallet activity")}</h2><button type="button" className={styles.refresh} onClick={activityQuery.reload} disabled={loading} aria-label={w("Refresh wallet activity")}><RefreshCw size={15}/>{w('Refresh')}</button></div>
      <p className={styles.sectionDescription}>{w('Your credits, bids, fees and refunds, together.')}</p>
      {error&&<div className="notice-card" role="alert">{error} <button onClick={activityQuery.reload}>{w("Retry")}</button></div>}
      {!loading&&!error&&view?.activity.length===0&&<div className={styles.empty}><WalletIcon size={28}/><h3>{w('No activity yet')}</h3><p>{w("No ETB movements yet. Accepted bids and holds will appear here.")}</p></div>}
      <div className={styles.transactionList}>{view?.activity.map(item=><article className={styles.activityRow} key={item.id}><span className={styles.activityIcon}><Clock3 size={18}/></span><div><strong>{w(names[item.kind]??'ETB journal entry')}</strong><small>{new Date(item.at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</small></div><span className={styles.activityDeltas}><b>{formatEtb(item.availableDelta)}</b>{etbToCents(item.heldDelta)!==0n&&<small>{formatEtb(item.heldDelta)} {w("held")}</small>}</span></article>)}</div>
      <PersonalPagination page={page} totalPages={view?.totalPages??0} setPage={setPage}/>
    </section>}
  </section>;
}
