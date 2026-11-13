'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {miniNavigationState} from './mini-navigation-state';
import {activeCustomerNavigation,customerNavigationItems} from './customer-navigation-items';
import styles from './browser-navigation.module.css';

export function BrowserNavigation(){
 const path=usePathname(),{queryIdentity}=useTelegram(),{language}=useMiniLocale();
 const active=activeCustomerNavigation(path);
 return <aside className={styles.rail} data-browser-navigation>
  <Link href="/" className={styles.brand} aria-label="Lowwin Home"><img src={LOWWIN_LOGO_SRC} alt="" width={34} height={34}/><span>Lowwin</span></Link>
  <nav aria-label={language==='am'?'ዋና አሰሳ':'Main navigation'}>{customerNavigationItems.map(({href,en,am,icon:Icon})=>{
   const saved=miniNavigationState.visit(queryIdentity,href);
   return <IntentPrefetchLink key={href} href={saved?.href??href} scroll={saved&&saved.scrollY>0?false:undefined} aria-current={active===href?'page':undefined}><Icon size={20} strokeWidth={1.7} aria-hidden="true"/><MiniPhrase en={en} am={am}/></IntentPrefetchLink>;
  })}</nav>
  <div className={styles.help}><Link href="/how-it-works"><MiniPhrase en="How Lowwin works" am="Lowwin እንዴት ይሰራል"/></Link><Link href="/faq"><MiniPhrase en="Help & answers" am="እገዛ እና መልሶች"/></Link></div>
 </aside>;
}
