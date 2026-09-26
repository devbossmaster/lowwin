'use client';
import { ArrowUpRight, ShieldCheck, RotateCcw, Send } from 'lucide-react';
import { useTelegram } from './telegram-provider';
import { Button } from './ui/button';
export function IdentityState({ compact = false }: { compact?: boolean }) {
  const { status, me, error, retry, devLogin, devEnabled, botUrl } = useTelegram();
  if (status === 'authenticated') return <div className="verified-line"><ShieldCheck size={18}/><span>Welcome, {me?.user.name}. You’re signed in.</span></div>;
  return <section className={`identity-state ${compact ? 'compact' : ''}`} aria-live="polite">
    <div className="identity-heading"><Send size={20}/><h2>{status === 'error' ? 'Let’s reconnect' : status === 'loading' ? 'A moment for your account' : 'Your Lowin starts in Telegram'}</h2></div>
    <p>{status === 'error' ? error : status === 'loading' ? 'Checking your secure session.' : 'Open Lowin from our bot to keep your points, bids and wins together. You can read the rules here anytime.'}</p>
    {status === 'error' && <Button variant="outline" onClick={retry}><RotateCcw size={16}/> Retry connection</Button>}
    {botUrl && status !== 'loading' && <Button asChild><a href={botUrl} target="_blank" rel="noreferrer">Open in Telegram <ArrowUpRight size={17}/></a></Button>}
    {!botUrl && status !== 'loading' && <p className="setup-note">The Telegram launch link is being set up.</p>}
    {devEnabled && status !== 'loading' && <Button className="dev-button" variant="outline" onClick={devLogin}>Use local test identity</Button>}
  </section>;
}
