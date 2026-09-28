import {redirect} from 'next/navigation';
import {getMiniSession} from '@/modules/auth/mini-access';
import {headers} from 'next/headers';
import {TelegramProvider} from '@/components/telegram-provider';
import {AppShell} from '@/components/app-shell';
import {MiniLocaleProvider} from '@/components/mini-locale';
import {MiniNoticeProvider} from '@/components/mini-notice';
import {assertLocalIdentitySurface} from '@/modules/auth/local-identity';
export default async function MiniLayout({children}:{children:React.ReactNode}){
  let devEnabled=false;try{assertLocalIdentitySurface(new Headers(await headers()));devEnabled=true}catch{}
  let authorized=false;
  if(!devEnabled){try{authorized=!!await getMiniSession(new Headers(await headers()))}catch{}if(!authorized)redirect('/telegram')}
  const username=process.env.TELEGRAM_BOT_USERNAME;
  const botUrl=username&&/^[A-Za-z0-9_]+bot$/i.test(username)?`https://t.me/${username}?start=lowin`:null;
  return <MiniLocaleProvider><MiniNoticeProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl} requireLaunch={!devEnabled}><AppShell requireLaunch={!devEnabled}>{children}</AppShell></TelegramProvider></MiniNoticeProvider></MiniLocaleProvider>;
}
