import {Send} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './telegram-support-link.module.css';

export function TelegramSupportLink(){
 return <a className={styles.link} href="https://t.me/lowwinsupport" target="_blank" rel="noreferrer" aria-label="Chat with Lowwin support on Telegram" title="@lowwinsupport"><Send size={24} aria-hidden="true"/><span className="sr-only"><MiniPhrase en="Chat with Lowwin support" am="የLowwin ድጋፍን በቴሌግራም ያነጋግሩ"/></span></a>;
}
