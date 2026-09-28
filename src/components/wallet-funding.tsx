'use client';
import {useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ChevronDown,Upload} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery,PersonalPagination} from './private-query';
import {WalletFundingPreview} from './wallet-funding-preview';
import {PaymentAccounts} from './payment-accounts';
import styles from './wallet-page.module.css';
type Account={id:string;policyId:string;version:number;name:string;number:string;holder:string;numerator:string;denominator:string;minCents:string;maxCents:string;terms:string};
type Intent={id:string;demo?:boolean;channel:string;status:string;amountCents:string;points:string;account:string;accountName:string;reference:string|null;expiresAt:string;reason:string|null;caseState:string;quote:{version:number;numerator:string;denominator:string;terms:string}};
type Data={options:{enabled:boolean;ocr:boolean;reason:string;accounts:Account[]};items:Intent[];totalPages:number};
const money=(c:string)=>(BigInt(c)/100n).toString()+'.'+(BigInt(c)%100n).toString().padStart(2,'0');
const labels:Record<string,string>={PENDING:'Pending verification',VERIFYING:'Verifying',CREDITED:'Credited',NEEDS_REVIEW:'Needs review',REJECTED:'Rejected',DUPLICATE_CONFLICT:'Duplicate claim — contact support',PROVIDER_OUTAGE:'Provider unavailable — retry pending'};
export function WalletFunding(){const {me}=useTelegram();return <Funding key={me?.user.id??'guest'}/>}
function Funding(){const {refreshMe}=useTelegram();const [page,setPage]=useState(1),query=usePrivateQuery<Data>(`/api/wallet/top-ups?page=${page}`),[selected,setSelected]=useState(''),[amount,setAmount]=useState(''),[intent,setIntent]=useState<Intent|null>(null),[input,setInput]=useState(''),[checked,setChecked]=useState(false),[method,setMethod]=useState('text'),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[createKey,setCreateKey]=useState(''),[verifyKey,setVerifyKey]=useState('');
 const options=query.data?.options,account=intent?{id:intent.channel,policyId:'',version:intent.quote.version,name:intent.channel==='cbe'?'CBE':'Telebirr',number:intent.account,holder:intent.accountName,numerator:intent.quote.numerator,denominator:intent.quote.denominator,minCents:intent.amountCents,maxCents:intent.amountCents,terms:intent.quote.terms}:options?.accounts.find(a=>a.id===selected);let amountCents=0n,points:bigint|null=null;try{if(/^\d{1,9}(\.\d{1,2})?$/.test(amount)){const [a,b='']=amount.split('.');amountCents=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(account&&amountCents*BigInt(account.numerator)%BigInt(account.denominator)===0n)points=amountCents*BigInt(account.numerator)/BigInt(account.denominator)}}catch{}
 async function command(action:string,body:unknown){setBusy('Verifying request…');setMessage('');try{const r=await fetch('/api/wallet/top-ups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input:body})}),b=await r.json();if(!r.ok)throw Error(b.error);setIntent(b);if(action==='verify'){if(b.status!=='CREDITED')setVerifyKey('');setMessage(b.status==='CREDITED'?`${b.points} ETB credited. Receipt recorded.`:`${labels[b.status]??b.status}. ${b.reason?.replaceAll('_',' ')??''}`);window.dispatchEvent(new Event('lowin-wallet-updated'));query.reload();if(b.status==='CREDITED')await refreshMe().catch(()=>setMessage(`${b.points} ETB credited. Receipt recorded. Header refresh failed; reopen the wallet to refresh.`))}}catch(e){setMessage(e instanceof Error?e.message:'Try again.')}finally{setBusy('')}}
 async function scan(file?:File){if(!file||!intent||intent.status==='CREDITED')return;setBusy('Uploading and scanning receipt…');setMessage('');setChecked(false);try{const r=await fetch(`/api/wallet/scan?intentId=${intent.id}`,{method:'POST',headers:{'Content-Type':file.type},body:file}),b=await r.json();if(!r.ok)throw Error(b.error);setInput(b.reference);setVerifyKey('');setMessage('Reference extracted. Review it against your receipt before submitting.')}catch(e){setInput('');setMethod('text');setMessage((e instanceof Error?e.message:'Scan failed.')+' You can enter the reference manually.')}finally{setBusy('')}}
 if(query.status==='loading'||query.status==='authenticated'&&!query.data&&!query.error)return <section className={styles.funding} id="add-etb"><h2>Add money</h2><p className={styles.hint} role="status">Loading payment accounts...</p></section>;
 if(query.error)return <section className={styles.funding} id="add-etb"><h2>Add money</h2><p className={styles.error} role="alert">Payment accounts could not load.<button type="button" onClick={query.reload}>Retry</button></p></section>;
 return <>
  {!options?.enabled?<WalletFundingPreview/>:<section className={styles.funding} id="add-etb">
   <h2>Add money</h2>
   <PaymentAccounts accounts={intent&&account?[account]:options.accounts} selected={selected} onSelect={id=>{setSelected(id);setCreateKey('')}} locked={!!intent} busy={!!busy} preview/>
   <p className={styles.hint}>{options.reason}</p>
   {account&&!intent&&<section className={styles.quote}>
    <label className={styles.fieldLabel} htmlFor="fund-amount">Deposit amount (ETB)</label><input className={styles.amountInput} id="fund-amount" inputMode="decimal" value={amount} disabled={!!busy} onChange={e=>{setAmount(e.target.value);setCreateKey('')}} placeholder="Enter amount"/>
    <p>Allowed: {money(account.minCents)} - {money(account.maxCents)} ETB</p><strong>{points!==null?`${points} ETB to your wallet`:'Choose a whole ETB amount.'}</strong><p>{account.terms}</p>
    <button type="button" className={styles.submit} disabled={!!busy||!points||amountCents<BigInt(account.minCents)||amountCents>BigInt(account.maxCents)} onClick={()=>{const key=createKey||crypto.randomUUID();setCreateKey(key);void command('create',{key,channel:selected,policyId:account.policyId,amountCents:amountCents.toString()})}}>Accept quote & continue</button>
   </section>}
   <div className={styles.confirmation}>
    <div className={styles.sectionHeading}><h3>Payment confirmation</h3><span>Paste message or upload</span></div>
    {intent&&<p className={styles.hint}>Deposit {money(intent.amountCents)} ETB for {intent.points} ETB. Expires {new Date(intent.expiresAt).toLocaleTimeString()}.</p>}
    <label className={styles.fieldLabel} htmlFor="verified-reference">Telebirr or CBE message/link</label>
    <textarea className={styles.textarea} id="verified-reference" maxLength={4000} value={intent?.status==='CREDITED'?(intent.reference??input):input} disabled={!intent||!!busy||intent.status==='CREDITED'} onChange={e=>{setInput(e.target.value);setChecked(false);setVerifyKey('')}} placeholder="Paste the payment SMS, including its receipt link"/>
    <div className={styles.divider}>Or upload a screenshot</div>
    <label className={styles.upload} aria-disabled={!intent||!options.ocr||!!busy||intent?.status==='CREDITED'}><Upload size={23}/><strong>Upload receipt image</strong><span>JPEG, PNG or WebP - up to 5 MB</span><input aria-label="Upload receipt image" type="file" accept="image/png,image/jpeg,image/webp" disabled={!intent||!options.ocr||!!busy||intent?.status==='CREDITED'} onChange={e=>{setMethod('image');void scan(e.target.files?.[0])}}/></label>
    {intent&&<label className={styles.review}><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={!!busy||intent.status==='CREDITED'}/>I reviewed {method==='image'?'the extracted':'this'} reference and the saved quote.</label>}
    <button type="button" className={styles.submit} disabled={!intent||!checked||!input||!!busy||intent.status==='CREDITED'} onClick={()=>{if(!intent)return;const key=verifyKey||crypto.randomUUID();setVerifyKey(key);void command('verify',{id:intent.id,key,input})}}>{busy?'Processing...':intent?.status==='CREDITED'?'Deposit credited':'Submit deposit'}</button>
    <p className={styles.footnote}>{!intent?'Choose an account and confirm your deposit amount first.':options.ocr?'Receipts are verified before your wallet is credited.':'Paste your receipt message. Image scanning is unavailable.'}</p>
    {intent&&<button type="button" className={styles.secondary} disabled={!!busy} onClick={()=>{setIntent(null);setInput('');setChecked(false);setCreateKey('');setVerifyKey('')}}>Start another deposit</button>}
    {busy&&<p className={styles.hint} role="status">{busy}</p>}{message&&<p className={styles.hint} role="status">{message}</p>}
   </div>
   <Link className={styles.help} href="/profile/support">Need help with a payment?<ArrowUpRight size={16}/></Link>
  </section>}
  {!!query.data?.items.length&&<details className={styles.history}><summary>Deposit history<ChevronDown size={17}/></summary><section className="wallet-activity">{query.data.items.map(t=><article className="activity-row" key={t.id}><div><strong>{t.demo?'DEMO preview: ':''}{labels[t.status]??t.status}</strong><small>{t.demo?'No transfer - no ETB credited':<>{t.channel==='cbe'?'CBE':'Telebirr'} - {money(t.amountCents)} ETB</>}</small><small>{t.caseState.replaceAll('_',' ')}</small></div><div>{options?.enabled&&['PENDING','VERIFYING','PROVIDER_OUTAGE','NEEDS_REVIEW'].includes(t.status)&&<button type="button" className="text-link" onClick={()=>{setIntent(t);setSelected(t.channel);setAmount(money(t.amountCents));setInput(t.reference??'');setChecked(false);setVerifyKey('');document.getElementById('add-etb')?.scrollIntoView({behavior:'auto'})}}>Continue</button>}<Link href="/profile/support">Help</Link></div></article>)}<PersonalPagination page={page} totalPages={query.data.totalPages} setPage={setPage}/></section></details>}
 </>;
}
