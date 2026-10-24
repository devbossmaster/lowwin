'use client';
import {useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniReturnPath} from '@/lib/mini-return';
import {ContactGate} from './contact-gate';
import {LaunchSplash} from './launch-splash';
import {RotateCcw,ArrowUpRight} from 'lucide-react';
import {Button} from './ui/button';
import {TelegramBotLink} from './telegram-bot-link';
import styles from './telegram-entry.module.css';
export function TelegramEntry({onComplete}:{onComplete?:()=>void}={}){
  const pathname=usePathname(),router=useRouter();
  const {status,botUrl,error,needsReopen,retry}=useTelegram();
  const [handedOff,setHandedOff]=useState(false);
  const [reloading,setReloading]=useState(false);
  const telegramLaunch=typeof window!=='undefined'&&Boolean(window.Telegram?.WebApp?.initData);
  useEffect(()=>{
    if(status!=='authenticated'||!telegramLaunch)return;
    // Keep the verified splash visible for a painted frame before opening Home.
    let frame=0,paintFrame=0;
    frame=window.requestAnimationFrame(()=>{paintFrame=window.requestAnimationFrame(()=>{
      if(pathname==='/telegram'){
        const destination=miniReturnPath(new URL(window.location.href).searchParams.get('next'));
        router.replace(destination+(destination.includes('#')?'':window.location.hash));
      }else if(onComplete){
        onComplete();
      }else{
        // A bot button may open an auction before a bound session exists.
        // Sign in here, then reload the original path instead of losing it.
        window.location.reload();
      }
    })});
    return()=>{window.cancelAnimationFrame(frame);window.cancelAnimationFrame(paintFrame)};
  },[status,telegramLaunch,pathname,onComplete,router]);
  if(status==='contact-required')return <ContactGate/>;
  if(status==='loading'||(status==='authenticated'&&telegramLaunch))return <LaunchSplash complete={status==='authenticated'}/>;
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
