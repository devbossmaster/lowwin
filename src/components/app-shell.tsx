'use client';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {useTelegram} from './telegram-provider';
import {TelegramSupportLink} from './telegram-support-link';

export function AppShell({children,requireLaunch=false}:{children:React.ReactNode;requireLaunch?:boolean}){
 const {status}=useTelegram();
 if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
 return <div className="app-frame">
  <MiniHeader/>
  <main id="main">{children}</main>
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div>;
}
