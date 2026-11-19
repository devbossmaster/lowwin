'use client';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {useState} from 'react';
import {RotateCcw,ArrowUpRight} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {Button} from './ui/button';
import {TelegramBotLink} from './telegram-bot-link';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './telegram-entry.module.css';

export default function TelegramEntryRecovery(){
  const {botUrl,environment,error,needsReopen,retry,status}=useTelegram();
  const {language}=useMiniLocale();
  const [handedOff,setHandedOff]=useState(false);
  const [reloading,setReloading]=useState(false);
  const reopen=needsReopen||(environment==='mini'&&status==='guest');
  const reconnect=!!error&&!reopen;
  const englishMessage=error||(reopen?'Open the bot, then tap Open Lowwin to start again.':'Continue through our Telegram bot.');
  const amharicMessage=reopen?'ቦቱን ይክፈቱ፣ ከዚያ Lowwinን ይክፈቱ የሚለውን ቁልፍ ይጫኑ።':
    reconnect?'ግንኙነቱ ተቋርጧል። እንደገና ይገናኙ።':'በTelegram ቦታችን ይቀጥሉ።';
  return <main id="main" className={`telegram-entry ${styles.screen}`} aria-labelledby="telegram-recovery-heading">
    <img src={LOWWIN_LOGO_SRC} data-lowwin-logo alt="Lowwin" width={112} height={112} className={styles.logo}/>
    <h1 id="telegram-recovery-heading"><MiniPhrase en={reopen?'Reopen Lowwin':reconnect?'Reconnect to Lowwin':'Open Lowwin'} am={reopen?'Lowwinን እንደገና ይክፈቱ':reconnect?'Lowwinን እንደገና ያገናኙ':'Lowwinን ይክፈቱ'}/></h1>
    <p role={error?'alert':undefined}>{language==='am'?amharicMessage:englishMessage}</p>
    <div className={styles.actions}>
      {reconnect&&<Button onClick={retry} disabled={reloading} className={styles.retry}><RotateCcw size={17} aria-hidden="true"/><MiniPhrase en="Retry connection" am="እንደገና ይገናኙ"/></Button>}
      {botUrl?<Button asChild variant="outline" className={reconnect?styles.bot:styles.retry}><TelegramBotLink href={botUrl} onHandoff={()=>setHandedOff(true)}><MiniPhrase en={reopen||reconnect?'Reopen from the bot':'Continue with the bot'} am={reopen||reconnect?'ከቦቱ እንደገና ይክፈቱ':'በቦቱ ይቀጥሉ'}/><ArrowUpRight size={17} aria-hidden="true"/></TelegramBotLink></Button>:<p role="status"><MiniPhrase en="The bot is unavailable. Please try again later." am="ቦቱ ለጊዜው አይገኝም። ቆይተው ይሞክሩ።"/></p>}
      {reconnect&&<Button variant="outline" className={styles.reload} disabled={reloading} onClick={()=>{setReloading(true);window.location.reload()}}><MiniPhrase en={reloading?'Reloading…':'Reload app'} am={reloading?'በመጫን ላይ…':'መተግበሪያውን ያድሱ'}/></Button>}
    </div>
    {handedOff&&<p role="status" className={styles.handoff}><MiniPhrase en="If this screen stays open, close it with the × at the top, then tap Open Lowwin in the bot." am="ይህ ገጽ ክፍት ከሆነ ከላይ ያለውን × ይጫኑ፤ ከዚያ ቦቱ ውስጥ Lowwinን ይክፈቱ።"/></p>}
  </main>;
}
