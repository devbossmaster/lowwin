'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {LoadingSpinner,PageLoading} from '@/components/loading-spinner';

import {WalletFunding} from '@/components/wallet-funding';
import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import {Clock3,RefreshCw,Wallet as WalletIcon} from 'lucide-react';
import { useTelegram } from '@/components/telegram-provider';
import { IdentityState } from '@/components/identity-state';
import { PersonalPagination } from '@/components/private-query';
import { formatEtb,etbToCents } from '@/lib/money';
import styles from '@/components/wallet-page.module.css';
type WalletView={page:number;total:number;totalPages:number;wallet:{available:string;held:string};activity:{id:string;kind:string;at:string;availableDelta:string;heldDelta:string}[]};
const names:Record<string,string>={TOPUP_CREDIT:'Verified transfer credit',TOPUP_REVERSAL:'Reviewed top-up correction',DEMO_CREDIT:'DEMO ETB credit',DEV_CREDIT:'Development ETB credit',HOLD_RESERVE:'Auction ETB reserved',HOLD_RELEASE:'Auction ETB released',BID_FEE:'Auction entry fee',AUCTION_WIN_CHARGE:'Winning ETB amount charged',AUCTION_FEE_REFUND:'Cancelled auction fee refund'};
export default function Wallet() {const w=useWalletCopy();
  const {status,me}=useTelegram();const userId=me?.user.id;const [result,setResult]=useState<{userId:string;view:WalletView}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [page,setPage]=useState(1),[tab,setTab]=useState<'add'|'transactions'>('add'),[transactionType,setTransactionType]=useState<'deposits'|'activity'>('deposits');
  const view=status==='authenticated'&&result&&result.userId===userId&&result.view.page===page?result.view:null;
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!userId)return;
    setLoading(true);setError('');
    try {const response=await fetch(`/api/wallet?page=${page}`,{cache:'no-store',signal});if(!response.ok)throw new Error(w("Wallet activity is unavailable."));setResult({userId,view:await response.json()})}
    catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:w("Wallet activity is unavailable."))}
    finally {if(!signal?.aborted)setLoading(false)}
  },[userId,page]);
  useEffect(()=>{if(status!=='authenticated')return;const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[status,load]);
  useEffect(()=>{const refresh=()=>void load();window.addEventListener('lowin-wallet-updated',refresh);return()=>window.removeEventListener('lowin-wallet-updated',refresh)},[load]);
  const wallet=view?.wallet??me?.wallet;
  return <section className={styles.page}><h1 className="sr-only">{w("Wallet")}</h1>{status==='authenticated'&&!view&&!error&&<PageLoading/>}
    {status==='authenticated'&&wallet?<div className={styles.balance}><span className={styles.balanceLabel}>{w("Available balance")}{me?.wallet.demo&&<small>DEMO</small>}</span><strong className={styles.amount}>{formatEtb(wallet.available).replace('ETB ','')} ETB</strong>{etbToCents(wallet.held)>0n&&<p className={styles.held}>{formatEtb(wallet.held)} {w("held for auctions")}</p>}<Link className={styles.addMoney} href="#add-etb" onClick={()=>setTab('add')}>{w("Add money")}</Link></div>:<IdentityState/>}
    <nav className={styles.tabs} aria-label={w('Wallet sections')}><button type="button" aria-pressed={tab==='add'} onClick={()=>setTab('add')}>{w('Add money')}</button><button type="button" aria-pressed={tab==='transactions'} onClick={()=>setTab('transactions')}>{w('Transactions')}</button></nav>
    {tab==='transactions'&&<div className={styles.transactionFilters} role="group" aria-label={w('Transaction type')}><button type="button" aria-pressed={transactionType==='deposits'} onClick={()=>setTransactionType('deposits')}>{w('Deposits')}</button><button type="button" aria-pressed={transactionType==='activity'} onClick={()=>setTransactionType('activity')}>{w('Wallet activity')}</button></div>}
    <WalletFunding view={tab==='add'?'deposit':transactionType==='deposits'?'deposits':'hidden'} onContinue={()=>setTab('add')}/>
    {status==='authenticated'&&<section hidden={tab!=='transactions'||transactionType!=='activity'} className={styles.transactionSection} aria-label={w('Wallet activity')}><div className={styles.sectionHeading}><h2>{w("Wallet activity")}</h2><button type="button" className={styles.refresh} onClick={()=>void load()} disabled={loading} aria-label={w("Refresh wallet activity")}><RefreshCw size={15}/>{w('Refresh')}</button></div>
      <p className={styles.sectionDescription}>{w('Your credits, bids, fees and refunds, together.')}</p>
      {loading&&!view&&<LoadingSpinner/>}
      {error&&<div className="notice-card" role="alert">{error} <button onClick={()=>void load()}>{w("Retry")}</button></div>}
      {!loading&&!error&&view?.activity.length===0&&<div className={styles.empty}><WalletIcon size={28}/><h3>{w('No activity yet')}</h3><p>{w("No ETB movements yet. Accepted bids and holds will appear here.")}</p></div>}
      <div className={styles.transactionList}>{view?.activity.map(item=><article className={styles.activityRow} key={item.id}><span className={styles.activityIcon}><Clock3 size={18}/></span><div><strong>{w(names[item.kind]??'ETB journal entry')}</strong><small>{new Date(item.at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</small></div><span className={styles.activityDeltas}><b>{formatEtb(item.availableDelta)}</b>{etbToCents(item.heldDelta)!==0n&&<small>{formatEtb(item.heldDelta)} {w("held")}</small>}</span></article>)}</div>
      <PersonalPagination page={page} totalPages={view?.totalPages??0} setPage={setPage}/>
    </section>}
  </section>;
}
