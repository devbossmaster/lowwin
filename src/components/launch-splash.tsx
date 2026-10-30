import {LoadingSpinner} from './loading-spinner';
import {MiniPhrase} from './mini-locale';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';

export function BrandedLaunchLoading({complete=false}:{complete?:boolean}){
 return <div className="branded-launch-loading" role="status" aria-busy={!complete}><img src={LOWWIN_LOGO_SRC} width={56} height={56} alt="Lowwin" fetchPriority="high" decoding="async" data-lowwin-logo/><div className="launch-progress"><LoadingSpinner decorative/><p><MiniPhrase en="Loading…" am="በመጫን ላይ…"/></p></div></div>;
}

export function LaunchSplash({complete=false}:{complete?:boolean}){
 return <main id="main" className="telegram-entry launch-loader" aria-busy={!complete}><BrandedLaunchLoading complete={complete}/></main>;
}
