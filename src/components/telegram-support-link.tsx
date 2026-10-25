'use client';
import {useMiniLocale} from './mini-locale';
import {Headphones} from 'lucide-react';
import {TelegramLink} from './telegram-link';
import styles from './telegram-support-link.module.css';

export function TelegramSupportLink(){
 const {language}=useMiniLocale(),am=language==='am';
 return <TelegramLink className={styles.link} aria-label={am?'የLowwin ድጋፍን በቴሌግራም ያነጋግሩ':'Chat with Lowwin support on Telegram'} title="@lowwinsupport">
  <Headphones size={22} aria-hidden="true"/>
  <span className={styles.label}>{am?'ድጋፍ':'Support'}</span>
 </TelegramLink>;
}
