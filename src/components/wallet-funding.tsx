'use client';
import {useMiniPage} from './mini-query-state';
import {paymentChannelName} from '@/lib/payment-channels';
import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {TelegramLink} from './telegram-link';
import {ArrowDownLeft,RefreshCw} from 'lucide-react';
import {useWalletCopy} from './wallet-copy';
import {LoadingSpinner} from './loading-spinner';
import {WalletFundingSkeleton} from './wallet-funding-skeleton';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery,PersonalPagination} from './private-query';
import {WalletFundingPreview} from './wallet-funding-preview';
import {PaymentAccounts,PaymentLogo} from './payment-accounts';
import {ReceiptImageUpload,type SelectedReceipt} from './receipt-image-upload';
import {PaymentHelp} from './payment-help';
import {useMiniNotice} from './mini-notice';
import {customerDepositFailures} from '../lib/deposit-outcome';
import {depositFeedback} from './deposit-feedback';
import {startDepositPolling,paymentPollRetryAfter} from './deposit-polling';
import {receiptImageKey} from './receipt-image-key';
import {invalidatePrivateQueries,setPrivateQueryIdentity} from './private-query-cache';
import styles from './wallet-page.module.css';

type Account={id:string;policyId:string;version:number;name:string;number:string;holder:string;numerator:string;denominator:string;minCents:string;maxCents:string;terms:string};
type Intent={canRetry?:boolean;retryBlocked?:string|null;retryUntil?:string;nextAttemptAt?:string;attempts?:number;id:string;createdAt:string;demo?:boolean;reused?:boolean;channel:string;status:string;amountCents?:string;points:string;account:string;accountName:string;reference:string|null;expiresAt:string;reason:string|null;caseState:string;quote:{version:number;numerator:string;denominator:string;terms:string;minCents?:string;maxCents?:string}};
type Data={options:{enabled:boolean;productionEnabled:boolean;ocr:boolean;reason:string;accounts:Account[]};items:Intent[];totalPages:number};
const money=(c:string)=>(BigInt(c)/100n).toString()+'.'+(BigInt(c)%100n).toString().padStart(2,'0');
const depositLimit=(c:string)=>{const cents=BigInt(c),fraction=cents%100n;return `${new Intl.NumberFormat('en-US').format(cents/100n)}${fraction?'.'+fraction.toString().padStart(2,'0'):''}`};
const labels:Record<string,string>={PENDING:'Pending verification',VERIFYING:'Verifying',CREDITED:'Credited',NEEDS_REVIEW:'Needs review',REJECTED:'Rejected',DUPLICATE_CONFLICT:'Transaction ID already used',PROVIDER_OUTAGE:'Provider unavailable — retry pending'};
type FundingView='deposit'|'deposits'|'hidden';
export function WalletFunding({view='deposit',onContinue}:{view?:FundingView;onContinue?:()=>void}){const {me,queryIdentity}=useTelegram();return <Funding key={queryIdentity??'guest'} view={view} onContinue={onContinue}/>}
function Funding({view,onContinue}:{view:FundingView;onContinue?:()=>void}){
 const w=useWalletCopy(),{refreshMe,me,queryIdentity}=useTelegram(),notify=useMiniNotice(),noticeId=useId();
 const [page,setPage]=useMiniPage('depositsPage'),query=usePrivateQuery<Data>(`/api/wallet/top-ups?page=${page}`);
 const [selected,setSelected]=useState(''),[intent,setIntent]=useState<Intent|null>(null),[input,setInput]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[receipt,setReceipt]=useState<SelectedReceipt|null>(null);
 const createKey=useRef(''),verifyKey=useRef(''),imageKeys=useRef(new Map<string,string>()),working=useRef(false),receiptUrl=useRef<string|null>(null);
 const options=query.data?.options;
 const account:Account|undefined=intent?{id:intent.channel,policyId:'',version:intent.quote.version,name:paymentChannelName(intent.channel),number:intent.account,holder:intent.accountName,numerator:intent.quote.numerator,denominator:intent.quote.denominator,minCents:intent.quote.minCents??intent.amountCents??'0',maxCents:intent.quote.maxCents??intent.amountCents??'0',terms:intent.quote.terms}:options?.accounts.find(a=>a.id===selected);
 const credited=intent?.status==='CREDITED';
 useEffect(()=>{
  if(!intent||intent.status!=='VERIFYING'||view!=='deposit')return;
  let cancelled=false;
  const stop=startDepositPolling(async signal=>{
   const response=await fetch(`/api/wallet/top-ups?intentId=${encodeURIComponent(intent.id)}`,{cache:'no-store',signal});
   if(cancelled)return {done:true};
   if(response.status===401||response.status===403){setPrivateQueryIdentity(null);void refreshMe().catch(()=>{});return {done:true}}
   if(response.status===404)return {done:true};
   if(!response.ok)return {retryAfterMs:paymentPollRetryAfter(response.headers.get('retry-after'))};
   const updated=await response.json() as Intent;
   if(cancelled||updated.id!==intent.id)return {done:true};
   if(updated.status==='VERIFYING')return {};
   setIntent(updated);query.reload();
   const feedback=depositFeedback(updated,w);inform(feedback.message,feedback.kind);
   if(updated.status==='CREDITED'){if(queryIdentity)invalidatePrivateQueries(queryIdentity);window.dispatchEvent(new Event('lowin-wallet-updated'));window.dispatchEvent(new Event('lowin-alerts'));void refreshMe()}
   return {done:true};
  },()=>document.visibilityState==='visible',()=>{
   if(!cancelled)inform(w('Verification is still pending. Reopen your deposits to check the result.'),'info');
  });
  return()=>{cancelled=true;stop()};
 // Polling is tied to the selected deposit, not to query refreshes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[intent?.id,intent?.status,view,queryIdentity]);
 const [now,setNow]=useState(0);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[]);
 const underReview=!!intent&&(intent.canRetry===false||['DUPLICATE_CONFLICT','REJECTED','REVERSED'].includes(intent.status));
 const correctable=!!intent&&(intent.status==='DUPLICATE_CONFLICT'||intent.status==='REJECTED'&&customerDepositFailures.has(intent.reason??''));
 const waiting=!!intent?.nextAttemptAt&&new Date(intent.nextAttemptAt).getTime()>now;
 const bound=!!intent?.reference;
 const showRecoveryActions=!!intent&&(credited||correctable||(intent.attempts??0)>0)&&intent.status!=='VERIFYING';
 const scannerAvailable=!!options?.ocr;
 useEffect(()=>()=>{if(receiptUrl.current)URL.revokeObjectURL(receiptUrl.current)},[]);
 function inform(text:string,kind:'success'|'error'|'info'='info'){setMessage(text);notify(text,kind,{id:noticeId,duration:8000})}
 function clearReceipt(){if(receiptUrl.current)URL.revokeObjectURL(receiptUrl.current);receiptUrl.current=null;setReceipt(null)}
 function chooseReceipt(file?:File){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){inform(w('Choose a JPEG, PNG or WebP image.'),'error');return}if(file.size>5*1024*1024){inform(w('Use an image smaller than 5 MB.'),'error');return}clearReceipt();const url=URL.createObjectURL(file);receiptUrl.current=url;setReceipt({file,url,name:file.name,size:file.size});setInput('');verifyKey.current=''}
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
  if(working.current||!account||(!input.trim()&&!receipt)||credited||underReview||waiting)return;
  const image=receipt?.file;working.current=true;setBusy(w(image?'Uploading and verifying receipt…':'Checking payment…'));setMessage('');
  notify(w(image?'Uploading and verifying receipt…':'Checking payment…'),'info',{id:noticeId,duration:Infinity});
  try{
   const current=await prepare(image?undefined:input);let updated:Intent;
   if(image){const key=await receiptImageKey(imageKeys.current,current.id,image);const response=await fetch(`/api/wallet/scan?intentId=${current.id}`,{method:'POST',headers:{'Content-Type':image.type,'Idempotency-Key':key},body:image}),data=await response.json();if(!response.ok)throw Error(data.error);updated=data as Intent}
   else {verifyKey.current ||= crypto.randomUUID();updated=await command('verify',{id:current.id,key:verifyKey.current,input});if(updated.status!=='CREDITED')verifyKey.current=''}
   setIntent(updated);const feedback=depositFeedback(updated,w);inform(feedback.message,feedback.kind);
   query.reload();
   if(updated.status==='CREDITED'){
    if(queryIdentity)invalidatePrivateQueries(queryIdentity);
    window.dispatchEvent(new Event('lowin-wallet-updated'));window.dispatchEvent(new Event('lowin-alerts'));
    void refreshMe().catch(()=>setMessage(`${updated.points} ${w('ETB credited. Receipt recorded.')} ${w('Reopen the wallet to refresh your balance.')}`));
   }
  }catch(error){inform(w(error instanceof Error?error.message:'Try again.'),'error')}finally{working.current=false;setBusy('')}
 }
 function reset(){setIntent(null);setInput('');setMessage('');clearReceipt();createKey.current='';verifyKey.current='';imageKeys.current.clear()}
 if(query.status==='loading'||query.status==='authenticated'&&!query.data&&!query.error)return <section hidden={view==='hidden'} className={styles.funding} aria-busy="true"><h2>{w(view==='deposit'?'Add money':'Deposits')}</h2><WalletFundingSkeleton variant={view==='deposits'?'deposits':'deposit'}/></section>;
 if(query.error&&!query.data)return <section hidden={view==='hidden'} className={styles.funding}><h2>{w(view==='deposit'?'Add money':'Deposits')}</h2><p className={styles.error} role="alert">{w(view==='deposit'?'Payment accounts could not load.':'Deposit history could not load.')}<button type="button" onClick={query.reload}>{w('Retry')}</button></p></section>;
 return <>
  <div hidden={view!=='deposit'}>{!options?.enabled?<WalletFundingPreview/>:<section className={styles.funding} id="add-etb" aria-busy={!!busy}>
   <h2>{w('Add money')}</h2>
   <PaymentAccounts accounts={intent&&account?[account]:options.accounts} selected={selected} onSelect={id=>{setSelected(id);setInput('');setMessage('');clearReceipt();createKey.current='';verifyKey.current=''}} locked={!!intent} busy={!!busy} preview={!options.productionEnabled}/>
   {account?<p className={styles.hint}><span>{w('Minimum deposit')} <strong>ETB {depositLimit(account.minCents)}</strong></span><span>{w('Maximum deposit')} <strong>ETB {depositLimit(account.maxCents)}</strong></span></p>:<p className={styles.selectionHint}>{w('Choose Telebirr or M-Pesa to add money.')}</p>}
   {account&&<div className={styles.confirmation}>
    <div className={styles.sectionHeading}><h3>{w('Payment confirmation')}</h3><span>{w('Paste message or upload')}</span></div>
    <div className={styles.referenceHeader}>
     <label className={styles.fieldLabel} htmlFor="verified-reference">{w('Telebirr or M-Pesa message/link')}</label>
     {showRecoveryActions&&<div className={styles.referenceActions}>
      {(bound||correctable)&&!credited&&<button type="button" className={styles.secondary} disabled={!!busy} onClick={()=>{reset();inform(w('Paste the correct transaction ID to try again.'))}}>{w('Correct a mistaken reference')}</button>}
      <button type="button" className={styles.secondary} disabled={!!busy} onClick={reset}>{w('Start another deposit')}</button>
     </div>}
    </div>
    <textarea className={styles.textarea} id="verified-reference" maxLength={4000} value={credited?(intent.reference??input):input} disabled={!account||!!busy||credited||underReview} readOnly={bound} onChange={event=>{setInput(event.target.value);if(event.target.value)clearReceipt();verifyKey.current=''}} placeholder={w('Paste a transaction ID, payment SMS or official receipt link')}/>
    <div className={styles.divider}>{w('Or upload a screenshot')}</div>
    <ReceiptImageUpload receipt={receipt} disabled={!scannerAvailable||!!busy||credited||underReview||bound} onSelect={chooseReceipt} onRemove={clearReceipt}/>
    <button type="button" className={styles.submit} disabled={!account||(!input.trim()&&!receipt)||!!busy||credited||underReview||waiting} onClick={()=>void submit()}>{busy?<LoadingSpinner/>:credited?w('Deposit credited'):underReview?w(intent?.status==='REJECTED'?'Deposit rejected':'Under admin review'):w(intent?.attempts?'Check payment again':'Submit deposit')}</button>
    <p className={styles.footnote}>{options.ocr?w('Confirmed transfers to our account are credited automatically in ETB, once.'):w('Paste your receipt message. Image scanning is unavailable.')}</p>
    {intent&&!credited&&<p className={styles.hint}>{correctable?w('Use Correct a mistaken reference to enter another transaction ID.'):intent.canRetry===false?w('Contact support with this deposit ID:'):waiting?w('Retry after:'):w('You can check this payment again.')} {!correctable&&intent.canRetry===false?intent.id:waiting&&intent.nextAttemptAt?new Date(intent.nextAttemptAt).toLocaleString():''}</p>}
    {busy&&<LoadingSpinner label={busy}/>}{message&&<p className={styles.hint} role="status">{message}</p>}
   </div>}
   <PaymentHelp/>
  </section>}</div>
  <section hidden={view!=='deposits'} className={styles.transactionSection} aria-label={w('Deposits')}>
   <div className={styles.sectionHeading}><h2>{w('Deposits')}</h2><button type="button" className={styles.refresh} disabled={!!busy} onClick={query.reload}><RefreshCw size={15}/>{w('Refresh')}</button></div>
   <p className={styles.sectionDescription}>{w('Track your submitted payments and their status.')}</p>
   {!query.data?.items.length?<div className={styles.empty}><ArrowDownLeft size={28}/><h3>{w('No deposits yet')}</h3><p>{w('Your submitted payments will appear here.')}</p><button type="button" className={styles.inlineAction} onClick={onContinue}>{w('Add money')}</button></div>:<div className={styles.transactionList}>{query.data.items.map(t=><article className={styles.depositRow} key={t.id}><div className={styles.depositSummary}><PaymentLogo channel={t.channel}/><div><strong>{w(paymentChannelName(t.channel))}{t.demo?' · DEMO':''}</strong><small>{new Date(t.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</small></div><span className={styles.depositAmount}>{t.amountCents?`${money(t.amountCents)} ETB`:w('Awaiting amount')}</span></div><div className={styles.depositStatus}><span className={styles.statusBadge} data-state={t.status}>{w(t.reason==='ADMIN_CREDIT_REPLACEMENT'?'Resolved by admin':labels[t.status]??t.status)}</span><div>{options?.enabled&&['PENDING','VERIFYING','PROVIDER_OUTAGE','NEEDS_REVIEW'].includes(t.status)&&<button type="button" className={styles.inlineAction} disabled={!!busy} onClick={()=>{clearReceipt();setIntent(t);setSelected(t.channel);setInput(t.reference??'');const feedback=depositFeedback(t,w);inform(feedback.message,feedback.kind);createKey.current='';verifyKey.current='';onContinue?.()}}>{w(t.canRetry?'Check payment again':'Continue')}</button>}<TelegramLink>{w('Help')}</TelegramLink></div></div></article>)}</div>}
   <PersonalPagination page={page} totalPages={query.data?.totalPages??0} setPage={setPage}/>
  </section>
 </>;
}
