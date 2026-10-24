'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {CatalogQuery,listAuctions} from '@/modules/auctions/catalog';
import {AuctionCard} from './auction-card';
import {MiniPhrase} from './mini-locale';
import {usePrivateQuery} from './private-query';
import styles from './home-banner.module.css';
type Batch=Awaited<ReturnType<typeof listAuctions>>;
export function homeAuctionHref(query:CatalogQuery,patch:Partial<CatalogQuery>={}){
 const next={...query,...patch},params=new URLSearchParams();if(next.category)params.set('category',next.category);if(next.sort!=='code')params.set('sort',next.sort);if(next.q)params.set('q',next.q);return '/'+(params.size?'?'+params:'');
}
export function HomeAuctions({initial,query}:{initial:Batch;query:CatalogQuery}){
 const [items,setItems]=useState(initial.items),[serverNow,setServerNow]=useState(initial.serverNow),[page,setPage]=useState(1),[totalPages,setTotalPages]=useState(initial.totalPages),[busy,setBusy]=useState(false),pending=useRef(false);
 const params=new URLSearchParams({view:'home',status:'live',sort:query.sort,page:String(page),...(query.category?{category:query.category}:{}),...(query.q?{q:query.q}:{})});
 const batch=usePrivateQuery<Batch>('/api/catalog/auctions?'+params,{enabled:page>1});
 useEffect(()=>{if(page<=1||!batch.data)return;const data=batch.data;setItems(previous=>{const codes=new Set(previous.map(item=>item.code));return [...previous,...data.items.filter(item=>!codes.has(item.code))]});setServerNow(new Date(Date.parse(data.serverNow)+Math.max(0,Date.now()-batch.updatedAt)).toISOString());setTotalPages(data.totalPages);pending.current=false;setBusy(false)},[batch.data,batch.updatedAt,page]);
 useEffect(()=>{if(batch.error){pending.current=false;setBusy(false)}},[batch.error]);
 const sorts=[['code','Default','መደበኛ'],['ending','Ends soon','በቅርቡ የሚዘጋ'],['newest','New','አዲስ'],['fee-low','Lowest fee','ዝቅተኛ ክፍያ'],['fee-high','Highest fee','ከፍተኛ ክፍያ']] as const;
 return <section id="discover-auctions" className={styles.section}><h2 className={styles.feedTitle}><MiniPhrase en="Live auctions" am="ክፍት ጨረታዎች"/></h2><nav className={styles.sortChips} aria-label="Auction sorting">{sorts.map(([value,en,am])=><Link key={value} aria-current={query.sort===value?'page':undefined} href={homeAuctionHref(query,{sort:value})}><MiniPhrase en={en} am={am}/></Link>)}</nav><div className={styles.list}>{items.map(item=><AuctionCard key={item.code} auction={item} serverNow={serverNow}/>)}</div>{!items.length&&<p className={styles.empty}><MiniPhrase en="No live auctions in this category yet. Choose another category or check back soon." am="በዚህ ምድብ ክፍት ጨረታ ገና የለም። ሌላ ምድብ ይምረጡ ወይም በቅርቡ ይመለሱ።"/></p>}{batch.error?<div role="alert" className={styles.loadMore}><p><MiniPhrase en="Could not load more auctions." am="ተጨማሪ ጨረታዎችን ማምጣት አልተቻለም።"/></p><button onClick={()=>batch.reload()}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>:(page<totalPages||busy)&&<div className={styles.loadMore}><button disabled={busy} onClick={()=>{if(pending.current)return;pending.current=true;setBusy(true);setPage(value=>value+1)}}><MiniPhrase en={busy?'Loading…':'Load more'} am={busy?'በመጫን ላይ…':'ተጨማሪ አሳይ'}/></button></div>}</section>;
}
