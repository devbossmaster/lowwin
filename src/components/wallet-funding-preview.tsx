'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {PageLoading} from './loading-spinner';
import Link from 'next/link';
import {useState} from 'react';
import {Upload,ArrowUpRight} from 'lucide-react';
import {usePrivateQuery} from './private-query';
import {PaymentAccounts,type PaymentAccount} from './payment-accounts';
import styles from './wallet-page.module.css';

export function WalletFundingPreview(){const w=useWalletCopy();
 const {data,error,reload,status}=usePrivateQuery<{enabled:boolean;accounts:PaymentAccount[]}>('/api/wallet/preview');
 const [selected,setSelected]=useState<string|null>(null);
 const account=data?.accounts.find(item=>item.id===selected);
 return <section className={styles.funding} id="add-etb">
  <h2>{w("Add money")}</h2>{status==='authenticated'&&!data&&!error&&<PageLoading/>}
  <PaymentAccounts accounts={data?.accounts??[]} selected={selected} onSelect={setSelected} preview/>
  {error&&<p className={styles.error} role="alert">{w("Account details could not load.")}<button type="button" onClick={reload}>{w("Retry")}</button></p>}
  {account&&<div className={styles.confirmation}>
   <div className={styles.sectionHeading}><h3>{w("Payment confirmation")}</h3><span>{w("Paste message or upload")}</span></div>
   <label className={styles.fieldLabel} htmlFor="payment-reference">{w("Telebirr or CBE message/link")}</label>
   <textarea className={styles.textarea} id="payment-reference" disabled placeholder={w("Paste the payment SMS, including its receipt link")} aria-describedby="verification-disabled"/>
   <div className={styles.divider}>{w("Or upload a screenshot")}</div>
   <label className={styles.upload} aria-disabled="true"><Upload size={23}/><strong>{w("Upload receipt image")}</strong><span>{w("JPEG, PNG or WebP · up to 5 MB")}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled aria-label={w("Upload receipt image")}/></label>
   <button type="button" className={styles.submit} disabled>{w("Submit deposit")}</button>
   <p id="verification-disabled" className={styles.footnote}>{w("Deposits are unavailable. Do not send money.")}</p>
  </div>}
  <Link className={styles.help} href="/profile/support">{w("Need help with a payment?")}<ArrowUpRight size={16}/></Link>
 </section>;
}
