import {Suspense} from 'react';
import {MiniPhrase} from '@/components/mini-locale';
import {WinnersClientList,WinnersListLoading} from '@/components/winners-client-list';
import {OfflineRetry} from '@/components/offline-retry';
import styles from '@/components/account-pages.module.css';
export default function Winners(){
 return <><OfflineRetry/><section className={styles.page}><p className={styles.subtitle}><MiniPhrase en="Confirmed results from completed auctions." am="ከተጠናቀቁ ጨረታዎች የተረጋገጡ ውጤቶች።"/></p><Suspense fallback={<WinnersListLoading/>}><WinnersClientList/></Suspense></section></>;
}
