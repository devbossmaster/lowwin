'use client';

import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
import {OfflineRetry} from '@/components/offline-retry';
import {PrivateState,usePrivateQuery} from '@/components/private-query';
import {ReferralShareCard,type ReferralOverview} from '@/components/referral-share-card';
import {useTelegram} from '@/components/telegram-provider';
import styles from '@/components/affiliate-page.module.css';

export default function AffiliatePage(){
 const query=usePrivateQuery<ReferralOverview>('/api/referrals');
 const {queryIdentity}=useTelegram();
 if(query.status==='loading'||(query.status==='authenticated'&&!query.data&&!query.error))return <MiniRouteSkeleton variant="affiliate"/>;
 return <><OfflineRetry/><div className={styles.page} data-affiliate-page>
  <PrivateState query={query}/>
  {query.status==='authenticated'&&query.data&&<ReferralShareCard key={queryIdentity} overview={query.data}/>}
 </div></>;
}
