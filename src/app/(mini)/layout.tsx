import {headers} from 'next/headers';
import {Suspense} from 'react';
import {MiniIntroduction} from '@/components/mini-introduction';
import {AppShell} from '@/components/app-shell';
import {MiniNoticeProvider} from '@/components/mini-notice';
import {assertLocalIdentitySurface} from '@/modules/auth/local-identity';
import {stagingDemoEnabled} from '@/modules/auctions/staging-demo';
export default async function MiniLayout({children}:{children:React.ReactNode}){
  let devEnabled=false;try{assertLocalIdentitySurface(new Headers(await headers()));devEnabled=true}catch{}
  return <MiniNoticeProvider><AppShell requireLaunch={!devEnabled} demoProductImage={stagingDemoEnabled()}>{children}</AppShell><Suspense fallback={null}><MiniIntroduction/></Suspense></MiniNoticeProvider>;
}
