'use client';
import {Suspense} from 'react';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';
import {CatalogImagePreview} from './catalog-image';
import {MiniNavigationMemory} from './mini-navigation-memory';

export function AppShell({children,requireLaunch=false,demoProductImage=false}:{children:React.ReactNode;requireLaunch?:boolean;demoProductImage?:boolean}){
 const {status}=useTelegram();
 if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
 return <CatalogImagePreview enabled={demoProductImage}><div className="app-frame">
  <Suspense fallback={null}><MiniNavigationMemory/></Suspense>
  <MiniHeader/>
  <main id="main">{children}</main>
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div></CatalogImagePreview>;
}
