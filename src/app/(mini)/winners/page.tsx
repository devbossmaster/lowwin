import {Suspense} from 'react';
import {MiniPhrase} from '@/components/mini-locale';
import {WinnersClientList,WinnersListLoading} from '@/components/winners-client-list';
import {OfflineRetry} from '@/components/offline-retry';
import styles from '@/components/account-pages.module.css';
export default function Winners(){
 return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Winners" am="አሸናፊዎች"/></h1><p><MiniPhrase en="Confirmed results from completed auctions." am="ከተጠናቀቁ ጨረታዎች የተረጋገጡ ውጤቶች።"/></p></header><Suspense fallback={<WinnersListLoading/>}><WinnersClientList/></Suspense></section></>;
}
