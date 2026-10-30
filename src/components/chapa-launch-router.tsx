'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {resolveChapaReturn} from '@/lib/chapa-return-resolution';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {LaunchSplash} from './launch-splash';

/** startapp identifies a payment, never its owner or outcome. The return route
 * reads the owned server record before choosing the bid/top-up surface. */
export function ChapaLaunchRouter({children=null}:{children?:React.ReactNode}){
 const {status,queryIdentity,verifyingTelegram}=useTelegram(),{language}=useMiniLocale();
 const router=useRouter(),pathname=usePathname(),search=useSearchParams(),handled=useRef<string|null>(null);
 const launch=typeof window==='undefined'?null:window.Telegram?.WebApp?.initData;
 const returnPath=launch?chapaReturnStartPath(new URLSearchParams(launch).get('start_param')):null;
 const id=returnPath?new URL(returnPath,'https://lowwin.invalid').searchParams.get('checkout'):null;
 const key=queryIdentity&&launch&&id?queryIdentity+':'+launch:null;
 const [resolution,setResolution]=useState<{key:string;destination:string|null;error:boolean}|null>(null);
 const explicitReturn=pathname==='/payments/chapa/return';
 const destination=resolution?.key===key?resolution.destination:null;
 const currentPath=pathname+(search.size?'?'+search.toString():'');
 const arrived=!!destination&&currentPath===destination.split('#')[0];
 const waiting=!!key&&handled.current!==key&&!explicitReturn&&!arrived;
 useEffect(()=>{
  if(!key||status!=='authenticated'||verifyingTelegram)return;
  if(explicitReturn||arrived){handled.current=key;return}
  if(!waiting||!queryIdentity||!id)return;
  let active=true;
  void resolveChapaReturn(queryIdentity,id).then(path=>{
   if(!active)return;
   setResolution({key,destination:path,error:false});router.replace(path,{scroll:false});
  }).catch(()=>{if(active)setResolution({key,destination:null,error:true})});
  return()=>{active=false};
 },[key,status,verifyingTelegram,explicitReturn,arrived,waiting,queryIdentity,id,router]);
 if(!waiting||status!=='authenticated')return children;
 if(resolution?.key===key&&resolution.error)return <main id="main" className="payment-resume-error"><h1>{language==='am'?'ክፍያውን መክፈት አልተቻለም':'Could not open this payment'}</h1><p>{language==='am'?'ክፍያውን በጀመሩበት መለያ ይግቡ።':'Use the account that started this checkout.'}</p><Link href={returnPath!}>{language==='am'?'እንደገና ክፈት':'Try again'}</Link><Link href="/payments" onClick={()=>{handled.current=key;setResolution(null)}}>{language==='am'?'ግብይቶች':'View Transactions'}</Link></main>;
 return <LaunchSplash/>;
}
