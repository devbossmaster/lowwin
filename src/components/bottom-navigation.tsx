'use client';
import {usePathname} from 'next/navigation';
import {Ticket} from 'lucide-react';
import {activeCustomerNavigation,customerNavigationItems as items} from './customer-navigation-items';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {rememberedMiniVisit} from './mini-navigation-state';
import {AuctionQuickList} from './auction-quick-list';

const destinations=['/','/my-bids','bid','/winners','/profile'] as const;

export function BottomNavigation(){
 const path=usePathname(),{queryIdentity,status,me}=useTelegram();
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 const active=activeCustomerNavigation(path);
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{destinations.map(destination=>{
  if(destination==='bid')return <div key="bid" className={styles.bidItem} data-bid="true"><AuctionQuickList className={styles.bidButton}/><span className={styles.label}><MiniPhrase en="Bid" am="ይጫረቱ"/></span></div>;
  const {href,en,am,icon}=items.find(item=>item.href===destination)!;
  const Icon=href==='/my-bids'?Ticket:icon;
  const content=<><span className={styles.icon}><Icon size={20} strokeWidth={1.8} aria-hidden="true"/></span><span className={styles.label}><MiniPhrase en={href==='/profile'?'Me':en} am={href==='/profile'?'እኔ':am}/></span></>;
  const saved=rememberedMiniVisit(queryIdentity,href);
  const linkProps={href:saved?.href??href,scroll:saved&&saved.scrollY>0?false:undefined,className:styles.item,"aria-current":active===href?'page' as const:undefined,children:content};
  // Personal routes serialize a client shell, not account data. Only warm
  // the selected route on hover, touch or keyboard focus; API data stays in
  // the identity-scoped private query cache.
  return <IntentPrefetchLink key={href} {...linkProps}/>;
 })}</nav>;
}
