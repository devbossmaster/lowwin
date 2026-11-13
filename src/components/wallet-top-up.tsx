'use client';
import {useCallback,useEffect,useId,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,Gift,Info,LoaderCircle,Wallet} from 'lucide-react';
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
import {depositBonusPreview} from '@/lib/deposit-bonus-preview';
import {DepositBonusCard} from './deposit-bonus-card';
import {chapaConfirmed,type ChapaCheckoutView,type ChapaCheckoutConfig} from '@/lib/chapa-client';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {getMiniQueryClient,isPrivateQueryIdentity} from './private-query-cache';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from './wallet-sheet.module.css';
import reference from './reference-top-up.module.css';

const supported=new Set(['telebirr','cbebirr','mpesa']);
type TopupConfig=ChapaCheckoutConfig;
function methodsFor(config:TopupConfig|null){return config?.enabled?config.methods.filter(item=>supported.has(item.slug)):[]}
function amountAllowed(value:string,config:TopupConfig|null){try{const cents=etbToCents(value);return !!config&&/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)&&cents>=etbToCents(config.minTopup)&&cents<=etbToCents(config.maxTopup)}catch{return false}}
function methodAllowed(value:string,slug:string,config:TopupConfig|null){try{const cents=etbToCents(value),item=methodsFor(config).find(item=>item.slug===slug);return !!item&&amountAllowed(value,config)&&(!item.minAmountCents||cents>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||cents<=BigInt(item.maxAmountCents))}catch{return false}}
export function walletDisplay(value?:string){try{return value===undefined?null:`${centsToEtb(etbToCents(value))} ETB`}catch{return null}}

