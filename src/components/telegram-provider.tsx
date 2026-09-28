'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
type WebApp = { initData?: string; ready: () => void; close?:()=>void; requestContact?:(callback:(shared:boolean)=>void)=>void; isVersionAtLeast?:(version:string)=>boolean; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
type Me = { user: { id: string; name: string; image?: string | null }; wallet: { available: string; held: string; demo?:boolean } };
type Status = 'loading' | 'guest' | 'contact-required' | 'authenticated' | 'error';
const Context = createContext<{ status: Status; verifyingTelegram: boolean; me: Me | null; error: string; retry: () => void; finishContact: () => Promise<void>; refreshMe: () => Promise<void>; devLogin: (accessKey: string) => void; devEnabled: boolean; botUrl: string | null }>({ status: 'loading', verifyingTelegram: false, me: null, error: '', retry: () => {}, finishContact: async () => {}, refreshMe: async () => {}, devLogin: () => {}, devEnabled: false, botUrl: null });
export const useTelegram = () => useContext(Context);
export function TelegramProvider({ children, devEnabled, botUrl, requireLaunch=false, initialSessionVerified=false }: { children: React.ReactNode; devEnabled: boolean; botUrl: string | null; requireLaunch?:boolean; initialSessionVerified?:boolean }) {
  const [status, setStatus] = useState<Status>('loading');
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [localBrowser, setLocalBrowser] = useState(false);
  const launchAttempt=useRef<string|null>(null);
  const attemptSequence=useRef(0);
  const refreshMe=useCallback(async()=>{
    const response=await fetch('/api/me',{cache:'no-store'});
    if(!response.ok)throw new Error('Account refresh failed');
    setMe(await response.json());
  },[]);
  const authenticate = useCallback(async (dev = false, accessKey?: string) => {
    const attempt=++attemptSequence.current;
    setStatus('loading'); setError('');
    const app = window.Telegram?.WebApp;
    // The handoff flag only preserves the completed animation across a client
    // route transition; the server-verified session is still required.
    const verifiedHandoff=initialSessionVerified&&document.documentElement.dataset.lowwinHandoff==='true'&&Boolean(app?.initData)&&!dev;
    // The spinner is presentation only. Access still requires signed initData and server contact verification.
    setVerifyingTelegram(Boolean(app?.initData && !dev));
    app?.ready(); app?.setHeaderColor?.('#6d9410'); app?.setBackgroundColor?.('#6d9410');
    try {
      if(requireLaunch&&!app?.initData&&!dev){setMe(null);setStatus('guest');return}
      if ((dev || app?.initData)&&!verifiedHandoff) {
        const response = await fetch(dev ? '/api/auth/lowin/dev-identity' : '/api/auth/telegram/miniapp/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dev ? { accessKey } : { initData: app!.initData }), signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(dev ? 'Local test sign-in was denied. Check the operator key and localhost configuration.' : response.status === 503 ? 'Sign-in is not available yet. Please try again shortly.' : 'Reopen Lowwin from the bot to verify your launch.');
        if(attempt!==attemptSequence.current)return;
      }
      const contact=await fetch('/api/onboarding/contact',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(attempt!==attemptSequence.current)return;
      if(contact.ok&&!(await contact.json()).verified){setMe(null);setStatus('contact-required');return}
      if(!contact.ok&&contact.status!==401)throw new Error('Contact verification is temporarily unavailable. Please retry.');
      const response = await fetch('/api/me', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if(attempt!==attemptSequence.current)return;
      if (response.status === 401 || (!app?.initData && !dev && response.status === 503)) { setMe(null); setStatus('guest'); return; }
      if (!response.ok) throw new Error('Your account could not be loaded. Please retry.');
      const account=await response.json();if(attempt!==attemptSequence.current)return;setMe(account); setStatus('authenticated');
    } catch (err) { if(attempt!==attemptSequence.current)return;setMe(null); setError(err instanceof Error ? err.message : 'Connection interrupted. Please retry.'); setStatus('error'); }
    finally { if(attempt===attemptSequence.current)setVerifyingTelegram(false); }
  }, [requireLaunch,initialSessionVerified]);
  const finishContact=useCallback(async()=>{
    const attempt=++attemptSequence.current;
    setStatus('loading');setError('');setVerifyingTelegram(true);
    try{
      // /api/me requires the stored Telegram-bound session and verified contact.
      // Reusing that session avoids a second Mini App sign-in after the bot confirms contact.
      const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(attempt!==attemptSequence.current)return;
      if(!response.ok)throw new Error('Contact was shared, but your account is not ready. Reopen Lowwin from the bot.');
      const account=await response.json();if(attempt!==attemptSequence.current)return;
      setMe(account);setStatus('authenticated');
    }catch(cause){if(attempt!==attemptSequence.current)return;setMe(null);setError(cause instanceof Error?cause.message:'Account verification interrupted. Please retry.');setStatus('error')}
    finally{if(attempt===attemptSequence.current)setVerifyingTelegram(false)}
  },[]);
  const autoAuthenticate=useCallback(()=>{const launch=window.Telegram?.WebApp?.initData??'';if(launchAttempt.current===launch)return;launchAttempt.current=launch;void authenticate()},[authenticate]);
  useEffect(() => {
    const color=status==='loading'&&verifyingTelegram?'#6d9410':'#FFFFFF';
    window.Telegram?.WebApp?.setHeaderColor?.(color);
    window.Telegram?.WebApp?.setBackgroundColor?.(color);
  },[status,verifyingTelegram]);
  useEffect(() => {
    // Visibility only, never authentication proof. This also hides the action
    // when a proxy has rewritten all server-visible headers to localhost.
    setLocalBrowser(['localhost','127.0.0.1','[::1]'].includes(window.location.hostname));
    if(window.Telegram?.WebApp?.initData){autoAuthenticate();return}
    const timer = setTimeout(autoAuthenticate, 800); return () => clearTimeout(timer);
  }, [autoAuthenticate]);
  return <Context.Provider value={{ status, verifyingTelegram, me, error, retry: () => void authenticate(), finishContact, refreshMe, devLogin: accessKey => void authenticate(true, accessKey), devEnabled: devEnabled && localBrowser, botUrl }}>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={autoAuthenticate}/>
    {children}
  </Context.Provider>;
}
