'use client';
import {useState} from 'react';
import {RotateCcw,ArrowUpRight} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {Button} from './ui/button';
import {TelegramBotLink} from './telegram-bot-link';
import styles from './telegram-entry.module.css';

export default function TelegramEntryRecovery(){
  const {botUrl,error,needsReopen,retry}=useTelegram();
  const [handedOff,setHandedOff]=useState(false);
  const [reloading,setReloading]=useState(false);
  return <main id="main" className={`telegram-entry ${styles.screen}`}>
    <img src="/logo.png?v=forest-1" alt="Lowwin" width={112} height={112} className={styles.logo}/>
    <h1>{needsReopen?'Reopen Lowwin':error?'Let’s try again':'Open Lowwin'}</h1>
    <p role={error?'alert':undefined}>{error||'Continue through our Telegram bot.'}</p>
    <div className={styles.actions}>
      {error&&!needsReopen&&<Button onClick={retry} disabled={reloading} className={styles.retry}><RotateCcw size={17} aria-hidden="true"/>Retry connection</Button>}
      {botUrl?<Button asChild variant="outline" className={error?styles.bot:styles.retry}><TelegramBotLink href={botUrl} onHandoff={()=>setHandedOff(true)}>{error?'Reopen from the bot':'Continue with the bot'}<ArrowUpRight size={17} aria-hidden="true"/></TelegramBotLink></Button>:<p role="status">The bot is unavailable. Please try again later.</p>}
      {error&&!needsReopen&&<Button variant="outline" className={styles.reload} disabled={reloading} onClick={()=>{setReloading(true);window.location.reload()}}>{reloading?'Reloading…':'Reload app'}</Button>}
    </div>
    {handedOff&&<p role="status" className={styles.handoff}>If this screen stays open, close it with the × at the top, then tap Open Lowwin in the bot.</p>}
  </main>;
}
