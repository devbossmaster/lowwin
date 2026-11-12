'use client';
import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {Info,LoaderCircle,Wallet} from 'lucide-react';
import {AccountSheet,AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {useChapaPayment} from './chapa-payment';
import {WalletTopUpProgress} from './wallet-top-up-progress';
import {ReferencePaymentMethods} from './reference-payment-methods';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {normalizePaymentPhone} from '@/lib/bid-batch-client';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {chapaConfirmed,type ChapaCheckoutView,type ChapaCheckoutConfig} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {getMiniQueryClient,isPrivateQueryIdentity} from './private-query-cache';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './wallet-sheet.module.css';
import reference from './reference-top-up.module.css';

const supported=new Set(['telebirr','cbebirr','mpesa']);
type TopupConfig=ChapaCheckoutConfig&{minTopup:string;maxTopup:string};
function methodsFor(config:TopupConfig|null):ChapaCheckoutConfig['methods']{return config?.enabled?config.methods.filter(item=>supported.has(item.slug)):[]}
function amountAllowed(value:string,config:TopupConfig|null){try{const cents=etbToCents(value);return !!config&&/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)&&cents>=etbToCents(config.minTopup)&&cents<=etbToCents(config.maxTopup)}catch{return false}}
function methodAllowed(value:string,slug:string,config:TopupConfig|null){try{const cents=etbToCents(value),item=methodsFor(config).find(item=>item.slug===slug);return !!item&&amountAllowed(value,config)&&(!item.minAmountCents||cents>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||cents<=BigInt(item.maxAmountCents))}catch{return false}}
export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}

