'use client';
import {NotificationsInbox} from '@/components/notifications-inbox';
import {MiniPhrase} from '@/components/mini-locale';
import styles from '@/components/account-pages.module.css';
export default function Alerts(){return <section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Notifications" am="ማሳወቂያዎች"/></h1><p><MiniPhrase en="Your auction and payment updates." am="የጨረታ እና የክፍያ መረጃዎችዎ።"/></p></header><NotificationsInbox/></section>}
