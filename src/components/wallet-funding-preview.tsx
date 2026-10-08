'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useState} from 'react';
import {usePrivateQuery} from './private-query';
import {PaymentAccounts,type PaymentAccount} from './payment-accounts';
import {ReceiptImageUpload} from './receipt-image-upload';
import {PaymentHelp} from './payment-help';
import {WalletFundingSkeleton} from './wallet-funding-skeleton';
import styles from './wallet-page.module.css';

export function WalletFundingPreview(){const w=useWalletCopy();
 const {data,error,reload,status}=usePrivateQuery<{enabled:boolean;accounts:PaymentAccount[]}>('/api/wallet/preview');
 const [selected,setSelected]=useState<string|null>(null);
 const account=data?.accounts.find(item=>item.id===selected);
 const waiting=status==='loading'||status==='authenticated'&&!data&&!error;
 return <section className={styles.funding} id="add-etb">
  <h2>{w("Add money")}</h2>
  {waiting?<WalletFundingSkeleton variant="preview"/>:<>
   <PaymentAccounts accounts={data?.accounts??[]} selected={selected} onSelect={setSelected} preview/>
   {error&&<p className={styles.error} role="alert">{w("Account details could not load.")}<button type="button" onClick={reload}>{w("Retry")}</button></p>}
   {!account&&!error&&<p className={styles.selectionHint}>{w(data?.enabled?'Choose Telebirr, CBE or M-Pesa to add money.':'Deposits are unavailable. Do not send money.')}</p>}
   {account&&<div className={styles.confirmation}>
    <div className={styles.sectionHeading}><h3>{w("Payment confirmation")}</h3><span>{w("Paste message or upload")}</span></div>
    <label className={styles.fieldLabel} htmlFor="payment-reference">{w("Payment SMS or receipt link")}</label>
    <textarea className={styles.textarea} id="payment-reference" disabled placeholder={w("Paste the payment SMS, including its receipt link")} aria-describedby="verification-disabled"/>
    <div className={styles.divider}>{w("Or upload a screenshot")}</div>
    <ReceiptImageUpload disabled/>
    <button type="button" className={styles.submit} disabled>{w("Submit deposit")}</button>
    <p id="verification-disabled" className={styles.footnote}>{w("Deposits are unavailable. Do not send money.")}</p>
   </div>}
  </>}
  <PaymentHelp/>
 </section>;
}
