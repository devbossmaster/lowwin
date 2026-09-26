'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Script from 'next/script';
type WebApp = { initData?: string; ready: () => void; expand: () => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
type Me = { user: { id: string; name: string }; wallet: { available: string; held: string } };
type Status = 'loading' | 'guest' | 'authenticated' | 'error';
const Context = createContext<{ status: Status; me: Me | null; error: string; retry: () => void; devLogin: () => void; devEnabled: boolean; botUrl: string | null }>({ status: 'loading', me: null, error: '', retry: () => {}, devLogin: () => {}, devEnabled: false, botUrl: null });
export const useTelegram = () => useContext(Context);
export function TelegramProvider({ children, devEnabled, botUrl }: { children: React.ReactNode; devEnabled: boolean; botUrl: string | null }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const authenticate = useCallback(async (dev = false) => {
    setStatus('loading'); setError('');
    const app = window.Telegram?.WebApp;
    app?.ready(); app?.expand(); app?.setHeaderColor?.('#F7F7F2'); app?.setBackgroundColor?.('#F7F7F2');
    try {
      if (dev || app?.initData) {
        const response = await fetch(dev ? '/api/auth/lowin/dev-identity' : '/api/auth/telegram/miniapp/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dev ? {} : { initData: app!.initData }), signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(response.status === 503 ? 'Sign-in is not available yet. Please try again shortly.' : 'Your launch has expired or could not be verified. Reopen Lowin from the bot.');
      }
      const response = await fetch('/api/me', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (response.status === 401 || (!app?.initData && !dev && response.status === 503)) { setStatus('guest'); return; }
      if (!response.ok) throw new Error('Your account could not be loaded. Please retry.');
      setMe(await response.json()); setStatus('authenticated');
    } catch (err) { setMe(null); setError(err instanceof Error ? err.message : 'Connection interrupted. Please retry.'); setStatus('error'); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void authenticate(), 800); return () => clearTimeout(timer); }, [authenticate]);
  return <Context.Provider value={{ status, me, error, retry: () => void authenticate(), devLogin: () => void authenticate(true), devEnabled, botUrl }}>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
    {children}
  </Context.Provider>;
}