type Props={onClose?:()=>void;returnFocusRef?:RefObject<HTMLElement|null>;initialChapaId?:string;retryDraft?:{amount:string;paymentMethod:string;phone:string};embedded?:boolean;onProgressChange?:(active:boolean)=>void;onDismissChange?:(back:(()=>void)|null)=>void;onCredited?:(order:ChapaCheckoutView)=>void};
function TopUp({onClose,returnFocusRef,initialChapaId,retryDraft,embedded=false,onProgressChange,onDismissChange,onCredited}:Props){
 const notice=useMiniNotice();
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,openRegistration}=useTelegram(),authenticated=!!queryIdentity;
 const payment=useChapaPayment('topup',initialChapaId,{retainOriginal:true}),original=payment.directAttempt?.purpose==='TOP_UP'?payment.directAttempt:null;
 const [amount,setAmount]=useState(()=>retryDraft?.amount??''),[method,setMethod]=useState(()=>retryDraft?.paymentMethod??''),[phone,setPhone]=useState(()=>normalizePaymentPhone(retryDraft?.phone??'')?.slice(3)??''),[error,setError]=useState(''),[retrying,setRetrying]=useState(false),[stage,setStage]=useState<'amount'|'bonus'|'payment'>(retryDraft?'payment':'amount'),[showProgress,setShowProgress]=useState(!!initialChapaId);
 const id=useId(),submitting=useRef(false),phoneEdited=useRef(!!retryDraft?.phone),reportedCredit=useRef<string|null>(null);
 const reportError=(message:string)=>{setError(message);if(message)notice(message,'error',{id:`topup-validation:${id}`,duration:6000})};
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:authenticated,freshnessMs:15000});
 // One cached reader stays mounted while the customer moves through this sheet.
 const methods=usePrivateQuery<TopupConfig>('/api/payments/chapa/inline/config',{enabled:authenticated,freshnessMs:60000}),settings=methods.data;
 const progressVisible=showProgress&&payment.started;
 const backToAmount=useCallback(()=>{setStage('amount');setError('')},[]);
 const back=!progressVisible&&stage!=='amount'?backToAmount:null;
 useEffect(()=>{onDismissChange?.(back);return()=>onDismissChange?.(null)},[back,onDismissChange]);
 useEffect(()=>{onProgressChange?.(progressVisible);return()=>onProgressChange?.(false)},[progressVisible,onProgressChange]);
 useEffect(()=>{const order=payment.order;if(onCredited&&order?.purpose==='TOP_UP'&&order.status==='CREDITED'&&chapaConfirmed(order)&&reportedCredit.current!==order.id){reportedCredit.current=order.id;onCredited(order)}},[payment.order,onCredited]);
 useEffect(()=>{if(phoneEdited.current)return;const registered=normalizePaymentPhone(settings?.phone??'');if(registered)setPhone(registered.slice(3))},[settings?.phone]);
 useEffect(()=>{if(!payment.started&&payment.errorCode==='DEPOSIT_BONUS_CHANGED'){setShowProgress(false);setStage('payment');setError(payment.error);methods.reload()}},[payment.started,payment.errorCode,payment.error,methods.reload]);
 useEffect(()=>{if(!progressVisible&&payment.error)notice(payment.error,'error',{id:`topup-validation:${id}`,duration:6000})},[progressVisible,payment.error,notice,id]);
 let total='0.00',valid=false;
 try{total=centsToEtb(etbToCents(amount));valid=amountAllowed(amount,settings)}catch{}
 const bonus=depositBonusPreview(total,settings?.depositBonus),policy=settings?.depositBonus;
 const allowed=(slug:string)=>methodAllowed(total,slug,settings);
 const phoneProblem=paymentPhoneProblem(phone,method),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone);
 const presets=['10','50','100','200','500','1000'].filter(value=>amountAllowed(value,settings));
 const busy=payment.busy||retrying;
 const viewPayment=()=>{setShowProgress(true);void payment.check()};
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
   setStage('payment');setShowProgress(false);
  }catch{reportError(text('Could not check the original payment. Its status is preserved.','የመጀመሪያውን ክፍያ ማረጋገጥ አልተቻለም። ሁኔታው ተጠብቋል።'))}finally{submitting.current=false;setRetrying(false)}
 };
 const continueToPayment=()=>{
  if(!authenticated){openRegistration();return}
  if(payment.started){viewPayment();return}
  if(!settings){reportError(text('Payment details are loading. Please try again.','የክፍያ ዝርዝሮች እየተጫኑ ነው። እንደገና ይሞክሩ።'));return}
  if(!valid){reportError(text(`Enter ${settings.minTopup}–${settings.maxTopup} ETB.`,`ከ ${settings.minTopup} እስከ ${settings.maxTopup} ብር ያስገቡ።`));return}
  reportError('');setStage(bonus.active&&policy&&etbToCents(total)<etbToCents(policy.minAmount)?'bonus':'payment');
 };
 const pay=async()=>{
  if(!authenticated){openRegistration();return}
  if(submitting.current||busy)return;
  if(payment.started){viewPayment();return}
  if(!settings||!valid){backToAmount();return}
  if(!method){reportError(text('Choose a payment method.','የክፍያ መንገድ ይምረጡ።'));return}
  if(!settings.enabled||!allowed(method)){reportError(text('Choose an available payment method for this amount.','ለዚህ መጠን የሚገኝ የክፍያ መንገድ ይምረጡ።'));return}
  if(!normalizedPhone){reportError(paymentPhoneProblemMessage(phoneProblem??'invalid',am));return}
  submitting.current=true;reportError('');setShowProgress(true);
  try{await payment.createInline({apiVersion:'v2',kind:'inline',flow:'INLINE',key:crypto.randomUUID(),purpose:'TOP_UP',amount:total,paymentMethod:method,phone:normalizedPhone,...(policy?{approvedDepositBonusVersion:policy.version,approvedDepositBonusAmount:bonus.bonusAmount}:{})})}finally{submitting.current=false}
 };
 const action=<div className={reference.actions}><button className={reference.pay} type="submit" form={id} data-payment-action data-top-up-submit disabled={busy} aria-busy={busy}>{busy&&<LoaderCircle className={reference.spin} size={17} aria-hidden="true"/>}{payment.started?text('View payment status','የክፍያ ሁኔታ ይመልከቱ'):!authenticated?text('Log in to top up','ለመሙላት ይግቡ'):stage==='amount'?text('Continue to payment','ወደ ክፍያ ይቀጥሉ'):stage==='bonus'?text('Continue without bonus','ያለ ጉርሻ ይቀጥሉ'):text(`Pay ${formatEtb(total)}`,`${formatEtb(total)} ይክፈሉ`)}</button>{stage==='bonus'&&<button className={reference.secondary} type="button" onClick={backToAmount}><ArrowLeft size={15} aria-hidden="true"/>{text('Change amount','መጠኑን ይቀይሩ')}</button>}</div>;
 const contents=progressVisible?<WalletTopUpProgress payment={{...payment,busy,error:error||payment.error}} amount={initialChapaId&&!payment.order?null:total} provider={method} phone={phone} onRetry={()=>void retry()} onChangePayment={()=>void retry()} onClose={onClose} footerPortal={!!onClose}/>:<form id={id} className={reference.form} data-wallet-top-up data-top-up-step={stage} data-payment-method-form={stage==='payment'?true:undefined} noValidate onSubmit={event=>{event.preventDefault();if(stage==='amount')continueToPayment();else if(stage==='bonus'){reportError('');setStage('payment')}else void pay()}}>
  {payment.started&&<p className={reference.hint} role="status" data-top-up-pending-payment>{text('Your previous payment is still recorded. Check its status before paying again.','የቀደመው ክፍያዎ ተመዝግቧል። እንደገና ከመክፈልዎ በፊት ሁኔታውን ያረጋግጡ።')} <button type="button" onClick={viewPayment}>{text('View payment status','የክፍያ ሁኔታ ይመልከቱ')}</button></p>}
  {stage==='amount'?<>
   <div className={reference.balance}><span>{text('Available balance','ያለዎት ቀሪ ሂሳብ')}</span><strong data-wallet-top-up-balance>{walletDisplay(wallet.data?.available)??(authenticated?<span className={reference.placeholder} aria-label={text('Loading balance','ቀሪ ሂሳብ በመጫን ላይ')}/>:text('Log in','ይግቡ'))}</strong></div>
   <p className={reference.intro}>{text('Add funds for your next bid.','ለሚቀጥለው ጨረታዎ ገንዘብ ያስገቡ።')}</p>
   <label className={reference.amountLabel} htmlFor={`${id}-amount`}>{text('Amount to add','የሚያስገቡት መጠን')}</label>
   <div className={reference.amountField}><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" maxLength={19} value={amount} placeholder="0.00" aria-invalid={!!amount&&!!settings&&!valid||undefined} disabled={busy} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setAmount(event.target.value);reportError('')}}}/><span aria-hidden="true">ETB</span></div>
   <p className={reference.hint}>{settings?text(`Minimum ${formatEtb(settings.minTopup)}.`,`ቢያንስ ${formatEtb(settings.minTopup)}።`):text('Loading top-up limits…','የመሙያ ገደቦች በመጫን ላይ…')}</p>
   <div className={reference.presets} aria-label={text('Suggested top-up amounts','የመሙያ መጠኖች')}>{presets.map(preset=><button key={preset} type="button" disabled={busy} aria-pressed={amount===preset} onClick={()=>{setAmount(preset);reportError('')}}>{formatEtb(preset).replace('ETB ','')} <span>ETB</span></button>)}</div>
   <DepositBonusCard policy={policy} amount={valid?total:undefined} compact/>
   <p className={reference.walletNote}><Info size={14} aria-hidden="true"/><span>{text('Wallet funds are for bidding. Withdrawals are not available.','የዋሌት ገንዘብ ለጨረታ ነው። ማውጣት አይቻልም።')}</span></p>
  </>:stage==='bonus'?<section className={reference.confirmation} data-bonus-minimum-confirmation><span className={reference.gift}><Gift size={26} aria-hidden="true"/></span><h3>{text(`${policy?.percent}% bonus starts at ${formatEtb(policy?.minAmount??'0')}`,`${policy?.percent}% ጉርሻ ከ ${formatEtb(policy?.minAmount??'0')} ይጀምራል`)}</h3><p>{text(`Your ${formatEtb(total)} deposit is below the bonus minimum. Continue with no bonus, or change the amount.`,`${formatEtb(total)} ከጉርሻ ዝቅተኛ መጠን በታች ነው። ያለ ጉርሻ ይቀጥሉ ወይም መጠኑን ይቀይሩ።`)}</p></section>:<>
   <div className={reference.paymentHeading}><div><h3>{text('Pay securely','በደህና ይክፈሉ')}</h3><p>{text('Choose how to add your funds.','ገንዘብ የሚያስገቡበትን መንገድ ይምረጡ።')}</p></div><button type="button" className={reference.edit} onClick={backToAmount}>{text('Edit','ያስተካክሉ')}</button></div>
   <dl className={reference.summary}><div><dt>{text('Deposit','የሚገባ ገንዘብ')}</dt><dd>{formatEtb(total)}</dd></div>{bonus.active&&<><div data-deposit-bonus-preview><dt>{text('Bidding bonus','የጨረታ ጉርሻ')}</dt><dd>+{formatEtb(bonus.bonusAmount)}</dd></div><div className={reference.total}><dt>{text('Total after credit','ከገባ በኋላ ጠቅላላ')}</dt><dd>{formatEtb(bonus.totalCredit)}</dd></div></>}</dl>
   {bonus.active&&etbToCents(bonus.bonusAmount)>0n&&<p className={reference.bonusNote}>{text(`Bonus is valid for ${policy!.validityDays} days after verified credit.`,`ጉርሻው ክፍያው ከተረጋገጠ በኋላ ለ ${policy!.validityDays} ቀናት ይቆያል።`)}</p>}
   <ReferencePaymentMethods name={`${id}-method`} method={method||null} onChange={value=>{setMethod(value);reportError('')}} available={methodsFor(settings).map(item=>item.slug)} allowed={allowed} disabled={busy}>
    <div className={reference.phone} data-payment-phone><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={reference.phoneField}><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} value={phone} disabled={busy} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);reportError('')}} aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-help`}/></div><p className={reference.hint} id={`${id}-phone-help`}>{text('Use the number registered with your provider.','በክፍያ አቅራቢዎ የተመዘገበውን ቁጥር ይጠቀሙ።')}</p></div>
   </ReferencePaymentMethods>
  </>}
  {(methods.error||settings&&!settings.enabled)&&<p className={reference.error} role="status">{text('Top-up methods are unavailable.','የመሙያ መንገዶች አይገኙም።')} <button type="button" onClick={methods.reload}>{text('Retry','እንደገና')}</button></p>}
  {error&&<p className={reference.error} role="alert">{error}</p>}
  {settings?.mode==='test'&&<p className={reference.hint}>{text('Test mode · no real money.','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይከፈልም።')}</p>}
  {onClose?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
 </form>;
 const title=<span className={reference.title}><Wallet size={18} aria-hidden="true"/>{text('Add funds','ገንዘብ ያስገቡ')}</span>;
 return embedded?contents:onClose?<AccountSheet size="payment" layout="topup-reference" title={progressVisible?text('Payment','ክፍያ'):title} onBack={back??undefined} onClose={onClose} returnFocusRef={returnFocusRef} footerPortal>{contents}</AccountSheet>:<section className={styles.page}><h1>{title}</h1>{contents}</section>;
}
export default function WalletTopUpSheet(props:Props&{onClose:()=>void}){const {queryIdentity}=useTelegram();return <TopUp key={`${queryIdentity??'guest'}:${props.initialChapaId??''}`} {...props}/>}
export function WalletTopUpPage(){const {queryIdentity}=useTelegram();return <TopUp key={queryIdentity??'guest'}/>}
