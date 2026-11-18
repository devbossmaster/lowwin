'use client';
import {useMiniLocale} from './mini-locale';
import styles from './notifications-inbox.module.css';

function Bone({className=''}:{className?:string}){
 return <span className={`${styles.skeletonBone} ${className}`}/>;
}

/** Reserve the inbox rows inside the sheet, independently of the page beneath it. */
export function NotificationsInboxSkeleton({showFilters=false}:{showFilters?:boolean}={}){
 const {language}=useMiniLocale();
 return <div className={styles.inbox} data-notifications-skeleton role="status" aria-busy="true">
  <span className="sr-only">{language==='am'?'ማሳወቂያዎችን በመጫን ላይ…':'Loading notifications…'}</span>
  <div aria-hidden="true">
   {showFilters&&<div className={`${styles.filters} ${styles.skeletonFilters}`}><Bone/><Bone/><Bone/></div>}
   <div className={styles.tools}><Bone className={styles.skeletonCount}/><Bone className={styles.skeletonBulkAction}/></div>
   <div className={styles.list}>
    {Array.from({length:5},(_,index)=><div className={`${styles.notification} ${styles.skeletonRow}`} key={index} data-notification-skeleton-row>
     <Bone className={styles.icon}/>
     <div className={styles.content}>
      <div className={`${styles.heading} ${styles.skeletonHeading}`}><Bone className={styles.skeletonTitle}/></div>
      <div className={styles.skeletonBody}><Bone/><Bone/></div>
      <div className={`${styles.meta} ${styles.skeletonMeta}`}><Bone className={styles.skeletonTime}/><Bone className={styles.skeletonReadAction}/></div>
     </div>
    </div>)}
   </div>
  </div>
 </div>;
}
