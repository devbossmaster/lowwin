'use client';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';
import {CatalogImagePreview} from './catalog-image';

export function AppShell({children,requireLaunch=false,demoProductImage=false}:{children:React.ReactNode;requireLaunch?:boolean;demoProductImage?:boolean}){
 const {status}=useTelegram();
 if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
 return <CatalogImagePreview enabled={demoProductImage}><div className="app-frame">
  <MiniHeader/>
  <main id="main">{children}</main>
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div></CatalogImagePreview>;
}
