'use client';
import {preinit} from 'react-dom';
import {usePathname} from 'next/navigation';
import {TELEGRAM_SDK_URL} from '@/lib/telegram-sdk-client';
import {TelegramProvider} from './telegram-provider';
import {MiniQueryProvider} from './mini-query-provider';

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null}){
 const path=usePathname();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preinit(TELEGRAM_SDK_URL,{as:'script',fetchPriority:'high'});
 return <MiniQueryProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl} requireLaunch={!devEnabled}>{children}</TelegramProvider></MiniQueryProvider>;
}
