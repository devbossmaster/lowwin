'use client';
import {Suspense,type ReactNode} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {readPrivateQuery} from './private-query-cache';
import {MiniRouteSkeleton} from './mini-route-skeleton';
import {MyBidsPage} from './my-bids-page';
import {WinningBidsPage} from './winning-bids-page';
import Profile from '@/app/(mini)/profile/page';
import Favorites from '@/app/(mini)/profile/favorites/page';
import Alerts from '@/app/(mini)/profile/alerts/page';
import Wallet from '@/app/(mini)/wallet/page';

function RouteSnapshot(){
 const path=usePathname(),params=useSearchParams(),{status,queryIdentity}=useTelegram();
 const has=(url:string)=>status==='authenticated'&&!!queryIdentity&&!!readPrivateQuery(queryIdentity,url);
 const rawPage=Number(params.get('page')??1),page=Number.isSafeInteger(rawPage)&&rawPage>0?Math.min(rawPage,10000):1;
 let snapshot:ReactNode=null;
 if(path==='/profile'&&has('/api/profile'))snapshot=<Profile/>;
 if(path==='/profile/favorites'&&has('/api/favorites?page='+page))snapshot=<Favorites/>;
 if(path==='/profile/alerts'&&has('/api/alerts?page='+page))snapshot=<Alerts/>;
 if(path==='/my-bids'&&has('/api/my-bids?view='+(params.get('view')==='history'?'history':'live')+'&page='+page))snapshot=<MyBidsPage/>;
 if(path==='/winning-bids'&&has('/api/profile/wins?page='+page))snapshot=<WinningBidsPage/>;
 if(path==='/wallet'&&has('/api/wallet?page='+page)&&has('/api/wallet/top-ups?page=1')){
  const funding=readPrivateQuery<{options?:{enabled:boolean}}>(queryIdentity!,'/api/wallet/top-ups?page=1')?.value;
  const deposits=Number(params.get('depositsPage')??1);
  if(has('/api/wallet/top-ups?page='+deposits)&&(funding?.options?.enabled!==false||has('/api/wallet/preview')))snapshot=<Wallet/>;
 }
 // Reuse the real page and the same private cache, never a second response/DOM
 // cache. During the short RSC handoff, disallow mutations in this snapshot;
 // shared header/navigation remain interactive outside this boundary.
 return snapshot?<div inert>{snapshot}</div>:<MiniRouteSkeleton/>;
}
export function MiniRouteLoading(){return <Suspense fallback={<MiniRouteSkeleton/>}><RouteSnapshot/></Suspense>}
