'use client';
import Link from 'next/link';
import {Plus} from 'lucide-react';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniPhrase} from '@/components/mini-locale';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from '@/components/account-pages.module.css';

export default function Wallet(){
 const query=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000,pollMs:60000}),data=query.data;
 return <section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Wallet" am="ዋሌት"/></h1><p><MiniPhrase en="Your account balance." am="የመለያዎ ቀሪ ሂሳብ።"/></p></header><PrivateState query={query}/>{data&&<><section className={styles.panel}><h2><MiniPhrase en="Available balance" am="ያለዎት ቀሪ ሂሳብ"/></h2><p className={styles.receiptNumber} style={{width:'auto',borderRadius:12}}>{centsToEtb(etbToCents(data.available))} ETB</p>{etbToCents(data.held)>0n&&<p className={styles.caption}><MiniPhrase en="Held under existing auction terms:" am="በነባር የጨረታ ውሎች መሠረት የተያዘ፦"/> {centsToEtb(etbToCents(data.held))} ETB</p>}<Link className={styles.action} href="/wallet/deposit"><Plus size={16}/><MiniPhrase en="Deposit" am="ገንዘብ ያስገቡ"/></Link></section><Link className={styles.action} href="/payments"><MiniPhrase en="Bid payment history" am="የጨረታ ክፍያ ታሪክ"/></Link></>}</section>;
}
