import styles from './hosted-payment-logos.module.css';

/** One hosted-checkout option; the provider is still Chapa. */
export function HostedPaymentLogos(){
 return <span className={styles.logos} role="img" aria-label="telebirr, M-Pesa and CBE Birr">
  <img src="/icons/payments/telebirr.jpg" alt="" width={28} height={28} decoding="async"/>
  <img src="/icons/payments/mpesa.png" alt="" width={48} height={24} decoding="async"/>
  <img src="/icons/payments/cbebirr.svg" alt="" width={34} height={26} decoding="async"/>
 </span>;
}
