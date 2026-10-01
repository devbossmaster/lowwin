'use client';
import Link from 'next/link';
import {ChevronRight,MessageCircle} from 'lucide-react';
import {useWalletCopy} from './wallet-copy';
import styles from './wallet-page.module.css';

export function PaymentHelp(){const w=useWalletCopy();return <Link className={styles.help} href="/profile/support"><span className={styles.helpIcon}><MessageCircle size={20}/></span><span><strong>{w('Need help with a payment?')}</strong><small>{w('Contact Lowwin support')}</small></span><ChevronRight size={20}/></Link>}
