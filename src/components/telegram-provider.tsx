'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {MINI_AUTH_TIMEOUT_MS,miniAuthError,signInTelegram,type MiniAccount} from '@/lib/mini-auth-client';
type WebApp = { initData?: string; platform?:string; ready: () => void; expand?:()=>void; requestFullscreen?:()=>void; close?:()=>void; requestContact?:(callback:(shared:boolean)=>void)=>void; isVersionAtLeast?:(version:string)=>boolean; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
type Me = MiniAccount;
type Status = 'loading' | 'guest' | 'contact-required' | 'authenticated' | 'error';
const Context = createContext<{ status: Status; verifyingTelegram: boolean; me: Me | null; error: string; retry: () => void; finishContact: () => Promise<void>; refreshMe: () => Promise<void>; devLogin: (accessKey: string) => void; devEnabled: boolean; botUrl: string | null }>({ status: 'loading', verifyingTelegram: false, me: null, error: '', retry: () => {}, finishContact: async () => {}, refreshMe: async () => {}, devLogin: () => {}, devEnabled: false, botUrl: null });
export const useTelegram = () => useContext(Context);
export function TelegramProvider({ children, devEnabled, botUrl, requireLaunch=false }: { children: React.ReactNode; devEnabled: boolean; botUrl: string | null; requireLaunch?:boolean }) {
  const [status, setStatus] = useState<Status>('loading');
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [localBrowser, setLocalBrowser] = useState(false);
  const launchAttempt=useRef<string|null>(null);
  const attemptSequence=useRef(0);
  const authenticating=useRef(false);
  const refreshMe=useCallback(async()=>{
    const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)});
    if(!response.ok)throw new Error('Account refresh failed');
    setMe(await response.json());
  },[]);
  const authenticate = useCallback(async (dev = false, accessKey?: string) => {
    // The SDK callback, mount effect and Retry must not create parallel sign-ins.
    if(authenticating.current)return;
    authenticating.current=true;
    const attempt=++attemptSequence.current;
    setStatus('loading'); setError('');
    const app = window.Telegram?.WebApp;
    // The spinner is presentation only. Access still requires signed initData and server contact verification.
    setVerifyingTelegram(Boolean(app?.initData && !dev));
    app?.ready(); app?.setHeaderColor?.('#6d9410'); app?.setBackgroundColor?.('#6d9410');
    try {
      if(requireLaunch&&!app?.initData&&!dev){setMe(null);setStatus('guest');return}
      if(app?.initData&&!dev) {
        const result=await signInTelegram(app.initData);
        if(attempt!==attemptSequence.current)return;
        setMe(result.me);setStatus(result.status);return;
      }
      if(dev) {
        const response=await fetch('/api/auth/lowin/dev-identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessKey}),signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)});
        if(!response.ok)throw new Error('Local test sign-in was denied. Check the operator key and localhost configuration.');
        if(attempt!==attemptSequence.current)return;
      }
      const response = await fetch('/api/me', { cache: 'no-store', signal: AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS) });
      if(attempt!==attemptSequence.current)return;
      if (response.status === 401 || (!app?.initData && !dev && response.status === 503)) { setMe(null); setStatus('guest'); return; }
      if (!response.ok) throw new Error('Your account could not be loaded. Please retry.');
      const account=await response.json();if(attempt!==attemptSequence.current)return;setMe(account); setStatus('authenticated');
    } catch (err) { if(attempt!==attemptSequence.current)return;setMe(null); setError(miniAuthError(err)); setStatus('error'); }
    finally { authenticating.current=false;if(attempt===attemptSequence.current)setVerifyingTelegram(false); }
  }, [requireLaunch]);
  const finishContact=useCallback(async()=>{
    const attempt=++attemptSequence.current;
    setStatus('loading');setError('');setVerifyingTelegram(true);
    try{
      // /api/me requires the stored Telegram-bound session and verified contact.
      // Reusing that session avoids a second Mini App sign-in after the bot confirms contact.
      const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)});
      if(attempt!==attemptSequence.current)return;
      if(!response.ok)throw new Error('Contact was shared, but your account is not ready. Reopen Lowwin from the bot.');
      const account=await response.json();if(attempt!==attemptSequence.current)return;
      setMe(account);setStatus('authenticated');
    }catch(cause){if(attempt!==attemptSequence.current)return;setMe(null);setError(miniAuthError(cause));setStatus('error')}
    finally{if(attempt===attemptSequence.current)setVerifyingTelegram(false)}
  },[]);
  const autoAuthenticate=useCallback(()=>{const launch=window.Telegram?.WebApp?.initData??'';if(launchAttempt.current===launch)return;launchAttempt.current=launch;void authenticate()},[authenticate]);
  useEffect(() => {
    const color=(status==='loading'&&verifyingTelegram)||status==='error'||(requireLaunch&&status==='guest')?'#6d9410':'#FFFFFF';
    window.Telegram?.WebApp?.setHeaderColor?.(color);
    window.Telegram?.WebApp?.setBackgroundColor?.(color);
  },[status,verifyingTelegram,requireLaunch]);
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
