'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {usePathname} from 'next/navigation';
import {MINI_AUTH_TIMEOUT_MS,TelegramLaunchError,miniAuthError,signInTelegram,signOutMiniAccount,type MiniAccount} from '@/lib/mini-auth-client';
import {loadPrivateJson,seedPrivateQuery,setPrivateQueryIdentity,subscribePrivateQueries} from './private-query-cache';
type WebApp = { BackButton?:{isVisible?:boolean;show:()=>void;hide:()=>void;onClick:(handler:()=>void)=>void;offClick:(handler:()=>void)=>void};initData?: string; platform?:string; ready: () => void; expand?:()=>void; requestFullscreen?:()=>void; close?:()=>void; openTelegramLink?:(url:string)=>void; requestContact?:(callback:(shared:boolean)=>void)=>void; isVersionAtLeast?:(version:string)=>boolean; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
type Me = MiniAccount;
type Status = 'loading' | 'guest' | 'contact-required' | 'authenticated' | 'error';
const Context = createContext<{ status: Status; queryIdentity:string|null; verifyingTelegram: boolean; me: Me | null; error: string; needsReopen: boolean; retry: () => void; finishContact: () => Promise<void>; refreshMe: () => Promise<void>; signOut:()=>Promise<void>; devLogin: (accessKey: string) => void; devEnabled: boolean; botUrl: string | null }>({ status: 'loading', queryIdentity:null, verifyingTelegram: false, me: null, error: '', needsReopen: false, retry: () => {}, finishContact: async () => {}, refreshMe: async () => {}, signOut:async()=>{}, devLogin: () => {}, devEnabled: false, botUrl: null });
export const useTelegram = () => useContext(Context);
export function TelegramProvider({ children, devEnabled, botUrl, requireLaunch=false }: { children: React.ReactNode; devEnabled: boolean; botUrl: string | null; requireLaunch?:boolean }) {
  const pathname=usePathname(),previousPath=useRef(pathname);
  const [status, setStatus] = useState<Status>('loading');
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [queryIdentity,setQueryIdentity]=useState<string|null>(null);
  const identityRef=useRef<string|null>(null);
  const refreshSequence=useRef(0);
  const accountUpdatedAt=useRef(0);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [needsReopen, setNeedsReopen] = useState(false);
  const [localBrowser, setLocalBrowser] = useState(false);
  const launchAttempt=useRef<string|null>(null);
  const attemptSequence=useRef(0);
  const authenticating=useRef(false);
  const clearAccount=useCallback(()=>{
    refreshSequence.current++;
    identityRef.current=null;setPrivateQueryIdentity(null);setQueryIdentity(null);setMe(null);
  },[]);
  const acceptAccount=useCallback((account:Me)=>{
    const identity=account.user.id+':'+(account.sessionKey??String(attemptSequence.current));
    identityRef.current=identity;accountUpdatedAt.current=Date.now();
    setPrivateQueryIdentity(identity);seedPrivateQuery(identity,'/api/me',account);setQueryIdentity(identity);setMe(account);
  },[]);
  const refreshMe=useCallback(async()=>{
    const attempt=attemptSequence.current,sequence=++refreshSequence.current;
    const identity=identityRef.current;
    if(!identity)return;
    const account=await loadPrivateJson<Me>(identity,'/api/me',{force:true});
    if(attempt!==attemptSequence.current||sequence!==refreshSequence.current||identity!==identityRef.current)return;
    acceptAccount(account);
  },[acceptAccount,clearAccount]);
  const signOut=useCallback(async()=>{
    if(authenticating.current)throw new Error('Please wait for sign-in to finish.');
    authenticating.current=true;
    ++attemptSequence.current;
    try{
      await signOutMiniAccount();
      // The same SDK launch must not immediately sign the user back in.
      launchAttempt.current=window.Telegram?.WebApp?.initData??'';
      clearAccount();setError('');setNeedsReopen(true);setVerifyingTelegram(false);setStatus('guest');
    }finally{authenticating.current=false}
  },[clearAccount]);
  useEffect(()=>subscribePrivateQueries(event=>{
    if(event.kind==='authorization'&&event.identity===identityRef.current){
      attemptSequence.current++;clearAccount();setStatus('guest');
    }
  }),[clearAccount]);
  useEffect(()=>{
    const visible=()=>{if(!document.hidden&&identityRef.current&&Date.now()-accountUpdatedAt.current>=15_000)void refreshMe().catch(()=>{})};
    document.addEventListener('visibilitychange',visible);
    return()=>document.removeEventListener('visibilitychange',visible);
  },[refreshMe]);
  useEffect(()=>()=>{
    attemptSequence.current++;refreshSequence.current++;identityRef.current=null;setPrivateQueryIdentity(null);
    // React may replay mount effects. Let the new lifetime authenticate rather
    // than leaving it locked behind the discarded lifetime's request.
    authenticating.current=false;launchAttempt.current=null;
  },[]);
  const authenticate = useCallback(async (dev = false, accessKey?: string) => {
    // The SDK callback, mount effect and Retry must not create parallel sign-ins.
    if(authenticating.current)return;
    authenticating.current=true;
    const attempt=++attemptSequence.current;
    clearAccount();setStatus('loading'); setError(''); setNeedsReopen(false);
    const app = window.Telegram?.WebApp;
    launchAttempt.current=app?.initData??'';
    // The spinner is presentation only. Access still requires signed initData and server contact verification.
    setVerifyingTelegram(Boolean(app?.initData && !dev));
    try {
      // A presentation-only SDK failure must not strand the authentication lock.
      try { app?.ready(); } catch { /* Authentication still runs. */ }
      if(requireLaunch&&!app?.initData&&!dev){setMe(null);setStatus('guest');return}
      if(app?.initData&&!dev) {
        const result=await signInTelegram(app.initData);
        if(attempt!==attemptSequence.current)return;
        if(result.status==='authenticated')acceptAccount(result.me);setStatus(result.status);return;
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
      const account=await response.json();if(attempt!==attemptSequence.current)return;acceptAccount(account); setStatus('authenticated');
    } catch (err) { if(attempt!==attemptSequence.current)return;setMe(null); setNeedsReopen(err instanceof TelegramLaunchError); setError(miniAuthError(err)); setStatus('error'); }
    finally { if(attempt===attemptSequence.current){authenticating.current=false;setVerifyingTelegram(false)} }
  }, [requireLaunch,acceptAccount,clearAccount]);
  const finishContact=useCallback(async()=>{
    const attempt=++attemptSequence.current;
    clearAccount();setStatus('loading');setError('');setNeedsReopen(false);setVerifyingTelegram(true);
    try{
      // /api/me requires the stored Telegram-bound session and verified contact.
      // Reusing that session avoids a second Mini App sign-in after the bot confirms contact.
      const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)});
      if(attempt!==attemptSequence.current)return;
      if(response.status===401||response.status===403)throw new TelegramLaunchError();
      if(!response.ok)throw new Error('Contact was shared, but your account could not load. Tap Retry.');
      const account=await response.json();if(attempt!==attemptSequence.current)return;
      acceptAccount(account);setStatus('authenticated');
    }catch(cause){if(attempt!==attemptSequence.current)return;setMe(null);setNeedsReopen(cause instanceof TelegramLaunchError);setError(miniAuthError(cause));setStatus('error')}
    finally{if(attempt===attemptSequence.current)setVerifyingTelegram(false)}
  },[acceptAccount,clearAccount]);
  const autoAuthenticate=useCallback(()=>{const launch=window.Telegram?.WebApp?.initData??'';if(launchAttempt.current===launch)return;void authenticate()},[authenticate]);
  useEffect(()=>{
    const reopened=pathname==='/telegram'&&previousPath.current!==pathname;
    previousPath.current=pathname;
    // A server redirect back to launch must recheck a revoked/expired session.
    if(reopened)void authenticate();else if(status!=='loading')autoAuthenticate();
  },[pathname,status,authenticate,autoAuthenticate]);
  useEffect(() => {
    const color='#FFFFFF';
    try { window.Telegram?.WebApp?.setHeaderColor?.(color); } catch { /* Older Telegram clients may reject custom colors. */ }
    try { window.Telegram?.WebApp?.setBackgroundColor?.(color); } catch { /* Keep recovery controls usable. */ }
  },[status,verifyingTelegram,requireLaunch]);
  // A late SDK load can arrive during a previous request. Retry only a changed
  // launch once that request settles, never loop on the same failed launch.
  useEffect(()=>{if(status!=='loading')autoAuthenticate()},[status,autoAuthenticate]);
  useEffect(() => {
    // Visibility only, never authentication proof. This also hides the action
    // when a proxy has rewritten all server-visible headers to localhost.
    setLocalBrowser(['localhost','127.0.0.1','[::1]'].includes(window.location.hostname));
    if(window.Telegram?.WebApp?.initData){autoAuthenticate();return}
    const timer = setTimeout(autoAuthenticate, 800); return () => clearTimeout(timer);
  }, [autoAuthenticate]);
  return <Context.Provider value={{ status, queryIdentity, verifyingTelegram, me, error, needsReopen, retry: () => {if(!needsReopen)void authenticate()}, finishContact, refreshMe, signOut, devLogin: accessKey => void authenticate(true, accessKey), devEnabled: devEnabled && localBrowser, botUrl }}>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={autoAuthenticate}/>
    {children}
  </Context.Provider>;
}
