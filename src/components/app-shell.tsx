'use client';
import {Suspense,useEffect} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {BottomNavigation} from './bottom-navigation';
import Link from 'next/link';
import {isPublicMiniPage} from '@/lib/mini-public-routes';
import {customerLoginPath} from '@/lib/customer-login-entry';
import {MiniPhrase} from './mini-locale';
import {CustomerPageHeader} from './customer-page-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';
import {CatalogImagePreview} from './catalog-image';
import {MiniNavigationMemory} from './mini-navigation-memory';
import {LegacyAccountActions} from './legacy-account-actions';
import {LoaderCircle,LogIn,RotateCcw,UserRound} from 'lucide-react';
import styles from './app-shell.module.css';
import {MiniAccountAction} from './mini-account-action';

export function AppShell({children,requireLaunch=false,demoProductImage=false}:{children:React.ReactNode;requireLaunch?:boolean;demoProductImage?:boolean}){
 const {status,me,queryIdentity,openRegistration,environment,retry}=useTelegram(),path=usePathname(),router=useRouter();
 const registered=status==='authenticated'&&!!me?.user?.id&&!!queryIdentity;
 const protectedPage=requireLaunch&&!isPublicMiniPage(path)&&!registered;
 const restoreFailed=environment==='browser'&&status==='error';
 // The router may restore a page from memory after its session was revoked.
 useEffect(()=>{
  if(protectedPage&&environment==='browser'&&status==='guest')router.replace(customerLoginPath(path+window.location.search+window.location.hash));
 },[environment,path,protectedPage,router,status]);
 return <CatalogImagePreview enabled={demoProductImage}><div className="app-frame" data-app-environment={environment} data-customer-registered={registered?'true':'false'}>
  <Suspense fallback={null}><MiniNavigationMemory/></Suspense>
  <Suspense fallback={null}><LegacyAccountActions/></Suspense>
  {path!=='/'&&<CustomerPageHeader/>}
  <main id="main">{protectedPage?status==='loading'?<div className={styles.restoring} role="status" aria-busy="true"><LoaderCircle size={18} aria-hidden="true"/><MiniPhrase en="Restoring your account…" am="መለያዎ በማስመለስ ላይ…"/></div>:<section className={styles.accountGate}>
   <span className={styles.accountIcon} aria-hidden="true"><UserRound size={25} strokeWidth={1.6}/></span><h2><MiniPhrase en="Your Lowwin account" am="የLowwin መለያዎ"/></h2>
   {restoreFailed?<><p role="alert"><MiniPhrase en="Your account could not load. Check your connection and try again." am="መለያዎ ሊጫን አልቻለም። ግንኙነትዎን ያረጋግጡና እንደገና ይሞክሩ።"/></p><button className={styles.login} type="button" onClick={retry}><RotateCcw size={17} aria-hidden="true"/><MiniPhrase en="Retry connection" am="ግንኙነቱን ይሞክሩ"/></button></>:<>
    <p><MiniPhrase en={environment==='mini'?"Share your own Telegram contact to use your account and wallet. You can keep browsing.":"Log in to see your personal details. You can keep browsing auctions."} am={environment==='mini'?"መለያዎንና ዋሌትዎን ለመጠቀም የራስዎን የTelegram ስልክ ቁጥር ያጋሩ። መመልከት መቀጠል ይችላሉ።":"የግል መረጃዎን ለማየት ይግቡ። ጨረታዎችን መመልከት መቀጠል ይችላሉ።"}/></p>
    {environment==='mini'?<MiniAccountAction className={styles.login}/>:<button className={styles.login} type="button" onClick={openRegistration}><LogIn size={17} aria-hidden="true"/><MiniPhrase en="Log in" am="ይግቡ"/></button>}
   </>}
   <Link className={styles.browse} href="/"><MiniPhrase en="Browse auctions" am="ጨረታዎችን ይመልከቱ"/></Link>
  </section>:children}</main>
  {path!=='/profile'&&<TelegramSupportLink aboveBidAction={/^\/auctions\/[^/]+$/.test(path)}/>}
  <BottomNavigation/>
 </div></CatalogImagePreview>;
}
