'use client';
import {preload} from 'react-dom';
import {usePathname} from 'next/navigation';
import {TelegramProvider} from './telegram-provider';
import {useMiniLocale} from './mini-locale';

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null}){
 const path=usePathname(),{language}=useMiniLocale();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preload('https://telegram.org/js/telegram-web-app.js',{as:'script',fetchPriority:'high'});
 if(path==='/'||path==='/telegram')preload(language==='am'?'/fonts/noto-serif-ethiopic-banner.woff2':'/fonts/sora-latin-800.woff2',{as:'font',type:'font/woff2',crossOrigin:'anonymous',fetchPriority:'low'});
 return <TelegramProvider devEnabled={devEnabled} botUrl={botUrl} requireLaunch={!devEnabled}>{children}</TelegramProvider>;
}
