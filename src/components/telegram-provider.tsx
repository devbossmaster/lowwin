'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {usePathname} from 'next/navigation';
import {MINI_AUTH_TIMEOUT_MS,TelegramLaunchError,miniAuthError,signInTelegram,signOutMiniAccount,type MiniAccount} from '@/lib/mini-auth-client';
import {enableTelegramFullscreen,observeTelegramSdk,type TelegramViewportApp} from '@/lib/telegram-sdk-client';
import {telegramEnvironment,telegramMiniLaunchHint,type TelegramEnvironment} from '@/lib/telegram-browser-login-client';
import {clearTelegramAuthResume} from '@/lib/telegram-auth-resume';
import {chapaRecoveryStorage,clearChapaRecoveryPointers} from '@/lib/chapa-recovery-pointer';
import {CURRENT_ACCOUNT_QUERY_KEY,type BrowserAccountBootstrap} from '@/lib/current-account';
import {clearCurrentAccount,fetchCurrentAccount,loadCurrentAccount} from './current-account-query';
import {invalidatePrivateQueries,loadPrivateJson,setPrivateQueryIdentity,subscribePrivateQueries} from './private-query-cache';
type WebApp = TelegramViewportApp & { BackButton?:{isVisible?:boolean;show:()=>void;hide:()=>void;onClick:(handler:()=>void)=>void;offClick:(handler:()=>void)=>void};ready: () => void; close?:()=>void; openLink?:(url:string)=>void; openTelegramLink?:(url:string)=>void; requestContact?:(callback:(shared:boolean)=>void)=>void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
type Me = MiniAccount;
type Status = 'loading' | 'guest' | 'contact-required' | 'authenticated' | 'error';
const Context = createContext<{ status: Status; environment:TelegramEnvironment; queryIdentity:string|null; verifyingTelegram: boolean; me: Me | null; error: string; needsReopen: boolean; retry: () => void; finishContact: () => Promise<void>; refreshMe: () => Promise<void>; signOut:()=>Promise<void>; devLogin: (accessKey: string) => void; devEnabled: boolean; botUrl: string | null;newMiniRegistration:boolean;completeMiniIntroduction:()=>void;registrationOpen:boolean;openRegistration:()=>void;closeRegistration:()=>void }>({ status: 'loading', environment:'detecting', queryIdentity:null, verifyingTelegram: false, me: null, error: '', needsReopen: false, retry: () => {}, finishContact: async () => {}, refreshMe: async () => {}, signOut:async()=>{}, devLogin: () => {}, devEnabled: false, botUrl: null,newMiniRegistration:false,completeMiniIntroduction:()=>{},registrationOpen:false,openRegistration:()=>{},closeRegistration:()=>{} });
export const useTelegram = () => useContext(Context);
function accountIdentity(account:Me,attempt:number){return account.user.id+':'+(account.sessionKey??String(attempt))}
function announceSession(channel:BroadcastChannel|null,sessionKey:string|null|undefined){
  // The display-only fingerprint only lets same-session tabs skip a hint.
  // A receiver still reads its own signed session before publishing an account.
  try{channel?.postMessage({sessionKey})}catch{/* Tabs can still check their session on return. */}
}
export function TelegramProvider({children,devEnabled,botUrl,initialAccount}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null;initialAccount?:Promise<BrowserAccountBootstrap>}) {
  const pathname=usePathname(),previousPath=useRef(pathname);
  const client=useQueryClient();
  const {data:currentAccount}=useQuery({queryKey:CURRENT_ACCOUNT_QUERY_KEY,queryFn:fetchCurrentAccount,enabled:false});
  const browserBootstrap=useRef(initialAccount),browserEvents=useRef<BroadcastChannel|null>(null);
  const announceBrowserSession=useRef(true);
  const [status, setStatus] = useState<Status>('loading');
  const [environment,setEnvironment]=useState<TelegramEnvironment>('detecting');
  const miniDetected=useRef(typeof window!=='undefined'&&telegramMiniLaunchHint(window.location));
  const pendingRegistrationLaunch=useRef<string|null>(null);
  const [newMiniRegistration,setNewMiniRegistration]=useState(false);
  const completeMiniIntroduction=useCallback(()=>setNewMiniRegistration(false),[]);
  const resolveEnvironment=useCallback(()=>{
    if(telegramEnvironment(window.Telegram?.WebApp)==='mini'||telegramMiniLaunchHint(window.location))miniDetected.current=true;
    const next=miniDetected.current?'mini':'browser';setEnvironment(next);return next;
  },[]);
  const [registrationOpen,setRegistrationOpen]=useState(false);
  const openRegistration=useCallback(()=>setRegistrationOpen(true),[]);
  const closeRegistration=useCallback(()=>setRegistrationOpen(false),[]);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [queryIdentity,setQueryIdentity]=useState<string|null>(null);
  const identityRef=useRef<string|null>(null);
  const accountRef=useRef<Me|null>(null);
  const lastVerifiedOwner=useRef<string|null>(null);
  const refreshSequence=useRef(0);
  const accountUpdatedAt=useRef(0);
  const [error, setError] = useState('');
  const [needsReopen, setNeedsReopen] = useState(false);
  const [localBrowser, setLocalBrowser] = useState(false);
  const launchAttempt=useRef<string|null>(null);
  const attemptSequence=useRef(0);
  const authenticating=useRef(false);
  const signingOut=useRef(false);
  const me=currentAccount&&queryIdentity===accountIdentity(currentAccount,attemptSequence.current)?currentAccount:null;
  const clearAccount=useCallback(()=>{
    refreshSequence.current++;
    identityRef.current=null;accountRef.current=null;setPrivateQueryIdentity(null);clearCurrentAccount(client);setQueryIdentity(null);
  },[client]);
  const acceptAccount=useCallback((account:Me)=>{
    clearChapaRecoveryPointers(chapaRecoveryStorage(),account.user.id);
    if(lastVerifiedOwner.current&&lastVerifiedOwner.current!==account.user.id)clearTelegramAuthResume();
    lastVerifiedOwner.current=account.user.id;
    const profileChanged=accountRef.current?.user.id===account.user.id&&JSON.stringify(accountRef.current.user)!==JSON.stringify(account.user);
    accountRef.current=account;
    const identity=accountIdentity(account,attemptSequence.current);
    const changedIdentity=identityRef.current!==identity;
    identityRef.current=identity;accountUpdatedAt.current=Date.now();
    setPrivateQueryIdentity(identity);client.setQueryData(CURRENT_ACCOUNT_QUERY_KEY,account);setQueryIdentity(identity);
    // Preserve Mini App prewarming. Website wallet consumers load independently
    // once mounted and the account query never waits for their requests.
    if(changedIdentity&&miniDetected.current)void loadPrivateJson(identity,'/api/wallet').catch(()=>{});
    setRegistrationOpen(false);
    if(profileChanged)invalidatePrivateQueries(identity,['/api/profile']);
  },[client]);
  const refreshMe=useCallback(async()=>{
    const attempt=attemptSequence.current,sequence=++refreshSequence.current;
    const identity=identityRef.current;
    if(!identity)return;
    const account=await loadCurrentAccount(client,true);
    if(attempt!==attemptSequence.current||sequence!==refreshSequence.current||identity!==identityRef.current)return;
    if(account)acceptAccount(account);else{clearAccount();setStatus('guest')}
  },[acceptAccount,clearAccount,client]);
  const signOut=useCallback(async()=>{
    if(authenticating.current)throw new Error('Please wait for sign-in to finish.');
    authenticating.current=true;signingOut.current=true;
    ++attemptSequence.current;
    try{
      await signOutMiniAccount();
      clearChapaRecoveryPointers(chapaRecoveryStorage());
      clearTelegramAuthResume();
      lastVerifiedOwner.current=null;
      // The same SDK launch must not immediately sign the user back in.
      launchAttempt.current=window.Telegram?.WebApp?.initData??'';
      browserBootstrap.current=undefined;clearAccount();setError('');setNeedsReopen(environment==='mini');setVerifyingTelegram(false);setStatus('guest');
      if(environment==='browser')announceSession(browserEvents.current,null);
    }catch(cause){
      if(environment==='browser'){
        browserBootstrap.current=undefined;clearAccount();setError(miniAuthError(cause));setStatus('error');
        announceSession(browserEvents.current,undefined);
      }
      throw cause;
    }finally{signingOut.current=false;authenticating.current=false}
  },[clearAccount,environment]);
  useEffect(()=>subscribePrivateQueries(event=>{
    if(event.kind==='authorization'&&event.identity===identityRef.current){
      attemptSequence.current++;clearAccount();setStatus('guest');
    }
  }),[clearAccount]);
  useEffect(()=>{
    if(environment!=='mini')return;
    const visible=()=>{if(!document.hidden&&identityRef.current&&Date.now()-accountUpdatedAt.current>=15_000)void refreshMe().catch(()=>{})};
    document.addEventListener('visibilitychange',visible);
    return()=>document.removeEventListener('visibilitychange',visible);
  },[environment,refreshMe]);
  useEffect(()=>()=>{
    attemptSequence.current++;refreshSequence.current++;identityRef.current=null;setPrivateQueryIdentity(null);clearCurrentAccount(client);
    // React may replay mount effects. Let the new lifetime authenticate rather
    // than leaving it locked behind the discarded lifetime's request.
    authenticating.current=false;launchAttempt.current=null;
  },[client]);
  const authenticate = useCallback(async (dev = false, accessKey?: string) => {
    // The SDK callback, mount effect and Retry must not create parallel sign-ins.
    if(authenticating.current)return;
    authenticating.current=true;
    const attempt=++attemptSequence.current;
    clearAccount();setStatus('loading'); setError(''); setNeedsReopen(false);
    const app = window.Telegram?.WebApp;
    const mode=resolveEnvironment();
    const restorationStarted=mode==='browser'?performance.now():null;
    if(launchAttempt.current!==app?.initData){pendingRegistrationLaunch.current=null;setNewMiniRegistration(false)}
    launchAttempt.current=app?.initData??'';
    // The spinner is presentation only. The server verifies Telegram identity and contact proof.
    setVerifyingTelegram(Boolean(app?.initData && !dev));
    try {
      // A known Mini launch waits for actual signed SDK data, never browser OIDC.
      if(mode==='mini'&&!app?.initData&&!dev){launchAttempt.current=null;return}
      // A presentation-only SDK failure must not strand the authentication lock.
      try { app?.ready(); } catch { /* Authentication still runs. */ }
      // A browser may restore an owned OIDC session without Mini App launch data.
      // /api/me enforces the server-side authentication/contact proof in either flow.
      if(app?.initData&&!dev) {
        const result=await signInTelegram(app.initData);
        if(attempt!==attemptSequence.current)return;
        if(result.status==='contact-required')pendingRegistrationLaunch.current=app.initData;
        else {
          acceptAccount(result.me);
          if(pendingRegistrationLaunch.current===app.initData)setNewMiniRegistration(true);
          pendingRegistrationLaunch.current=null;
        }
        setStatus(result.status);return;
      }
      if(dev) {
        const response=await fetch('/api/auth/lowin/dev-identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessKey}),signal:AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)});
        if(!response.ok)throw new Error('Local test sign-in was denied. Check the operator key and localhost configuration.');
        if(attempt!==attemptSequence.current)return;
      }
      const bootstrap=mode==='browser'&&!dev?browserBootstrap.current:undefined;
      browserBootstrap.current=undefined;
      const initial=await bootstrap;
      if(attempt!==attemptSequence.current)return;
      if(initial?.kind==='unavailable')throw Error('Your account could not be loaded. Please retry.');
      const account=initial?.kind==='verified'?initial.account:initial?.kind==='guest'?null:await loadCurrentAccount(client);
      if(attempt!==attemptSequence.current)return;
      if(!account){setStatus('guest');return}
      acceptAccount(account);setStatus('authenticated');
      try{if(restorationStarted!==null)performance.measure('lowwin:auth:browser-restoration',{start:restorationStarted,end:performance.now()})}catch{/* Timing is optional. */}
      if(mode==='browser'&&!dev&&announceBrowserSession.current){
       announceBrowserSession.current=false;
       announceSession(browserEvents.current,account.sessionKey);
      }
    } catch (err) { if(attempt!==attemptSequence.current)return;clearAccount();setNeedsReopen(err instanceof TelegramLaunchError); setError(miniAuthError(err)); setStatus('error'); }
    finally { if(attempt===attemptSequence.current){authenticating.current=false;setVerifyingTelegram(false)} }
  }, [acceptAccount,clearAccount,client,resolveEnvironment]);
  useEffect(()=>{
    // A changed-session hint hides the previous account immediately. A plain
    // return to the tab validates without discarding same-session payment state.
    const synchronize=()=>{
      if(signingOut.current||resolveEnvironment()!=='browser')return;
      browserBootstrap.current=undefined;
      announceBrowserSession.current=false;
      authenticating.current=false;
      void authenticate();
    };
    const recheck=()=>{
      if(signingOut.current||resolveEnvironment()!=='browser')return;
      if(identityRef.current)void refreshMe().catch(()=>{});
      else if(!authenticating.current)synchronize();
    };
    let channel:BroadcastChannel|null=null;
    try{
      channel=new BroadcastChannel('lowwin-browser-session');browserEvents.current=channel;
      channel.onmessage=event=>{
        if(!event.data||typeof event.data!=='object'||!('sessionKey' in event.data))return;
        const expected=event.data.sessionKey;
        if(expected===undefined){recheck();return}
        if(typeof expected==='string'&&expected===accountRef.current?.sessionKey)return;
        if(expected===null||typeof expected==='string')synchronize();
      };
    }catch{/* Session restoration works without cross-tab notifications. */}
    const restored=(event:PageTransitionEvent)=>{if(event.persisted)recheck()};
    const visible=()=>{if(!document.hidden&&identityRef.current)recheck()};
    window.addEventListener('pageshow',restored);
    document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',visible);browserEvents.current=null;channel?.close()};
  },[authenticate,refreshMe,resolveEnvironment]);
  const autoAuthenticate=useCallback(()=>{const app=window.Telegram?.WebApp,launch=app?.initData??'';resolveEnvironment();if(launchAttempt.current===launch)return;void authenticate()},[authenticate,resolveEnvironment]);
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
  },[status,verifyingTelegram]);
  // A late SDK load can arrive during a previous request. Retry only a changed
  // launch once that request settles, never loop on the same failed launch.
  useEffect(()=>{if(status!=='loading')autoAuthenticate()},[status,autoAuthenticate]);
  useEffect(() => {
    // Visibility only, never authentication proof. This also hides the action
    // when a proxy has rewritten all server-visible headers to localhost.
    setLocalBrowser(['localhost','127.0.0.1','[::1]'].includes(window.location.hostname));
    let stopFullscreen=()=>{};
    let missingLaunch:ReturnType<typeof setTimeout>|undefined;
    const sdkUnavailable=()=>{
      // Browser login and existing browser sessions do not depend on WebApp JS.
      if(!window.Telegram?.WebApp?.initData&&resolveEnvironment()==='browser'){autoAuthenticate();return}
      if(authenticating.current||identityRef.current)return;
      launchAttempt.current=window.Telegram?.WebApp?.initData??'';
      clearAccount();setNeedsReopen(true);setError('Telegram could not load. Reopen Lowwin from the bot.');setStatus('error');
    };
    const sdkReady=()=>{
      stopFullscreen();stopFullscreen=enableTelegramFullscreen(window.Telegram?.WebApp);
      autoAuthenticate();
      if(miniDetected.current&&!window.Telegram?.WebApp?.initData)missingLaunch=setTimeout(()=>{
        if(window.Telegram?.WebApp?.initData)autoAuthenticate();else sdkUnavailable();
      },8000);
    };
    const stop=observeTelegramSdk(sdkReady,sdkUnavailable);
    autoAuthenticate();
    return()=>{clearTimeout(missingLaunch);stopFullscreen();stop()};
  }, [autoAuthenticate,clearAccount,resolveEnvironment]);
  return <Context.Provider value={{ status, environment, queryIdentity, verifyingTelegram, me, error, needsReopen, retry: () => {if(needsReopen)return;void authenticate()}, finishContact:authenticate, refreshMe, signOut, devLogin: accessKey => void authenticate(true, accessKey), devEnabled: devEnabled && localBrowser, botUrl,newMiniRegistration,completeMiniIntroduction,registrationOpen,openRegistration,closeRegistration }}>
    {children}
  </Context.Provider>;
}
