'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback,useRef,type ComponentProps} from 'react';

type Props=ComponentProps<typeof Link>;

/** Prefetch a route only when a user shows intent to open it. */
export function IntentPrefetchLink({href,...props}:Props){
  const router=useRouter(),lastIntent=useRef(0);
  const target=(typeof href==='string'?href:href.pathname??'/').split('#',1)[0]||'/';
  const prefetch=useCallback(()=>{
    const now=Date.now();
    if(now-lastIntent.current<700)return;
    lastIntent.current=now;
    router.prefetch(target);
  },[router,target]);
  const intentHandlers={
    onPointerEnter:(event:React.PointerEvent<HTMLAnchorElement>)=>{props.onPointerEnter?.(event);prefetch()},
    onFocus:(event:React.FocusEvent<HTMLAnchorElement>)=>{props.onFocus?.(event);prefetch()},
    onTouchStart:(event:React.TouchEvent<HTMLAnchorElement>)=>{props.onTouchStart?.(event);prefetch()},
  };
  return <Link {...props} href={href} prefetch={false} {...intentHandlers}/>;
}
