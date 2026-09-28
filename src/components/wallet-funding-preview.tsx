'use client';
import Link from 'next/link';
import {useState} from 'react';
import {Upload,ArrowUpRight} from 'lucide-react';
import {usePrivateQuery} from './private-query';
import {PaymentAccounts,type PaymentAccount} from './payment-accounts';
import styles from './wallet-page.module.css';

export function WalletFundingPreview(){
 const {data,error,reload}=usePrivateQuery<{enabled:boolean;accounts:PaymentAccount[]}>('/api/wallet/preview');
 const [selected,setSelected]=useState<string|null>(null);
 return <section className={styles.funding} id="add-etb">
  <h2>Add money</h2>
  <PaymentAccounts accounts={data?.accounts??[]} selected={selected} onSelect={setSelected} preview/>
  {error&&<p className={styles.error} role="alert">Account details could not load.<button type="button" onClick={reload}>Retry</button></p>}
  <div className={styles.confirmation}>
   <div className={styles.sectionHeading}><h3>Payment confirmation</h3><span>Paste message or upload</span></div>
   <label className={styles.fieldLabel} htmlFor="payment-reference">Telebirr or CBE message/link</label>
   <textarea className={styles.textarea} id="payment-reference" disabled placeholder="Paste the payment SMS, including its receipt link" aria-describedby="verification-disabled"/>
   <div className={styles.divider}>Or upload a screenshot</div>
   <label className={styles.upload} aria-disabled="true"><Upload size={23}/><strong>Upload receipt image</strong><span>JPEG, PNG or WebP · up to 5 MB</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled aria-label="Upload receipt image"/></label>
   <button type="button" className={styles.submit} disabled>Submit deposit</button>
   <p id="verification-disabled" className={styles.footnote}>Deposits are unavailable. Do not send money.</p>
  </div>
  <Link className={styles.help} href="/profile/support">Need help with a payment?<ArrowUpRight size={16}/></Link>
 </section>;
}
