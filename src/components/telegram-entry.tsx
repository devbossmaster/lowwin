'use client';
import {useEffect} from 'react';
import {useTelegram} from './telegram-provider';
export function TelegramEntry(){
  const {status,botUrl,error,retry}=useTelegram();
  useEffect(()=>{if(status==='authenticated'&&window.Telegram?.WebApp?.initData)window.location.replace('/')},[status]);
  return <main id="main" className="telegram-entry"><span className="wordmark">lowin<span>.</span></span><h1>Your Mini App.<br/>Inside Telegram.</h1><p>Open the Lowin bot to browse auctions, place point bids and manage your wallet.</p>{botUrl?<a className="primary-button" href={botUrl}>Continue with the bot</a>:<p role="status">The bot link is not configured yet. Please try again later.</p>}{status==='loading'&&<p role="status">Checking your Telegram launch…</p>}{error&&<><p role="alert">{error}</p><button className="text-link" onClick={retry}>Retry connection</button></>}</main>
}
