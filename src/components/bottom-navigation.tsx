'use client';
import {usePathname} from 'next/navigation';
import {activeCustomerNavigation,customerNavigationItems as items} from './customer-navigation-items';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {miniNavigationState} from './mini-navigation-state';

export function BottomNavigation(){
 const path=usePathname(),{queryIdentity,status,me}=useTelegram();
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 const active=activeCustomerNavigation(path);
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{items.map(({href,en,am,icon:Icon})=>{
  const content=<><span className={styles.icon} data-bid={href==='/my-bids'||undefined}><Icon size={20} aria-hidden="true"/></span><span className={styles.label}><MiniPhrase en={en} am={am}/></span></>;
  const saved=miniNavigationState.visit(queryIdentity,href);
  const linkProps={href:saved?.href??href,scroll:saved&&saved.scrollY>0?false:undefined,className:styles.item,"aria-current":active===href?'page' as const:undefined,children:content};
  // Personal routes serialize a client shell, not account data. Only warm
  // the selected route on hover, touch or keyboard focus; API data stays in
  // the identity-scoped private query cache.
  return <IntentPrefetchLink key={href} {...linkProps}/>;
 })}</nav>;
}
