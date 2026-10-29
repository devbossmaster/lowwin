'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ShieldCheck} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {TelegramBotLink} from './telegram-bot-link';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {chapaBotReturnLink,chapaOriginPath,chapaReturnPath} from '@/lib/chapa-return-link';
import {returnChapaToBot} from '@/lib/chapa-navigation';
import {CustomerLoading} from './loading-spinner';
import styles from './bid-payment-sheet.module.css';

function OwnedReturn({id}:{id:string}){
 const payment=useChapaPayment('return:'+id,id),router=useRouter(),destination=payment.order?chapaOriginPath(payment.order):null;
 useEffect(()=>{if(destination)router.replace(destination,{scroll:false})},[destination,router]);
 return destination?<CustomerLoading compact en="Opening your payment…" am="ክፍያዎን በመክፈት ላይ…"/>:<ChapaPaymentStatus payment={payment}/>;
}
export function ChapaReturn({id}:{id:string|null}){
 const {status,queryIdentity,botUrl,verifyingTelegram}=useTelegram(),{language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en;
 const [insideMiniApp,setInsideMiniApp]=useState<boolean|null>(null),handoff=useRef<string|null>(null);
 useEffect(()=>{
  if(status==='loading'||verifyingTelegram)return;
  const inside=!!window.Telegram?.WebApp?.initData;setInsideMiniApp(inside);
  if(inside||!id||handoff.current===id)return;
  handoff.current=id;returnChapaToBot(botUrl,id);
 },[status,verifyingTelegram,botUrl,id]);
 const returnPath=chapaReturnPath(id),botReturn=chapaBotReturnLink(botUrl,id)??botUrl;
 return <main id="main" className={styles.returnPage}><Link href="/" className={styles.returnBrand}><img src="/logo.png" alt="Lowwin" width={44} height={44}/><strong>Lowwin</strong></Link>
  {id&&insideMiniApp&&status==='authenticated'&&queryIdentity?<OwnedReturn key={`${queryIdentity}:${id}`} id={id}/>:<section className={styles.paymentStatus}><div className={styles.paymentStatusIcon}><ShieldCheck size={24}/></div><h1>{text(id?'Return to Lowwin':'Payment link unavailable',id?'ወደ Lowwin ይመለሱ':'የክፍያ ማስፈንጠሪያው አይገኝም')}</h1><p>{text('Your payment is checked securely on our server. Open Lowwin in Telegram to view its verified status. This page does not confirm payment success.','ክፍያዎ በአገልጋያችን በደህንነት ይረጋገጣል። የተረጋገጠውን ሁኔታ ለማየት Lowwinን በTelegram ይክፈቱ። ይህ ገጽ የክፍያ ስኬትን አያረጋግጥም።')}</p>{botReturn?<TelegramBotLink className={styles.payButton} href={botReturn}>{text('Open Lowwin in Telegram','Lowwinን በTelegram ይክፈቱ')}</TelegramBotLink>:<Link className={styles.payButton} href={returnPath?'/telegram?next='+encodeURIComponent(returnPath):'/telegram'}>{text('Open Lowwin','Lowwinን ይክፈቱ')}</Link>}</section>}
 </main>;
}
