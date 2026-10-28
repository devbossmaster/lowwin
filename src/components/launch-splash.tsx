import {LoadingSpinner} from './loading-spinner';
import {MiniPhrase} from './mini-locale';

export function BrandedLaunchLoading({complete=false}:{complete?:boolean}){
 return <div className="branded-launch-loading" role="status" aria-busy={!complete}><LoadingSpinner decorative/><p><MiniPhrase en="Loading…" am="በመጫን ላይ…"/></p></div>;
}

export function LaunchSplash({complete=false}:{complete?:boolean}){
 return <main id="main" className="telegram-entry launch-loader" aria-busy={!complete}><BrandedLaunchLoading complete={complete}/></main>;
}
