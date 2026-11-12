'use client';
import type {ReactNode} from 'react';
import {Check,CreditCard,Wallet} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import styles from './reference-payment-methods.module.css';

export const referencePaymentProviders=[
 {slug:'telebirr',name:'telebirr',image:'/icons/payments/telebirr.jpg'},
 {slug:'cbebirr',name:'CBE Birr',image:'/icons/payments/cbebirr.svg'},
 {slug:'mpesa',name:'M-Pesa',image:'/icons/payments/mpesa.png'},
] as const;
type Props={name:string;method:string|null;onChange:(method:string)=>void;allowed:(method:string)=>boolean;disabled?:boolean;wallet?:{enabled:boolean};children?:ReactNode};

/** Shared presentation only. A selection never initializes a payment. */
export function ReferencePaymentMethods({name,method,onChange,allowed,disabled=false,wallet,children}:Props){
 const {language}=useMiniLocale(),am=language==='am';
 return <fieldset className={styles.methods} disabled={disabled} data-chapa-methods data-wallet-methods>
  <legend><CreditCard size={13} aria-hidden="true"/>{am?'የክፍያ መንገድ ይምረጡ':'Select payment method'}</legend>
  {children&&<div className={styles.details}>{children}</div>}
  <div className={styles.grid}>
   {referencePaymentProviders.map(provider=><label key={provider.slug} className={styles.method} data-provider={provider.slug} data-selected={method===provider.slug} data-unavailable={!allowed(provider.slug)}><input type="radio" name={name} value={provider.slug} checked={method===provider.slug} disabled={!allowed(provider.slug)} onChange={()=>onChange(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={38} height={28}/><strong>{provider.name}</strong>{method===provider.slug&&<span className={styles.check}><Check size={10} strokeWidth={3} aria-hidden="true"/></span>}</label>)}
   {wallet&&<label className={styles.method} data-provider="wallet" data-selected={method==='wallet'} data-unavailable={!wallet.enabled}><input type="radio" name={name} value="wallet" checked={method==='wallet'} disabled={!wallet.enabled} onChange={()=>onChange('wallet')} aria-label="Lowwin Wallet"/><Wallet size={23} className={styles.walletIcon} aria-hidden="true"/><strong>{am?'Lowwin ዋሌት':'Lowwin Wallet'}</strong>{method==='wallet'&&<span className={styles.check}><Check size={10} strokeWidth={3} aria-hidden="true"/></span>}</label>}
  </div>
 </fieldset>;
}
