'use client';
import {useEffect} from 'react';
import {useTelegram} from './telegram-provider';
import {ContactGate} from './contact-gate';
export function TelegramEntry(){
  const {status,botUrl,error,retry}=useTelegram();
  useEffect(()=>{if(status==='authenticated'&&window.Telegram?.WebApp?.initData)window.location.replace('/'+window.location.hash)},[status]);
  if(status==='contact-required')return <ContactGate/>;
  if(status==='loading'||status==='authenticated')return <main id="main" className="telegram-entry launch-loader"><span className="wordmark">lowin<span>.</span></span><div className="launch-progress"/><p role="status">Checking your Telegram launch…</p></main>;
  return <main id="main" className="telegram-entry"><span className="wordmark">lowin<span>.</span></span><h1>Your Mini App.<br/>Inside Telegram.</h1><p>Open the Lowin bot to browse auctions, place point bids and manage your wallet.</p>{botUrl?<a className="primary-button" href={botUrl}>Continue with the bot</a>:<p role="status">The bot link is not configured yet. Please try again later.</p>}{error&&<><p role="alert">{error}</p><button className="text-link" onClick={retry}>Retry connection</button></>}</main>
}