type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string;retryDraft?:{amount:string;paymentMethod:string;phone:string};embedded?:boolean;onProgressChange?:(active:boolean)=>void;onDismissChange?:(back:(()=>void)|null)=>void;onCredited?:(order:ChapaCheckoutView)=>void};
function TopUp({onClose,returnFocusRef,initialChapaId,retryDraft,embedded=false,onProgressChange,onDismissChange,onCredited}:Props){
 const notice=useMiniNotice();
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const payment=useChapaPayment('topup',initialChapaId,{retainOriginal:true}),original=payment.directAttempt?.purpose==='TOP_UP'?payment.directAttempt:null;
 const [amount,setAmount]=useState(()=>retryDraft?.amount??''),[method,setMethod]=useState(()=>retryDraft?.paymentMethod??''),[phone,setPhone]=useState(()=>normalizePaymentPhone(retryDraft?.phone??'')?.slice(3)??''),[error,setError]=useState(''),[retrying,setRetrying]=useState(false),id=useId(),submitting=useRef(false),phoneEdited=useRef(!!retryDraft?.phone);
 const [showProgress,setShowProgress]=useState(!!initialChapaId);
 const reportError=(message:string)=>{setError(message);if(message)notice(message,'error',{id:`topup-validation:${id}`,duration:6000})};
 useEffect(()=>{if(!showProgress&&payment.error)notice(payment.error,'error',{id:`topup-validation:${id}`,duration:6000})},[showProgress,payment.error,notice,id]);
 useEffect(()=>{onProgressChange?.(showProgress&&payment.started);return()=>onProgressChange?.(false)},[showProgress,payment.started,onProgressChange]);
 const reportedCredit=useRef<string|null>(null);
 useEffect(()=>{const order=payment.order;if(onCredited&&order?.purpose==='TOP_UP'&&order.status==='CREDITED'&&chapaConfirmed(order)&&reportedCredit.current!==order.id){reportedCredit.current=order.id;onCredited(order)}},[payment.order,onCredited]);
 const back=null;
 useEffect(()=>{onDismissChange?.(back);return()=>onDismissChange?.(null)},[back,onDismissChange]);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated,freshnessMs:15000});
 const methods=usePrivateQuery<TopupConfig>('/api/payments/chapa/inline/config',{enabled:authenticated&&(!payment.started||!showProgress),freshnessMs:60000}),settings=methods.data;
 useEffect(()=>{if(phoneEdited.current)return;const registered=normalizePaymentPhone(settings?.phone??'');if(registered)setPhone(registered.slice(3))},[settings?.phone]);
 let cents=0n,total='0.00',valid=false;
 try{cents=etbToCents(amount);total=centsToEtb(cents);valid=amountAllowed(amount,settings)}catch{}
 const allowed=(slug:string)=>methodAllowed(total,slug,settings);
 const phoneProblem=paymentPhoneProblem(phone,method),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone);
 const presets=['10','50','100','200','500','1000'].filter(value=>{try{return !!settings&&etbToCents(value)>=etbToCents(settings.minTopup)&&etbToCents(value)<=etbToCents(settings.maxTopup)}catch{return false}});
 const retry=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order)||submitting.current)return;
  submitting.current=true;setRetrying(true);reportError('');
  try{
   const current=await payment.check();if(!current||!bidPaymentCanRetry(current))return;
   const saved=queryIdentity?readPaymentRetryDraft(getMiniQueryClient(),queryIdentity,current.id):null;
   if(!queryIdentity||!isPrivateQueryIdentity(queryIdentity)||!payment.startAgain())return;
   setAmount(current.amount);setMethod(current.paymentMethod??saved?.paymentMethod??method);
   const nextPhone=normalizePaymentPhone(saved?.phone??original?.phone??phone);
   if(nextPhone){phoneEdited.current=true;setPhone(nextPhone.slice(3))}
   setShowProgress(false);
  }catch{reportError(text('Could not check the original payment. Its status is preserved.','የመጀመሪያውን ክፍያ ማረጋገጥ አልተቻለም። ሁኔታው ተጠብቋል።'))}finally{submitting.current=false;setRetrying(false)}
 };
 const viewPayment=()=>{setShowProgress(true);void payment.check()};
 const pay=async()=>{
  if(!authenticated){openRegistration();return}
  if(submitting.current||payment.busy||retrying)return;
  if(payment.started){viewPayment();return}
  if(!settings){reportError(text('Payment methods are still loading. Please try again in a moment.','የክፍያ መንገዶች እየተጫኑ ነው። እባክዎ ትንሽ ቆይተው ይሞክሩ።'));return}
  if(!valid){reportError(text(`Enter an amount between ${settings.minTopup} and ${settings.maxTopup} ETB.`,`ከ ${settings.minTopup} እስከ ${settings.maxTopup} ብር ያስገቡ።`));return}
  if(!method){reportError(text('Choose a payment method.','የክፍያ መንገድ ይምረጡ።'));return}
  if(!settings.enabled||!allowed(method)){reportError(text('This payment method is unavailable for this amount. Choose another method.','ለዚህ መጠን ሌላ የክፍያ መንገድ ይምረጡ።'));return}
  if(!normalizedPhone){reportError(paymentPhoneProblemMessage(phoneProblem??'invalid',am));return}
  submitting.current=true;reportError('');setShowProgress(true);
  try{await payment.createInline({apiVersion:'v2',kind:'inline',flow:'INLINE',key:crypto.randomUUID(),purpose:'TOP_UP',amount:total,paymentMethod:method,phone:normalizedPhone})}finally{submitting.current=false}
 };
 const action=<button className={reference.pay} type="submit" form={id} data-payment-action data-top-up-submit disabled={payment.busy||retrying} aria-busy={payment.busy||retrying}>{(payment.busy||retrying)&&<LoaderCircle className={reference.spin} size={17} aria-hidden="true"/>}{payment.started?text('View payment status','\u12e8\u12ad\u134d\u12eb \u1201\u1294\u1273 \u12ed\u1218\u120d\u12a8\u1271'):text(authenticated?'Top up':'Log in to top up',authenticated?'ገንዘብ ያስገቡ':'ገንዘብ ለማስገባት ይግቡ')}</button>;
 const progressVisible=showProgress&&payment.started;
 const contents=progressVisible?<WalletTopUpProgress payment={{...payment,busy:payment.busy||retrying,error:error||payment.error}} amount={initialChapaId&&!payment.order?null:total} provider={method} phone={phone} onRetry={()=>void retry()} onChangePayment={()=>void retry()} onClose={onClose} footerPortal={!!onClose}/>:<form id={id} className={reference.form} data-wallet-top-up data-top-up-step="entry" data-payment-method-form noValidate onSubmit={event=>{event.preventDefault();void pay()}}>
  {payment.started&&<p className={reference.hint} role="status" data-top-up-pending-payment>{text('Your previous payment is still recorded. Check its status before paying again.','የመጀመሪያው ክፍያዎ ተመዝግቧል። ከመክፈልዎ በፊት ሁኔታውን ያረጋግጡ።')} <button type="button" onClick={viewPayment}>{text('View payment status','የክፍያ ሁኔታ ይመልከቱ')}</button></p>}
  <div className={reference.balance}><span>{text('Wallet','ዋሌት')}</span><strong data-wallet-top-up-balance>{walletDisplay(wallet.data?.available)??(authenticated?<span className={reference.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ'))}</strong></div>
  <p className={reference.walletNote}><Info size={13} aria-hidden="true"/><span>{text('Wallet funds cannot be withdrawn — they can be used to bid on any auction.','የዋሌት ገንዘብ ማውጣት አይቻልም። በማንኛውም ጨረታ ለመሳተፍ ይጠቀሙበታል።')}</span></p>
  <label className={reference.amountLabel} htmlFor={`${id}-amount`}>{text('Amount','መጠን')}</label>
  <div className={reference.amountField}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} placeholder="0.00" aria-invalid={!!amount&&!!settings&&!valid||undefined} aria-describedby={amount&&settings&&!valid?`${id}-amount-error`:undefined} disabled={payment.busy||retrying} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setAmount(event.target.value);reportError('')}}}/><span aria-hidden="true">ETB</span></div>
  <div className={reference.presets} aria-label={text('Suggested top-up amounts','የገንዘብ ማስገቢያ መጠኖች')}>{presets.map(preset=><button key={preset} type="button" disabled={payment.busy||retrying} aria-pressed={amount===preset} onClick={()=>{setAmount(preset);reportError('')}}>{formatEtb(preset).replace('ETB ','')} <span>ETB</span></button>)}</div>
  <ReferencePaymentMethods name={`${id}-method`} method={method||null} onChange={value=>{setMethod(value);reportError('')}} allowed={allowed} disabled={payment.busy||retrying}>
  {method&&supported.has(method)&&<div className={reference.phone} data-payment-phone><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={reference.phoneField}><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} value={phone} disabled={payment.busy||retrying} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);reportError('')}} aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-help`}/></div><p className={reference.hint} id={`${id}-phone-help`}>{text('Use the phone registered with your payment provider.','በክፍያ አቅራቢዎ የተመዘገበውን ስልክ ይጠቀሙ።')}</p></div>}
  </ReferencePaymentMethods>
  {authenticated&&!settings&&!methods.error&&<p className={reference.loading} role="status"><LoaderCircle className={reference.spin} size={15} aria-hidden="true"/>{text('Loading top-up limits…','የገንዘብ ማስገቢያ ገደቦች በመጫን ላይ…')}</p>}
  {(methods.error||settings&&!settings.enabled)&&<p className={reference.error} role="status">{text('Top-up methods are unavailable.','የገንዘብ ማስገቢያ መንገዶች ለጊዜው አይገኙም።')} <button type="button" onClick={methods.reload}>{text('Retry','እንደገና')}</button></p>}
  {wallet.error&&<p className={reference.hint} role="status">{text(wallet.data?'Showing your saved balance.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  {settings?.mode==='test'&&<p className={reference.hint}>{text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</p>}
  {onClose?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
 </form>;
 const title=<span className={reference.title}><Wallet size={17} aria-hidden="true"/>{text('Top up wallet','ገንዘብ ያስገቡ')}</span>;
 return embedded?contents:onClose?<AccountSheet size="payment" layout={progressVisible?undefined:'topup-reference'} title={progressVisible?text('Payment','ክፍያ'):title} presentation={progressVisible?'centered':undefined} onClose={onClose} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1>{title}</h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
