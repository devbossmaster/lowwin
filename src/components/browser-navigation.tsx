'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {LOWWIN_BRAND_NAME} from '@/lib/brand';
import {BrandMark} from './brand-mark';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {rememberedMiniVisit} from './mini-navigation-state';
import {activeCustomerNavigation,customerNavigationItems} from './customer-navigation-items';
import styles from './browser-navigation.module.css';

export function BrowserNavigation(){
 const path=usePathname(),{status,me,queryIdentity}=useTelegram();
 if(path==='/'||status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 return <header className={styles.bar} data-browser-navigation>
  <Link href="/" className={styles.brand} aria-label="LowWin Home"><BrandMark/><span>{LOWWIN_BRAND_NAME}</span></Link>
  <CustomerNavigation/>
 </header>;
}

/** Shared links only; Home keeps its existing single set of account controls. */
export function CustomerNavigation({className}:{className?:string}={}){
 const path=usePathname(),{status,me,queryIdentity}=useTelegram(),{language}=useMiniLocale();
 const active=activeCustomerNavigation(path);
 // Visibility follows server-confirmed registration, never SDK/contact callbacks.
 // Route/API authorization remains independently enforced on the server.
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 return <nav className={`${styles.links} ${className??''}`} data-customer-navigation aria-label={language==='am'?'ዋና አሰሳ':'Main navigation'}>{customerNavigationItems.map(({href,en,am,icon:Icon})=>{
   const saved=rememberedMiniVisit(queryIdentity,href);
   return <IntentPrefetchLink key={href} href={saved?.href??href} scroll={saved&&saved.scrollY>0?false:undefined} aria-current={active===href?'page':undefined}><Icon size={20} strokeWidth={1.7} aria-hidden="true"/><MiniPhrase en={en} am={am}/></IntentPrefetchLink>;
  })}</nav>;
}
