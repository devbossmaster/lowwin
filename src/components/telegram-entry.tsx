'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {ContactGate} from './contact-gate';
import {LaunchSplash} from './launch-splash';
import {RotateCcw,ArrowUpRight} from 'lucide-react';
import {Button} from './ui/button';
import styles from './telegram-entry.module.css';
export function TelegramEntry({onComplete}:{onComplete?:()=>void}={}){
  const pathname=usePathname();
  const {status,botUrl,error,retry}=useTelegram();
  const telegramLaunch=typeof window!=='undefined'&&Boolean(window.Telegram?.WebApp?.initData);
  useEffect(()=>{
    if(status!=='authenticated'||!telegramLaunch)return;
    // Keep the verified splash visible for a painted frame before opening Home.
    let frame=0,paintFrame=0;
    frame=window.requestAnimationFrame(()=>{paintFrame=window.requestAnimationFrame(()=>{
      if(pathname==='/telegram'){
        window.location.replace('/'+window.location.hash);
      }else onComplete?.();
    })});
    return()=>{window.cancelAnimationFrame(frame);window.cancelAnimationFrame(paintFrame)};
  },[status,telegramLaunch,pathname,onComplete]);
  if(status==='contact-required')return <ContactGate/>;
  if(status==='loading'||(status==='authenticated'&&telegramLaunch))return <LaunchSplash complete={status==='authenticated'}/>;
  return <main id="main" className={`telegram-entry ${styles.screen}`}>
    <img src="/logo.png" alt="Lowwin" width={112} height={112} className={styles.logo}/>
    <h1>{error?'Let’s try again':'Open Lowwin'}</h1>
    <p role={error?'alert':undefined}>{error||'Continue through our Telegram bot.'}</p>
    <div className={styles.actions}>
      {error&&<Button onClick={retry} className={styles.retry}><RotateCcw size={17} aria-hidden="true"/>Retry connection</Button>}
      {botUrl?<Button asChild variant="outline" className={error?styles.bot:styles.retry}><a href={botUrl}>{error?'Reopen from the bot':'Continue with the bot'}<ArrowUpRight size={17} aria-hidden="true"/></a></Button>:<p role="status">The bot is unavailable. Please try again later.</p>}
    </div>
  </main>;
}
