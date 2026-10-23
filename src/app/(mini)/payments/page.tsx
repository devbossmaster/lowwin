'use client';
import {PaymentHistory} from '@/components/payment-history';
import {MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import styles from '@/components/account-pages.module.css';

export default function Payments(){
 return <section className={styles.page}><OfflineRetry/><header className={styles.heading}><h1><MiniPhrase en="Bid payments" am="የጨረታ ክፍያዎች"/></h1><p><MiniPhrase en="Track your ArifPay requests and payment status." am="የArifPay ጥያቄዎችዎን እና የክፍያ ሁኔታን ይከታተሉ።"/></p></header><PaymentHistory/></section>;
}
