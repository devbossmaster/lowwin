import {LoadingSpinner} from './loading-spinner';
import {MiniPhrase} from './mini-locale';
export function LaunchSplash({complete=false}:{complete?:boolean}){
 return <main id="main" className="telegram-entry launch-loader" aria-busy={!complete}><LoadingSpinner/><p><MiniPhrase en={complete?'Opening Lowin…':'Connecting securely…'} am={complete?'Lowin በመክፈት ላይ…':'በደህንነት በመገናኘት ላይ…'}/></p></main>;
}
