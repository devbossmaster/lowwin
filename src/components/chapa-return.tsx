'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowUpRight} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {TelegramBotLink} from './telegram-bot-link';
import {usePrivateQuery} from './private-query';
import type {ChapaCheckoutView} from '@/lib/chapa-client';
import {chapaBotReturnLink,chapaMiniAppReturnLink,chapaOriginPath,chapaReturnPath} from '@/lib/chapa-return-link';
import {returnChapaToBot} from '@/lib/chapa-navigation';
import {BrandedLaunchLoading} from './launch-splash';
import styles from './bid-payment-sheet.module.css';

function OwnedReturn({id}:{id:string}){
 // Only read ownership here. Verification belongs to the destination modal;
 // starting it before navigation duplicates reads and aborts its UI response.
 const query=usePrivateQuery<ChapaCheckoutView>(`/api/payments/chapa/checkouts/${id}`,{freshnessMs:5000}),router=useRouter();
 const destination=query.data?chapaOriginPath(query.data):null,{language}=useMiniLocale(),am=language==='am';
 useEffect(()=>{if(destination)router.replace(destination,{scroll:false})},[destination,router]);
 if(destination||!query.error&&!query.data)return <BrandedLaunchLoading/>;
 return <section className={styles.paymentStatus}><h1>{am?'ክፍያውን መክፈት አልተቻለም':'Could not open this payment'}</h1><p>{am?'በክፍያው የጀመሩበት መለያ ይግቡ።':'Use the same Lowwin account that started this checkout.'}</p><button type="button" className={styles.checkPayment} onClick={query.reload}>{am?'እንደገና ክፈት':'Try opening again'}</button><div className={styles.links}><Link href="/payments">{am?'ግብይቶች':'View Transactions'}</Link></div></section>;
}
export function ChapaReturn({id}:{id:string|null}){
 const {status,queryIdentity,botUrl,verifyingTelegram}=useTelegram(),{language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en;
 const [insideMiniApp,setInsideMiniApp]=useState<boolean|null>(null),[handoffWaiting,setHandoffWaiting]=useState(true),handoff=useRef<string|null>(null);
 useEffect(()=>{
  // An external browser needs no account lookup before its Telegram handoff.
  // Wait for SDK detection so a slow in-app SDK is not mistaken for a browser.
  if(!window.Telegram?.WebApp&&status==='loading')return;
  const inside=!!window.Telegram?.WebApp?.initData;setInsideMiniApp(inside);
  if(inside||!id||handoff.current===id)return;
  if(!botUrl)return;
  handoff.current=id;setHandoffWaiting(true);if(!returnChapaToBot(botUrl,id))setHandoffWaiting(false);
 },[status,verifyingTelegram,botUrl,id]);
 useEffect(()=>{
  if(!id||insideMiniApp!==false)return;
  const timer=setTimeout(()=>setHandoffWaiting(false),1500);
  return()=>clearTimeout(timer);
 },[id,insideMiniApp]);
 const returnPath=chapaReturnPath(id),botReturn=chapaBotReturnLink(botUrl,id)??botUrl,appReturn=chapaMiniAppReturnLink(botUrl,id)??botReturn;
 return <main id="main" className={styles.returnPage}>
  {id&&insideMiniApp&&status==='authenticated'&&queryIdentity?<OwnedReturn key={`${queryIdentity}:${id}`} id={id}/>:id&&(insideMiniApp===null||insideMiniApp&&(status==='loading'||verifyingTelegram)||insideMiniApp===false&&handoffWaiting)?<BrandedLaunchLoading/>:<section className={styles.paymentStatus}>
   <div className={styles.paymentStatusIcon}><ArrowUpRight size={24} aria-hidden="true"/></div>
   <h1>{text(id?'Back to your payment':'Payment link unavailable',id?'ወደ ክፍያዎ ይመለሱ':'የክፍያ ማስፈንጠሪያው አይገኝም')}</h1>
   <p>{text('Open Lowwin to see your top-up or bid. Your payment status updates automatically.','ገንዘብ ማስገባትዎን ወይም ጨረታዎን ለማየት Lowwinን ይክፈቱ። የክፍያ ሁኔታው በራሱ ይዘምናል።')}</p>
   {appReturn?<TelegramBotLink className={styles.payButton} href={appReturn}>{text('Open Lowwin','Lowwinን ይክፈቱ')}</TelegramBotLink>:<Link className={styles.payButton} href={returnPath?'/telegram?next='+encodeURIComponent(returnPath):'/telegram'}>{text('Open Lowwin','Lowwinን ይክፈቱ')}</Link>}
   {botReturn&&<div className={styles.links}><TelegramBotLink href={botReturn}>{text('Open through the bot','በቦቱ በኩል ይክፈቱ')}</TelegramBotLink></div>}
  </section>}
 </main>;
}
