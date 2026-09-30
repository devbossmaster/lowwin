'use client';
import {PageLoading} from '@/components/loading-spinner';

import { ArrowUpRight, ShieldCheck, RotateCcw, Send } from 'lucide-react';
import { useTelegram } from './telegram-provider';
import { Button } from './ui/button';
import { useState } from 'react';
import { TelegramBotLink } from './telegram-bot-link';
export function IdentityState({ compact = false }: { compact?: boolean }) {
  const { status, me, error, needsReopen, retry, devLogin, devEnabled, botUrl } = useTelegram();
  const [accessKey, setAccessKey] = useState('');
  if (status === 'loading') return <PageLoading/>;
  if (status === 'authenticated') return <div className="verified-line"><ShieldCheck size={18}/><span>Welcome, {me?.user.name}. You’re signed in.</span></div>;
  return <section className={`identity-state ${compact ? 'compact' : ''}`} aria-live="polite">
    <div className="identity-heading"><Send size={20}/><h2>{status === 'error' ? 'Let’s reconnect' : 'Your Lowwin starts in Telegram'}</h2></div>
    <p>{status === 'error' ? error : 'Open Lowwin from our bot to keep your ETB balance, bids and wins together. You can read the rules here anytime.'}</p>
    {status === 'error' && !needsReopen && <Button variant="outline" onClick={retry}><RotateCcw size={16}/> Retry connection</Button>}
    {botUrl && <Button asChild><TelegramBotLink href={botUrl} target="_blank" rel="noreferrer">Open in Telegram <ArrowUpRight size={17}/></TelegramBotLink></Button>}
    {!botUrl && <p className="setup-note">The Telegram launch link is being set up.</p>}
    {devEnabled && <form className="mt-4 grid gap-2" onSubmit={event => { event.preventDefault(); devLogin(accessKey); setAccessKey(''); }}>
      <label htmlFor="local-identity-key" className="text-sm">Local operator key</label>
      <input id="local-identity-key" type="password" autoComplete="off" required minLength={32} maxLength={256} value={accessKey} onChange={event => setAccessKey(event.target.value)} className="min-h-12 min-w-0 rounded-xl border border-border bg-transparent px-3 text-sm"/>
      <Button className="dev-button" variant="outline" type="submit">Use local test identity</Button>
    </form>}
  </section>;
}
