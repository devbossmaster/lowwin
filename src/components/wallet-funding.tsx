'use client';
import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ChevronDown,Upload} from 'lucide-react';
import {useWalletCopy} from './wallet-copy';
import {LoadingSpinner,PageLoading} from './loading-spinner';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery,PersonalPagination} from './private-query';
import {WalletFundingPreview} from './wallet-funding-preview';
import {PaymentAccounts} from './payment-accounts';
import {useMiniNotice} from './mini-notice';
import {depositFeedback} from './deposit-feedback';
import styles from './wallet-page.module.css';

type Account={id:string;policyId:string;version:number;name:string;number:string;holder:string;numerator:string;denominator:string;minCents:string;maxCents:string;terms:string};
type Intent={canRetry?:boolean;retryBlocked?:string|null;retryUntil?:string;nextAttemptAt?:string;attempts?:number;id:string;demo?:boolean;reused?:boolean;channel:string;status:string;amountCents?:string;points:string;account:string;accountName:string;reference:string|null;expiresAt:string;reason:string|null;caseState:string;quote:{version:number;numerator:string;denominator:string;terms:string;minCents?:string;maxCents?:string}};
type Data={options:{enabled:boolean;productionEnabled:boolean;ocr:boolean;reason:string;accounts:Account[]};items:Intent[];totalPages:number};
const money=(c:string)=>(BigInt(c)/100n).toString()+'.'+(BigInt(c)%100n).toString().padStart(2,'0');
const labels:Record<string,string>={PENDING:'Pending verification',VERIFYING:'Verifying',CREDITED:'Credited',NEEDS_REVIEW:'Needs review',REJECTED:'Rejected',DUPLICATE_CONFLICT:'Duplicate claim — contact support',PROVIDER_OUTAGE:'Provider unavailable — retry pending'};
export function WalletFunding(){const {me}=useTelegram();return <Funding key={me?.user.id??'guest'}/>}
function Funding(){
 const w=useWalletCopy(),{refreshMe}=useTelegram(),notify=useMiniNotice(),noticeId=useId();
 const [page,setPage]=useState(1),query=usePrivateQuery<Data>(`/api/wallet/top-ups?page=${page}`);
 const [selected,setSelected]=useState(''),[intent,setIntent]=useState<Intent|null>(null),[input,setInput]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const createKey=useRef(''),verifyKey=useRef(''),working=useRef(false);
 const options=query.data?.options;
 const account:Account|undefined=intent?{id:intent.channel,policyId:'',version:intent.quote.version,name:intent.channel==='cbe'?'CBE':'Telebirr',number:intent.account,holder:intent.accountName,numerator:intent.quote.numerator,denominator:intent.quote.denominator,minCents:intent.quote.minCents??intent.amountCents??'0',maxCents:intent.quote.maxCents??intent.amountCents??'0',terms:intent.quote.terms}:options?.accounts.find(a=>a.id===selected);
 const credited=intent?.status==='CREDITED';
 useEffect(()=>{
  if(!intent||intent.status!=='VERIFYING')return;
  let cancelled=false;
  const poll=async()=>{try{
   const response=await fetch('/api/wallet/top-ups?page=1',{cache:'no-store'});if(!response.ok)return;
   const data=await response.json() as Data,updated=data.items.find(item=>item.id===intent.id);
   if(cancelled||!updated||updated.status===intent.status)return;
   setIntent(updated);query.reload();
   const feedback=depositFeedback(updated,w);inform(feedback.message,feedback.kind);
   if(updated.status==='CREDITED'){window.dispatchEvent(new Event('lowin-wallet-updated'));window.dispatchEvent(new Event('lowin-alerts'));void refreshMe()}
  }catch{/* The next poll can recover a transient network failure. */}};
  const timer=setInterval(()=>void poll(),5000);return()=>{cancelled=true;clearInterval(timer)};
 // Polling is tied to the selected deposit, not to query refreshes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[intent?.id,intent?.status]);
 const [now,setNow]=useState(0);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[]);
 const underReview=!!intent&&(intent.canRetry===false||['DUPLICATE_CONFLICT','REJECTED','REVERSED'].includes(intent.status));
 const waiting=!!intent?.nextAttemptAt&&new Date(intent.nextAttemptAt).getTime()>now;
 const bound=!!intent?.reference;
 function inform(text:string,kind:'success'|'error'|'info'='info'){setMessage(text);notify(text,kind,{id:noticeId,duration:8000})}
 async function command(action:string,body:unknown):Promise<Intent>{
  const response=await fetch('/api/wallet/top-ups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input:body}),cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.error);return data;
 }
 async function prepare(referenceInput?:string){
  if(intent)return intent;
  if(!account)throw Error('Choose a payment account first.');
  createKey.current ||= crypto.randomUUID();
  const receipt=await command('prepare',{key:createKey.current,channel:account.id,policyId:account.policyId,...(referenceInput?{input:referenceInput}:{})});setIntent(receipt);return receipt;
 }
 async function submit(){
  if(working.current||!account||!input.trim()||credited||underReview||waiting)return;
  working.current=true;setBusy(w('Checking payment…'));setMessage('');
  notify(w('Checking payment…'),'info',{id:noticeId,duration:Infinity});
  try{
   const current=await prepare(input);verifyKey.current ||= crypto.randomUUID();
   const receipt=await command('verify',{id:current.id,key:verifyKey.current,input});setIntent(receipt);
   if(receipt.status!=='CREDITED')verifyKey.current='';
   const feedback=depositFeedback(receipt,w);inform(feedback.message,feedback.kind);
   query.reload();
   if(receipt.status==='CREDITED'){
    window.dispatchEvent(new Event('lowin-wallet-updated'));window.dispatchEvent(new Event('lowin-alerts'));
    void refreshMe().catch(()=>setMessage(`${receipt.points} ${w('ETB credited. Receipt recorded.')} ${w('Reopen the wallet to refresh your balance.')}`));
   }
  }catch(error){inform(w(error instanceof Error?error.message:'Try again.'),'error')}finally{working.current=false;setBusy('')}
 }
 async function scan(file?:File){
  if(!file||working.current||!account||credited||underReview)return;
  working.current=true;setBusy(w('Uploading and scanning receipt…'));setMessage('');
  notify(w('Uploading and scanning receipt…'),'info',{id:noticeId,duration:Infinity});
  try{
   const current=await prepare(),upload=file;
   const response=await fetch(`/api/wallet/scan?intentId=${current.id}`,{method:'POST',headers:{'Content-Type':upload.type||file.type},body:upload}),data=await response.json();
   if(!response.ok)throw Error(data.error);
   if(current.reference&&current.reference!==data.reference)throw Error('This deposit uses a different reference. Use Correct a mistaken reference to start separately.');
   setInput(data.reference);verifyKey.current='';inform(w(data.uncertain?'Code extracted with low confidence. Check it against your receipt before submitting.':'Reference extracted. Review it against your receipt before submitting.'),data.uncertain?'info':'success');
  }catch(error){inform(w(error instanceof Error?error.message:'Could not read the screenshot. Paste the payment SMS or transaction reference.'),'error')}finally{working.current=false;setBusy('')}
 }
 function reset(){setIntent(null);setInput('');setMessage('');createKey.current='';verifyKey.current=''}
 if(query.status==='loading'||query.status==='authenticated'&&!query.data&&!query.error)return <section className={styles.funding} id="add-etb"><h2>{w('Add money')}</h2><PageLoading/></section>;
 if(query.error)return <section className={styles.funding} id="add-etb"><h2>{w('Add money')}</h2><p className={styles.error} role="alert">{w('Payment accounts could not load.')}<button type="button" onClick={query.reload}>{w('Retry')}</button></p></section>;
 return <>
  {!options?.enabled?<WalletFundingPreview/>:<section className={styles.funding} id="add-etb" aria-busy={!!busy}>
   <h2>{w('Add money')}</h2>
   <PaymentAccounts accounts={intent&&account?[account]:options.accounts} selected={selected} onSelect={id=>{setSelected(id);setInput('');setMessage('');createKey.current='';verifyKey.current=''}} locked={!!intent} busy={!!busy} preview={!options.productionEnabled}/>
   {account&&<p className={styles.hint}>{w('Allowed:')} {money(account.minCents)}–{money(account.maxCents)} ETB. {w('Your verified transfer amount is added automatically.')}</p>}
   <div className={styles.confirmation}>
    <label className={styles.fieldLabel} htmlFor="verified-reference">{w('Telebirr or CBE message/link')}</label>
    <textarea className={styles.textarea} id="verified-reference" maxLength={4000} value={credited?(intent.reference??input):input} disabled={!account||!!busy||credited||underReview} readOnly={bound} onChange={event=>{setInput(event.target.value);verifyKey.current=''}} placeholder={w('Paste a transaction ID, payment SMS or official receipt link')}/>
    <div className={styles.divider}>{w('Or upload a screenshot')}</div>
    <label className={styles.upload} aria-disabled={!account||!options.ocr||!!busy||credited||underReview}><Upload size={23}/><strong>{w('Upload receipt image')}</strong><span>{w('JPEG, PNG or WebP - up to 5 MB')}</span><input aria-label={w('Upload receipt image')} type="file" accept="image/png,image/jpeg,image/webp" disabled={!account||!options.ocr||!!busy||credited||underReview} onChange={event=>{void scan(event.target.files?.[0]);event.target.value=''}}/></label>
    <button type="button" className={styles.submit} disabled={!account||!input.trim()||!!busy||credited||underReview||waiting} onClick={()=>void submit()}>{busy?<LoadingSpinner/>:credited?w('Deposit credited'):underReview?w(intent?.status==='REJECTED'?'Deposit rejected':'Under admin review'):w(intent?.attempts?'Check payment again':'Submit deposit')}</button>
    <p className={styles.footnote}>{!account?w('Choose a payment account first.'):options.ocr?w('Confirmed transfers to our account are credited automatically in ETB, once.'):w('Paste your receipt message. Image scanning is unavailable.')}</p>
    {intent&&!credited&&<p className={styles.hint}>{intent.canRetry===false?w('Contact support with this deposit ID:'):waiting?w('Retry after:'):w('You can check this payment again.')} {intent.canRetry===false?intent.id:waiting&&intent.nextAttemptAt?new Date(intent.nextAttemptAt).toLocaleString():''}</p>}
    {bound&&!credited&&<button type="button" className={styles.secondary} disabled={!!busy} onClick={()=>{reset();inform(w('Paste the corrected reference. The previous deposit and its review history are kept.'))}}>{w('Correct a mistaken reference')}</button>}
    {intent&&<button type="button" className={styles.secondary} disabled={!!busy} onClick={reset}>{w('Start another deposit')}</button>}
    {busy&&<LoadingSpinner label={busy}/>}{message&&<p className={styles.hint} role="status">{message}</p>}
   </div>
   <Link className={styles.help} href="/profile/support">{w('Need help with a payment?')}<ArrowUpRight size={16}/></Link>
  </section>}
  {!!query.data?.items.length&&<details className={styles.history}><summary>{w('Deposit history')}<ChevronDown size={17}/></summary><section className="wallet-activity">{query.data.items.map(t=><article className="activity-row" key={t.id}><div><strong>{t.demo?w('DEMO preview: '):''}{w(labels[t.status]??t.status)}</strong><small>{t.demo?w('No transfer - no ETB credited'):<>{t.channel==='cbe'?'CBE':'Telebirr'} · {t.amountCents?`${money(t.amountCents)} ETB`:w('Amount awaiting verification')}</>}</small></div><div>{options?.enabled&&['PENDING','VERIFYING','PROVIDER_OUTAGE','NEEDS_REVIEW'].includes(t.status)&&<button type="button" className="text-link" disabled={!!busy} onClick={()=>{setIntent(t);setSelected(t.channel);setInput(t.reference??'');const feedback=depositFeedback(t,w);inform(feedback.message,feedback.kind);verifyKey.current='';document.getElementById('add-etb')?.scrollIntoView({behavior:'auto'})}}>{w(t.canRetry?'Check payment again':'Continue')}</button>}<Link href="/profile/support">{w('Help')}</Link></div></article>)}<PersonalPagination page={page} totalPages={query.data.totalPages} setPage={setPage}/></section></details>}
 </>;
}
