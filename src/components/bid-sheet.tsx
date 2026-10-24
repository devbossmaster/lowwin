'use client';
import Link from 'next/link';
import {useId,useMemo,useState} from 'react';
import {ChevronDown,Clock3,CreditCard,Plus,Ticket,Wallet} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {AccountSheet} from './account-sheet';
import {AuctionCountdown} from './auction-countdown';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {usePrivateQuery,PrivateState} from './private-query';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import styles from './bid-payment-sheet.module.css';
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>;
export default function BidSheet({auction,serverNow,onClose}:{auction:CatalogAuction;serverNow:string;onClose:()=>void}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const query=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`),wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const [number,setNumber]=useState(''),[method,setMethod]=useState<'wallet'|'chapa'>('wallet'),id=useId(),state=query.data;
 const title=am?(auction.product.titleAm||auction.product.title):auction.product.title,description=am?(auction.product.descriptionAm||auction.product.description):auction.product.description;
 const preview=useMemo(()=>{if(!state||!number||!/^\d{1,16}(?:\.\d{1,2})?$/.test(number))return null;try{const value=etbToCents(number),min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);if(value<min||max!==null&&value>max||step<=0n||(value-min)%step!==0n)return null;return {duplicate:state.ownBids.some(b=>etbToCents(b.amount)===value),consecutive:createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),value)}}catch{return null}},[state,number]);
 let balance:string|null=null,insufficient=false;try{if(wallet.data&&!wallet.error){balance=centsToEtb(etbToCents(wallet.data.available));insufficient=!!state&&etbToCents(wallet.data.available)<etbToCents(state.terms.entryFeePoints)}}catch{}
 if(query.status==='loading'||query.status==='authenticated'&&!state&&!query.error)return null;
 const fee=state?formatEtb(state.terms.entryFeePoints):'—',active=!!state?.open&&auction.status==='live',current=!!state&&isSubmissionFeeOnly(state.terms.ruleVersion);
 return <AccountSheet size="payment" title={<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>} onClose={onClose} footer={state&&active&&current?<><p className={styles.availability} role="status">{text('Payments are not available yet.','ክፍያዎች ገና አልተጀመሩም።')}</p><button className={styles.payButton} type="button" data-payment-action disabled><Ticket size={16} aria-hidden="true"/>{text(`Pay ${fee} ${method==='wallet'?'from Wallet':'with Chapa'}`,`${fee} ${method==='wallet'?'ከዋሌት':'በChapa'} ይክፈሉ`)}</button></>:undefined}>
  {(!state||query.error)&&<PrivateState query={query}/>}<div className={styles.productHeading}><span className={styles.status}>{text(active?'LIVE':auction.status==='upcoming'?'UPCOMING':'BIDDING CLOSED',active?'ክፍት':auction.status==='upcoming'?'የሚመጣ':'ጨረታው ተዘግቷል')}</span><h3 className={styles.productTitle}>{title}</h3></div>
  <details className={styles.description}><summary><span>{description}</span><b>{text('Auction details','የጨረታ ዝርዝሮች')}<ChevronDown size={13} aria-hidden="true"/></b></summary><p>{description}</p><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><small>{auction.terms.ruleVersion} · v{auction.terms.version}</small><p><Link href={`/auctions/${auction.code}`}>{text('Full auction details','ሙሉ የጨረታ ዝርዝሮች')}</Link></p></details>
  {state&&active&&current?<>
   <div className={styles.feeStrip}><div><small>{text('Submission fee','የማስገቢያ ክፍያ')}</small><strong>{fee}</strong></div><span className={styles.statChip}><Ticket size={13} aria-hidden="true"/>{auction.bidCount} {text('bids','ጨረታዎች')}</span><span className={styles.statChip}><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={auction.endsAt} serverNow={state.serverNow??serverNow} label="Ends" showLabel={false}/></span></div>
   <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid number','የጨረታ ቁጥርዎ')}</label><p className={styles.range}>{text('From','ከ')} {state.terms.minPoints}{state.terms.maxPoints!==null?` – ${state.terms.maxPoints}`:''} · {text('Step','ልዩነት')} {state.terms.stepPoints}</p></div><div className={styles.amountInput}><span aria-hidden="true">#</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} value={number} onChange={event=>setNumber(event.target.value)} placeholder={text('Enter your bid number','የጨረታ ቁጥርዎን ያስገቡ')} aria-describedby={`${id}-rules`}/></div>
   <p className={styles.remaining}>{state.remainingSubmissions} {text('submissions left','ቀሪ ጨረታዎች')}</p>
   {number&&!preview&&<p className={styles.error}>{text('Choose a number within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ ቁጥር ይምረጡ።')}</p>}{preview?.duplicate&&<p className={styles.error}>{text('You already submitted this number.','ይህን ቁጥር አስቀድመው አቅርበዋል።')}</p>}{preview?.consecutive&&<p className={styles.error}>{text('Leave a gap after three consecutive numbers.','ከሦስት ተከታታይ ቁጥሮች በኋላ ክፍተት ይተዉ።')}</p>}
   <fieldset className={styles.methods}><legend><CreditCard size={14} aria-hidden="true"/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.walletRow}><label className={`${styles.method} ${method==='wallet'?styles.selected:''}`}><span className={styles.methodIcon}><Wallet size={20} aria-hidden="true"/></span><span className={styles.methodText}><strong>{text('Wallet','ዋሌት')}</strong><small>{balance!==null?`${balance} ETB`:text('Balance unavailable','ቀሪ ሂሳቡ አይገኝም')}</small></span><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} onChange={()=>setMethod('wallet')} aria-label={text('Wallet balance','የዋሌት ቀሪ ሂሳብ')}/></label><WalletTopUpTrigger className={styles.topUpLink} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={16} aria-hidden="true"/>{text('Top up','ገንዘብ ያስገቡ')}</WalletTopUpTrigger></div><label className={`${styles.method} ${method==='chapa'?styles.selected:''}`}><span className={styles.methodIcon}><CreditCard size={20} aria-hidden="true"/></span><span className={styles.methodText}><strong>Chapa</strong><small>{text('Pay through Chapa checkout','በChapa በኩል ይክፈሉ')}</small></span><input type="radio" name={`${id}-method`} value="chapa" checked={method==='chapa'} onChange={()=>setMethod('chapa')} aria-label="Chapa"/></label></fieldset>
   {method==='wallet'&&insufficient&&<p className={styles.error}>{text('Your balance is below this submission fee. Top-ups are not available yet.','ያለዎት ቀሪ ሂሳብ ከማስገቢያ ክፍያው ያነሰ ነው። ገንዘብ ማስገባት ገና አልተጀመረም።')}</p>}
   <p className={styles.hint} id={`${id}-rules`}>{text('Your number is not money. Only the disclosed submission fee is paid; it is non-refundable.','የመረጡት ቁጥር ገንዘብ አይደለም። የሚከፈለው የተገለጸው የማስገቢያ ክፍያ ብቻ ሲሆን ተመላሽ አይሆንም።')}</p>
  </>:state&&<p className={styles.availability}>{text(!active?'This auction is not open for bids.':'New entries are unavailable for this older auction. Its published terms remain unchanged.',!active?'ይህ ጨረታ ለጨረታ ክፍት አይደለም።':'ለዚህ የቆየ ጨረታ አዲስ ጨረታ ማቅረብ አይቻልም። የታተሙ ውሎቹ አልተለወጡም።')}</p>}
  <div className={styles.links}><Link href="/terms">{text('Terms','ውሎች')}</Link><Link href="/privacy">{text('Privacy','ግላዊነት')}</Link></div>
 </AccountSheet>;
}
