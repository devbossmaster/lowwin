'use client';
import {WalletFunding} from '@/components/wallet-funding';
import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import { ChevronDown,Clock3,RefreshCw } from 'lucide-react';
import { useTelegram } from '@/components/telegram-provider';
import { IdentityState } from '@/components/identity-state';
import { PersonalPagination } from '@/components/private-query';
import { formatEtb } from '@/lib/money';
import styles from '@/components/wallet-page.module.css';
type WalletView={page:number;total:number;totalPages:number;wallet:{available:string;held:string};activity:{id:string;kind:string;at:string;availableDelta:string;heldDelta:string}[]};
const names:Record<string,string>={TOPUP_CREDIT:'Verified transfer credit',TOPUP_REVERSAL:'Reviewed top-up correction',DEMO_CREDIT:'DEMO ETB credit',DEV_CREDIT:'Development ETB credit',HOLD_RESERVE:'Auction ETB reserved',HOLD_RELEASE:'Auction ETB released',BID_FEE:'Auction entry fee',AUCTION_WIN_CHARGE:'Winning ETB amount charged',AUCTION_FEE_REFUND:'Cancelled auction fee refund'};
export default function Wallet() {
  const {status,me}=useTelegram();const userId=me?.user.id;const [result,setResult]=useState<{userId:string;view:WalletView}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [page,setPage]=useState(1);
  const view=status==='authenticated'&&result&&result.userId===userId&&result.view.page===page?result.view:null;
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!userId)return;
    setLoading(true);setError('');
    try {const response=await fetch(`/api/wallet?page=${page}`,{cache:'no-store',signal});if(!response.ok)throw new Error('Wallet activity is unavailable.');setResult({userId,view:await response.json()})}
    catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:'Wallet activity is unavailable.')}
    finally {if(!signal?.aborted)setLoading(false)}
  },[userId,page]);
  useEffect(()=>{if(status!=='authenticated')return;const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[status,load]);
  useEffect(()=>{const refresh=()=>void load();window.addEventListener('lowin-wallet-updated',refresh);return()=>window.removeEventListener('lowin-wallet-updated',refresh)},[load]);
  const wallet=view?.wallet??me?.wallet;
  return <section className={styles.page}><h1 className="sr-only">Wallet</h1>
    {status==='authenticated'&&wallet?<div className={styles.balance}><span className={styles.balanceLabel}>Available balance {me?.wallet.demo&&<small>DEMO</small>}</span><strong className={styles.amount}>{formatEtb(wallet.available).replace('ETB ','')} ETB</strong>{BigInt(wallet.held)>0n&&<p className={styles.held}>{formatEtb(wallet.held)} held for auctions</p>}<Link className={styles.addMoney} href="#add-etb">Add money</Link></div>:<IdentityState/>}
    <WalletFunding/>
    {status==='authenticated'&&<details className={styles.history}><summary>Wallet activity<ChevronDown size={17}/></summary><section className="wallet-activity"><div className="section-heading"><h2>Recent activity</h2><button className="refresh-button" onClick={()=>void load()} disabled={loading} aria-label="Refresh wallet activity"><RefreshCw size={18}/></button></div>
      {loading&&!view&&<p className="inline-empty" role="status">Loading your journal…</p>}
      {error&&<div className="notice-card" role="alert">{error} <button onClick={()=>void load()}>Retry</button></div>}
      {!loading&&!error&&view?.activity.length===0&&<p className="inline-empty">No ETB movements yet. Accepted bids and holds will appear here.</p>}
      <div className="activity-list">{view?.activity.map(item=><div className="activity-row" key={item.id}><span className="activity-icon"><Clock3 size={17}/></span><div><strong>{names[item.kind]??'ETB journal entry'}</strong><small>{new Date(item.at).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}</small></div><span className="activity-deltas"><b>{formatEtb(item.availableDelta)} available</b>{BigInt(item.heldDelta)!==0n&&<small>{formatEtb(item.heldDelta)} held</small>}</span></div>)}</div>
      <PersonalPagination page={page} totalPages={view?.totalPages??0} setPage={setPage}/>
    </section></details>}
  </section>;
}
