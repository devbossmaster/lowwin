'use client';
import {Suspense} from 'react';
import {usePathname} from 'next/navigation';
import {BottomNavigation} from './bottom-navigation';
import Link from 'next/link';
import {isPublicMiniPage} from '@/lib/mini-public-routes';
import {MiniPhrase} from './mini-locale';
import {CustomerPageHeader} from './customer-page-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';
import {CatalogImagePreview} from './catalog-image';
import {MiniNavigationMemory} from './mini-navigation-memory';
import {LegacyAccountActions} from './legacy-account-actions';
import {LoaderCircle,LogIn,UserRound} from 'lucide-react';
import styles from './app-shell.module.css';

export function AppShell({children,requireLaunch=false,demoProductImage=false}:{children:React.ReactNode;requireLaunch?:boolean;demoProductImage?:boolean}){
 const {status,openRegistration}=useTelegram(),path=usePathname();
 const protectedPage=requireLaunch&&!isPublicMiniPage(path)&&status!=='authenticated';
 return <CatalogImagePreview enabled={demoProductImage}><div className="app-frame">
  <Suspense fallback={null}><MiniNavigationMemory/></Suspense>
  <Suspense fallback={null}><LegacyAccountActions/></Suspense>
  {path!=='/'&&<CustomerPageHeader/>}
  <main id="main">{protectedPage?status==='loading'?<div className={styles.restoring} role="status"><LoaderCircle size={18} aria-hidden="true"/><MiniPhrase en="Restoring your account…" am="መለያዎ በማስመለስ ላይ…"/></div>:<section className={styles.accountGate}><span className={styles.accountIcon} aria-hidden="true"><UserRound size={25} strokeWidth={1.6}/></span><h2><MiniPhrase en="Your Lowwin account" am="የLowwin መለያዎ"/></h2><p><MiniPhrase en="Log in to see your personal details. You can keep browsing auctions." am="የግል መረጃዎን ለማየት ይግቡ። ጨረታዎችን መመልከት መቀጠል ይችላሉ።"/></p><button className={styles.login} type="button" onClick={openRegistration}><LogIn size={17} aria-hidden="true"/><MiniPhrase en="Log in" am="ይግቡ"/></button><Link className={styles.browse} href="/"><MiniPhrase en="Browse auctions" am="ጨረታዎችን ይመልከቱ"/></Link></section>:children}</main>
  {path!=='/profile'&&<TelegramSupportLink aboveBidAction={/^\/auctions\/[^/]+$/.test(path)&&path!=='/auctions/all'}/>}
  <BottomNavigation/>
 </div></CatalogImagePreview>;
}
