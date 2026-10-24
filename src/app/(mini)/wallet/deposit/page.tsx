'use client';
import Link from 'next/link';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniPhrase} from '@/components/mini-locale';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from '@/components/account-pages.module.css';

export default function Deposit(){
 const query=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 return <section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Deposit" am="ገንዘብ ያስገቡ"/></h1></header><PrivateState query={query}/>{query.data&&<section className={styles.panel}><h2><MiniPhrase en="Top-ups are coming soon" am="ገንዘብ ማስገባት በቅርቡ ይጀምራል"/></h2><p className={styles.caption}><MiniPhrase en="Wallet top-ups will be available after the Chapa connection is ready. No payment can be started here yet." am="የChapa ግንኙነት ሲዘጋጅ ገንዘብ ማስገባት ይቻላል። አሁን እዚህ ክፍያ መጀመር አይቻልም።"/></p><button className={styles.action} disabled><MiniPhrase en="Top-ups unavailable" am="ገንዘብ ማስገባት አልተጀመረም"/></button><Link className={styles.action} href="/wallet"><MiniPhrase en="Back to Wallet" am="ወደ ዋሌት ይመለሱ"/></Link></section>}</section>;
}
