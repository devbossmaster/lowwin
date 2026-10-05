'use client';
import {TelegramLink} from './telegram-link';
import {ChevronRight,MessageCircle} from 'lucide-react';
import {useWalletCopy} from './wallet-copy';
import styles from './wallet-page.module.css';

export function PaymentHelp(){const w=useWalletCopy();return <TelegramLink className={styles.help}><span className={styles.helpIcon}><MessageCircle size={20}/></span><span><strong>{w('Need help with a payment?')}</strong><small>{w('Contact Lowwin support')}</small></span><ChevronRight size={20}/></TelegramLink>}
