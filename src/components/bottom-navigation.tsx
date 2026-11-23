'use client';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {Ticket} from 'lucide-react';
import {activeCustomerNavigation,customerNavigationItems as items} from './customer-navigation-items';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {rememberedMiniVisit} from './mini-navigation-state';
import {AuctionQuickList} from './auction-quick-list';
import {prefetchMiniIntent} from './mini-prefetch';
import {isPrivateQueryIdentity,miniReadsBusy} from './private-query-cache';

const destinations=['/','/my-bids','bid','/winners','/profile'] as const;

export function BottomNavigation(){
 const path=usePathname(),router=useRouter(),{queryIdentity,status,me}=useTelegram();
 const registered=status==='authenticated'&&!!me?.user?.id&&!!queryIdentity;
 const active=activeCustomerNavigation(path);
 useEffect(()=>{
  if(!registered||!queryIdentity||(active!=='/'&&active!=='/winners'))return;
  const destination=active==='/winners'?'/my-bids':'/winners';
  let timer:number,attempts=0;
  const warm=()=>{
   if(document.visibilityState!=='visible'||!isPrivateQueryIdentity(queryIdentity))return;
   if(miniReadsBusy()){
    if(++attempts<3)timer=window.setTimeout(warm,750);
    return;
   }
   const href=rememberedMiniVisit(queryIdentity,destination)?.href??destination;
   prefetchMiniIntent(queryIdentity,href,url=>router.prefetch(url));
  };
  timer=window.setTimeout(warm,850);
  return()=>window.clearTimeout(timer);
 },[active,queryIdentity,registered,router]);
 if(!registered)return null;
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{destinations.map(destination=>{
  if(destination==='bid')return <div key="bid" className={styles.bidItem} data-bid="true"><AuctionQuickList className={styles.bidButton}/><span className={styles.label}><MiniPhrase en="Bid" am="ይጫረቱ"/></span></div>;
  const {href,en,am,icon}=items.find(item=>item.href===destination)!;
  const Icon=href==='/my-bids'?Ticket:icon;
  const content=<><span className={styles.icon}><Icon size={20} strokeWidth={1.8} aria-hidden="true"/></span><span className={styles.label}><MiniPhrase en={href==='/profile'?'Me':en} am={href==='/profile'?'እኔ':am}/></span></>;
  const saved=rememberedMiniVisit(queryIdentity,href);
  const linkProps={href:saved?.href??href,scroll:saved&&saved.scrollY>0?false:undefined,className:styles.item,"aria-current":active===href?'page' as const:undefined,children:content};
  return <IntentPrefetchLink key={href} {...linkProps}/>;
 })}</nav>;
}
