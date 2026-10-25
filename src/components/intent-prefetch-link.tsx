'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback,type ComponentProps} from 'react';
import {useTelegram} from './telegram-provider';
import {prefetchMiniIntent} from './mini-prefetch';
import {rememberCurrentMiniRoute} from './mini-navigation-state';

type Props=ComponentProps<typeof Link>;

/** Prefetch a route only when a user shows intent to open it. */
export function IntentPrefetchLink({href,...props}:Props){
  const router=useRouter(),{queryIdentity}=useTelegram();
  const target=typeof href==='string'?href.split('#',1)[0]||'/':(href.pathname??'/')+(href.query?'?'+new URLSearchParams(Object.entries(href.query).map(([key,value])=>[key,String(value)])).toString():'');
  const prefetch=useCallback(()=>{
    if(target===location.pathname+location.search)return;
    prefetchMiniIntent(queryIdentity,target,url=>router.prefetch(url));
  },[router,target,queryIdentity]);
  const intentHandlers={
    onPointerEnter:(event:React.PointerEvent<HTMLAnchorElement>)=>{props.onPointerEnter?.(event);prefetch()},
    onFocus:(event:React.FocusEvent<HTMLAnchorElement>)=>{props.onFocus?.(event);prefetch()},
    onTouchStart:(event:React.TouchEvent<HTMLAnchorElement>)=>{props.onTouchStart?.(event);prefetch()},
    onClick:(event:React.MouseEvent<HTMLAnchorElement>)=>{props.onClick?.(event);if(!event.defaultPrevented)rememberCurrentMiniRoute(queryIdentity)},
  };
  return <Link {...props} href={href} prefetch={false} {...intentHandlers}/>;
}
