'use client';
import {useId,useRef,useState} from 'react';
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
type Intent={id:string;demo?:boolean;reused?:boolean;channel:string;status:string;amountCents?:string;points:string;account:string;accountName:string;reference:string|null;expiresAt:string;reason:string|null;caseState:string;quote:{version:number;numerator:string;denominator:string;terms:string;minCents?:string;maxCents?:string}};
type Data={options:{enabled:boolean;productionEnabled:boolean;ocr:boolean;reason:string;accounts:Account[]};items:Intent[];totalPages:number};
const money=(c:string)=>(BigInt(c)/100n).toString()+'.'+(BigInt(c)%100n).toString().padStart(2,'0');
const labels:Record<string,string>={PENDING:'Pending verification',VERIFYING:'Verifying',CREDITED:'Credited',NEEDS_REVIEW:'Needs review',REJECTED:'Rejected',DUPLICATE_CONFLICT:'Duplicate claim — contact support',PROVIDER_OUTAGE:'Provider unavailable — retry pending'};
async function compactReceipt(file:File):Promise<Blob>{
 let image:ImageBitmap|undefined;
 try{
  image=await createImageBitmap(file);const scale=Math.min(1,2000/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const context=canvas.getContext('2d',{alpha:false});if(!context)return file;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const compressed=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));return compressed&&compressed.size<file.size?compressed:file;
 }catch{return file}finally{image?.close()}
}
export function WalletFunding(){const {me}=useTelegram();return <Funding key={me?.user.id??'guest'}/>}
function Funding(){
 const w=useWalletCopy(),{refreshMe}=useTelegram(),notify=useMiniNotice(),noticeId=useId();
 const [page,setPage]=useState(1),query=usePrivateQuery<Data>(`/api/wallet/top-ups?page=${page}`);
 const [selected,setSelected]=useState(''),[intent,setIntent]=useState<Intent|null>(null),[input,setInput]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const createKey=useRef(''),verifyKey=useRef(''),working=useRef(false);
 const options=query.data?.options;
 const account:Account|undefined=intent?{id:intent.channel,policyId:'',version:intent.quote.version,name:intent.channel==='cbe'?'CBE':'Telebirr',number:intent.account,holder:intent.accountName,numerator:intent.quote.numerator,denominator:intent.quote.denominator,minCents:intent.quote.minCents??intent.amountCents??'0',maxCents:intent.quote.maxCents??intent.amountCents??'0',terms:intent.quote.terms}:options?.accounts.find(a=>a.id===selected);
 const credited=intent?.status==='CREDITED';
 const underReview=!!intent&&['NEEDS_REVIEW','DUPLICATE_CONFLICT','REJECTED'].includes(intent.status);
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
  if(working.current||!account||!input.trim()||credited||underReview)return;
  working.current=true;setBusy(w('Verifying request…'));setMessage('');
  notify(w('Verifying request…'),'info',{id:noticeId,duration:Infinity});
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
   const current=await prepare(),upload=await compactReceipt(file);
   const response=await fetch(`/api/wallet/scan?intentId=${current.id}`,{method:'POST',headers:{'Content-Type':upload.type||file.type},body:upload}),data=await response.json();
   if(!response.ok)throw Error(data.error);
   setInput(data.reference);verifyKey.current='';inform(w('Reference extracted. Review it against your receipt before submitting.'),'success');
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
    <textarea className={styles.textarea} id="verified-reference" maxLength={4000} value={credited?(intent.reference??input):input} disabled={!account||!!busy||credited||underReview} onChange={event=>{setInput(event.target.value);verifyKey.current=''}} placeholder={w('Paste the payment SMS, including its receipt link')}/>
    <div className={styles.divider}>{w('Or upload a screenshot')}</div>
    <label className={styles.upload} aria-disabled={!account||!options.ocr||!!busy||credited||underReview}><Upload size={23}/><strong>{w('Upload receipt image')}</strong><span>{w('JPEG, PNG or WebP - up to 5 MB')}</span><input aria-label={w('Upload receipt image')} type="file" accept="image/png,image/jpeg,image/webp" disabled={!account||!options.ocr||!!busy||credited||underReview} onChange={event=>{void scan(event.target.files?.[0]);event.target.value=''}}/></label>
    <button type="button" className={styles.submit} disabled={!account||!input.trim()||!!busy||credited||underReview} onClick={()=>void submit()}>{busy?<LoadingSpinner/>:credited?w('Deposit credited'):underReview?w(intent?.status==='REJECTED'?'Deposit rejected':'Under admin review'):w('Submit deposit')}</button>
    <p className={styles.footnote}>{!account?w('Choose a payment account first.'):options.ocr?w('Your wallet is credited automatically when all payment details match.'):w('Paste your receipt message. Image scanning is unavailable.')}</p>
    {intent&&<button type="button" className={styles.secondary} disabled={!!busy} onClick={reset}>{w('Start another deposit')}</button>}
    {busy&&<LoadingSpinner label={busy}/>}{message&&<p className={styles.hint} role="status">{message}</p>}
   </div>
   <Link className={styles.help} href="/profile/support">{w('Need help with a payment?')}<ArrowUpRight size={16}/></Link>
  </section>}
  {!!query.data?.items.length&&<details className={styles.history}><summary>{w('Deposit history')}<ChevronDown size={17}/></summary><section className="wallet-activity">{query.data.items.map(t=><article className="activity-row" key={t.id}><div><strong>{t.demo?w('DEMO preview: '):''}{w(labels[t.status]??t.status)}</strong><small>{t.demo?w('No transfer - no ETB credited'):<>{t.channel==='cbe'?'CBE':'Telebirr'} · {t.amountCents?`${money(t.amountCents)} ETB`:w('Amount awaiting verification')}</>}</small></div><div>{options?.enabled&&['PENDING','VERIFYING','PROVIDER_OUTAGE','NEEDS_REVIEW'].includes(t.status)&&<button type="button" className="text-link" disabled={!!busy} onClick={()=>{setIntent(t);setSelected(t.channel);setInput(t.reference??'');const feedback=depositFeedback(t,w);inform(feedback.message,feedback.kind);verifyKey.current='';document.getElementById('add-etb')?.scrollIntoView({behavior:'auto'})}}>{w('Continue')}</button>}<Link href="/profile/support">{w('Help')}</Link></div></article>)}<PersonalPagination page={page} totalPages={query.data.totalPages} setPage={setPage}/></section></details>}
 </>;
}
