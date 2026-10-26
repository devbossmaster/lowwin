'use client';
import {usePathname,useRouter} from 'next/navigation';
import {ArrowLeft} from 'lucide-react';
import {MiniLanguageMenu} from './mini-language-menu';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {rememberedMiniDestination} from './mini-navigation-state';
import {canGoBackInCustomerApp,customerPageTitle} from '@/lib/customer-navigation';
import styles from './customer-page-header.module.css';

export function CustomerPageHeader(){
 const path=usePathname(),router=useRouter(),{language}=useMiniLocale(),{queryIdentity}=useTelegram();
 const title=customerPageTitle(path),am=language==='am';
 if(path==='/')return null;
 function back(){
  if(canGoBackInCustomerApp(window.history.state,queryIdentity))router.back();
  else router.replace(rememberedMiniDestination(queryIdentity,'/'));
 }
 return <header className={styles.header} aria-label={am?'የገጽ ራስጌ':'Page header'} data-customer-page-header>
  <button type="button" className={styles.back} onClick={back} aria-label={am?'ተመለስ':'Back'}><ArrowLeft size={19} strokeWidth={1.75}/></button>
  <h1>{title[am?1:0]}</h1><div className={styles.language}><MiniLanguageMenu/></div>
 </header>;
}
