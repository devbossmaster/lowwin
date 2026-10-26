'use client';
import {Suspense} from 'react';
import {usePathname} from 'next/navigation';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {CustomerPageHeader} from './customer-page-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';
import {CatalogImagePreview} from './catalog-image';
import {MiniNavigationMemory} from './mini-navigation-memory';
import {LegacyAccountActions} from './legacy-account-actions';

export function AppShell({children,requireLaunch=false,demoProductImage=false}:{children:React.ReactNode;requireLaunch?:boolean;demoProductImage?:boolean}){
 const {status}=useTelegram(),path=usePathname();
 if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
 return <CatalogImagePreview enabled={demoProductImage}><div className="app-frame">
  <Suspense fallback={null}><MiniNavigationMemory/></Suspense>
  <Suspense fallback={null}><LegacyAccountActions/></Suspense>
  {path!=='/'&&<CustomerPageHeader/>}
  <main id="main">{children}</main>
  {path!=='/profile'&&<TelegramSupportLink aboveBidAction={/^\/auctions\/[^/]+$/.test(path)&&path!=='/auctions/all'}/>}
  <BottomNavigation/>
 </div></CatalogImagePreview>;
}
