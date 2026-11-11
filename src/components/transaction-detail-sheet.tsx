'use client';
import {useCallback,useState,type RefObject} from 'react';
import dynamic from 'next/dynamic';
import {Check,Clock3,Copy,LoaderCircle,ShieldCheck,TriangleAlert} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import {useChapaPayment} from './chapa-payment';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {getMiniQueryClient} from './private-query-cache';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import {clearChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {clearHostedChapaAttempt} from '@/lib/chapa-hosted-attempt';
import type {BidSheetPhase} from './bid-sheet';
import {chapaConfirmed,chapaCheckoutUrl,type ChapaCheckoutView} from '@/lib/chapa-client';
import {bidPaymentCanRetry,maskedBidPaymentPhone} from '@/lib/bid-payment-progress';
import {chapaPaymentReasonMessage} from '@/lib/chapa-payment-reason';
import {paymentSummaryLabel,paymentSummaryState} from '@/lib/payment-summary';
import {formatEtb} from '@/lib/money';
import type {TransactionRow,WalletTransactionDetail} from '@/lib/transactions';
import styles from './transactions-page.module.css';
const DirectCheckout=dynamic(()=>import('./direct-checkout'),{ssr:false});
const TopUp=dynamic(()=>import('./wallet-top-up'),{ssr:false});
const BidRetry=dynamic(()=>import('./transaction-bid-retry'),{ssr:false});
type Props={row:TransactionRow;trigger:RefObject<HTMLElement|null>;onClose:()=>void};
export default function TransactionDetails(props:Props){return props.row.source==='chapa'?<ChapaDetails {...props}/>:<WalletDetails {...props}/>}
function ChapaDetails({row,trigger,onClose}:Props){
 const {language}=useMiniLocale(),am=language==='am',t=(en:string,a:string)=>am?a:en,payment=useChapaPayment('transaction:'+row.id,row.id),order=payment.order;
 const [continuing,setContinuing]=useState(false),[retrying,setRetrying]=useState(false),[copied,setCopied]=useState(false);
 const {queryIdentity}=useTelegram(),[retryOrder,setRetryOrder]=useState<ChapaCheckoutView|null>(null),[phase,setPhase]=useState<BidSheetPhase>('review'),[back,setBack]=useState<(()=>void)|null>(null),setDismiss=useCallback((action:(()=>void)|null)=>{setBack(()=>action)},[]);
 const topUpProgress=useCallback((active:boolean)=>setPhase(active?'payment':'review'),[]);
 const draft=retryOrder&&queryIdentity?readPaymentRetryDraft(getMiniQueryClient(),queryIdentity,retryOrder.id):null;
 const summary=order?paymentSummaryState({completed:chapaConfirmed(order),providerStatus:order.providerStatus,verificationState:order.verificationState}):row.summary;
 const retryable=!!order&&bidPaymentCanRetry(order)&&(summary==='failed'||order.reason==='INITIALIZATION_REJECTED');
 async function retry(){if(!retryable||retrying||payment.busy)return;setRetrying(true);try{const current=await payment.check();if(current&&bidPaymentCanRetry(current)&&(current.verificationState==='VERIFIED'||current.reason==='INITIALIZATION_REJECTED')){if(queryIdentity){const scope=current.purpose==='TOP_UP'?'topup':'bid:'+current.auctionSlug;clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,{orderId:current.id});clearHostedChapaAttempt(getMiniQueryClient(),queryIdentity,scope,{orderId:current.id})}setRetryOrder(current)}}finally{setRetrying(false)}}
 const reference=order?.merchantReference??order?.id,phone=maskedBidPaymentPhone(order?.payerPhoneMasked),hosted=order&&!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status)&&Date.parse(order.expiresAt)>Date.now()?chapaCheckoutUrl(order.checkoutUrl,order.apiVersion):null;
 const reason=order?chapaPaymentReasonMessage(order,am):null;
 return <AccountSheet size="payment" title={retryOrder?t(retryOrder.purpose==='TOP_UP'?'Top up wallet':'Payment',retryOrder.purpose==='TOP_UP'?'ገንዘብ ያስገቡ':'ክፍያ'):t('Transaction details','የግብይት ዝርዝር')} onClose={onClose} onBack={back??undefined} returnFocusRef={trigger} footerPortal={!!retryOrder} layout={retryOrder?.purpose==='BID'?'bid-entry':undefined}>
  {retryOrder?.purpose==='TOP_UP'?<TopUp embedded onClose={onClose} onDismissChange={setDismiss} onProgressChange={topUpProgress} retryDraft={{amount:retryOrder.amount,paymentMethod:retryOrder.paymentMethod??'',phone:draft?.phone??''}}/>:retryOrder?.purpose==='BID'?<BidRetry embedded order={retryOrder} draft={draft} onClose={onClose} onPhaseChange={setPhase} onDismissChange={setDismiss}/>:continuing&&order?.chargeType==='DIRECT'?<DirectCheckout payment={payment} purpose={order.purpose} amount={order.amount} batch={order.batch??undefined} onClose={onClose}/>:<div className={styles.detail} data-transaction-detail>
   <div className={styles.detailHero} data-summary={summary}><span className={styles.detailIcon}>{summary==='done'?<Check size={23}/>:summary==='failed'?<TriangleAlert size={23}/>:<Clock3 size={23}/>}</span><p>{row.type==='TOP_UP'?t('Wallet top-up','የዋሌት ገቢ'):t('Bid submission fee','የጨረታ ማቅረቢያ ክፍያ')}</p><strong>{formatEtb(order?.amount??row.amount)}</strong><span className={styles.detailStatus}>{paymentSummaryLabel(summary,am)}</span></div>
   {(order?.mode??row.mode)==='test'&&<p className={styles.testMode}>{t('Test payment · no live funds','የሙከራ ክፍያ · እውነተኛ ገንዘብ አይደለም')}</p>}
   <dl className={styles.information}>
    <Info label={t('Amount','መጠን')} value={formatEtb(order?.amount??row.amount)}/>
    <Info label={t('Payment method','የክፍያ መንገድ')} value={order?.paymentMethod??row.paymentMethod??'—'}/>
    <Info label={t('Gateway','የክፍያ መተላለፊያ')} value="Chapa"/>
    {phone&&<Info label={t('Payment phone','የክፍያ ስልክ')} value={phone}/>}
    {order?.purpose==='BID'&&<Info label={t('Auction','ጨረታ')} value={(am?order.auctionTitleAm||order.auctionTitle:order.auctionTitle)||row.title}/>}
    <Info label={t('Created','የተጀመረበት')} value={formatDate(order?.createdAt??row.createdAt,am)}/>
    {order?.updatedAt&&<Info label={t('Updated','የታደሰበት')} value={formatDate(order.updatedAt,am)}/>}
    {order?.fundsPreserved&&<Info label={t('Saved to wallet','በዋሌት የተቀመጠ')} value={formatEtb(order.amount)}/>}
    {reference&&<Info label={t('Reference','ማጣቀሻ')} value={<button className={styles.copy} type="button" aria-label={t('Copy reference','ማጣቀሻውን ቅዳ')} onClick={()=>void navigator.clipboard.writeText(reference).then(()=>setCopied(true)).catch(()=>setCopied(false))}><span>{reference}</span>{copied?<Check size={16}/>:<Copy size={16}/>}</button>}/>}
   </dl>
   {reason&&<p className={styles.failure} role="status"><TriangleAlert size={16}/>{reason}</p>}
   {summary==='checking'&&<p className={styles.notice}>{t(order?.providerStatus==='SUCCESS'?'Payment is verified. Lowwin is completing the bid record.':'This payment is not confirmed yet. Check its status before paying again.',order?.providerStatus==='SUCCESS'?'ክፍያው ተረጋግጧል። የጨረታ መዝገቡ በመጠናቀቅ ላይ ነው።':'ይህ ክፍያ ገና አልተረጋገጠም። እንደገና ከመክፈልዎ በፊት ሁኔታውን ያረጋግጡ።')}</p>}
   {order?.fundsPreserved&&<p className={styles.notice}>{t('The bid was not accepted. The verified payment was saved to your wallet.','ጨረታው አልተቀበለም። የተረጋገጠው ክፍያ በዋሌትዎ ተቀምጧል።')}</p>}
   {payment.error&&<p className={styles.failure} role="status"><TriangleAlert size={16}/>{payment.error}</p>}
   <div className={styles.detailActions}>
    {retryable?<button type="button" className={styles.primary} onClick={()=>void retry()} disabled={retrying||payment.busy}>{retrying?<LoaderCircle size={17} className={styles.spin}/>:null}{t(retrying?'Checking payment…':'Try again',retrying?'ክፍያው በማረጋገጥ ላይ…':'እንደገና ይሞክሩ')}</button>:summary==='checking'?<button type="button" className={styles.primary} onClick={()=>void payment.check()} disabled={payment.busy||payment.restoring}>{payment.busy||payment.restoring?<LoaderCircle size={17} className={styles.spin}/>:null}{t('Check payment','ክፍያውን ያረጋግጡ')}</button>:null}
    {summary==='checking'&&order?.chargeType==='DIRECT'&&order.authorizationReference&&order.authType==='OTP'&&<button type="button" className={styles.secondary} onClick={()=>setContinuing(true)}>{t('Continue authorization','ፈቃዱን ይቀጥሉ')}</button>}
    {hosted&&<a className={styles.secondary} href={hosted} target="_blank" rel="noopener noreferrer">{t('Continue original checkout','የመጀመሪያውን ክፍያ ይቀጥሉ')}</a>}
    <button type="button" className={summary==='done'?styles.primary:styles.secondary} onClick={onClose}>{t(summary==='done'?'Done':'Close',summary==='done'?'ተጠናቋል':'ዝጋ')}</button>
   </div><p className={styles.security}><ShieldCheck size={14}/>{t('Payment status verified by Lowwin','የክፍያ ሁኔታ በLowwin ይረጋገጣል')}</p>
  </div>}
 </AccountSheet>;
}
function WalletDetails({row,trigger,onClose}:Props){
 const {language}=useMiniLocale(),am=language==='am',t=(en:string,a:string)=>am?a:en,query=usePrivateQuery<WalletTransactionDetail>(`/api/transactions/wallet/${row.id}`),item=query.data?.item;
 const [copied,setCopied]=useState(false);
 return <AccountSheet size="payment" title={t('Transaction details','የግብይት ዝርዝር')} onClose={onClose} returnFocusRef={trigger}><div className={styles.detail}>
  <div className={styles.detailHero} data-summary="done"><span className={styles.detailIcon}><Check size={23}/></span><p>{t('Bid submission fee','የጨረታ ማቅረቢያ ክፍያ')}</p><strong>{formatEtb(row.amount)}</strong><span className={styles.detailStatus}>{t('Done','ተጠናቋል')}</span></div>
  <dl className={styles.information}><Info label={t('Amount','መጠን')} value={formatEtb(item?.amount??row.amount)}/><Info label={t('Payment method','የክፍያ መንገድ')} value={t('Lowwin Wallet','Lowwin ዋሌት')}/><Info label={t('Auction','ጨረታ')} value={am?row.titleAm||row.title:row.title}/>{item&&<Info label={t('Chosen number','የተመረጠ ቁጥር')} value={item.bidNumber}/>}<Info label={t('Created','የተጀመረበት')} value={formatDate(row.createdAt,am)}/>{item&&item.discountPoints!=='0'&&<><Info label={t('Submission fee','የማቅረቢያ ክፍያ')} value={formatEtb(item.grossFee)}/><Info label={t('Coupon discount','የኩፖን ቅናሽ')} value={formatEtb(item.discountPoints)}/></>}{item&&<Info label={t('Reference','ማጣቀሻ')} value={<button className={styles.copy} type="button" aria-label={t('Copy reference','ማጣቀሻውን ቅዳ')} onClick={()=>void navigator.clipboard.writeText(item.references.journalId).then(()=>setCopied(true))}><span>{item.references.journalId}</span>{copied?<Check size={16}/>:<Copy size={16}/>}</button>}/>}</dl>
  {query.error&&<p className={styles.notice}>{t('Extra details could not load.','ተጨማሪ ዝርዝሩን ማምጣት አልተቻለም።')} <button type="button" onClick={query.reload}>{t('Retry','እንደገና')}</button></p>}
  <button type="button" className={styles.primary} onClick={onClose}>{t('Done','ተጠናቋል')}</button>
 </div></AccountSheet>;
}
function Info({label,value}:{label:string;value:React.ReactNode}){return <div><dt>{label}</dt><dd>{value}</dd></div>}
function formatDate(value:string,am:boolean){return new Intl.DateTimeFormat(am?'am-ET':'en-GB',{timeZone:'Africa/Addis_Ababa',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
