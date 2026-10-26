'use client';
import Link from 'next/link';
import {ShieldCheck} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {TelegramBotLink} from './telegram-bot-link';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import styles from './bid-payment-sheet.module.css';

function OwnedReturn({id}:{id:string}){const payment=useChapaPayment('return:'+id,id);return <ChapaPaymentStatus payment={payment}/>}
export function ChapaReturn({id}:{id:string|null}){
 const {status,queryIdentity,botUrl}=useTelegram(),{language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en;
 return <main id="main" className={styles.returnPage}><Link href="/" className={styles.returnBrand}><img src="/logo.png" alt="Lowwin" width={44} height={44}/><strong>Lowwin</strong></Link>
  {id&&status==='authenticated'&&queryIdentity?<OwnedReturn key={`${queryIdentity}:${id}`} id={id}/>:<section className={styles.paymentStatus}><div className={styles.paymentStatusIcon}><ShieldCheck size={24}/></div><h1>{text(id?'Return to Lowwin':'Payment link unavailable',id?'ወደ Lowwin ይመለሱ':'የክፍያ ማስፈንጠሪያው አይገኝም')}</h1><p>{text('Your payment is checked securely on our server. Open Lowwin in Telegram to view its verified status. This page does not confirm payment success.','ክፍያዎ በአገልጋያችን በደህንነት ይረጋገጣል። የተረጋገጠውን ሁኔታ ለማየት Lowwinን በTelegram ይክፈቱ። ይህ ገጽ የክፍያ ስኬትን አያረጋግጥም።')}</p>{botUrl?<TelegramBotLink className={styles.payButton} href={botUrl}>{text('Open Lowwin in Telegram','Lowwinን በTelegram ይክፈቱ')}</TelegramBotLink>:<Link className={styles.payButton} href="/telegram">{text('Open Lowwin','Lowwinን ይክፈቱ')}</Link>}</section>}
 </main>;
}
