import {getMiniSession} from '@/modules/auth/mini-access';
import {headers} from 'next/headers';
import {AppShell} from '@/components/app-shell';
import {MiniNoticeProvider} from '@/components/mini-notice';
import {assertLocalIdentitySurface} from '@/modules/auth/local-identity';
import {TelegramEntry} from '@/components/telegram-entry';
export default async function MiniLayout({children}:{children:React.ReactNode}){
  let devEnabled=false;try{assertLocalIdentitySurface(new Headers(await headers()));devEnabled=true}catch{}
  let authorized=false;
  if(!devEnabled){try{authorized=!!await getMiniSession(new Headers(await headers()))}catch{}}
  if(!devEnabled&&!authorized)return <MiniNoticeProvider><TelegramEntry/></MiniNoticeProvider>;
  return <MiniNoticeProvider><AppShell requireLaunch={!devEnabled}>{children}</AppShell></MiniNoticeProvider>;
}
