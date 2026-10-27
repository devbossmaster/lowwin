'use client';
import {IntentPrefetchLink as Link} from './intent-prefetch-link';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownUp} from 'lucide-react';
import type {CatalogQuery,listAuctions} from '@/modules/auctions/catalog';
import {AuctionCard} from './auction-card';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {isPrivateQueryIdentity,readPrivateQuery,seedPrivateQuery} from './private-query-cache';
import {useTelegram} from './telegram-provider';
import {miniNavigationState} from './mini-navigation-state';
import {catalogBatchUrl} from '@/lib/catalog-query';
import styles from './home-banner.module.css';
type Batch=Awaited<ReturnType<typeof listAuctions>>;
export function homeAuctionHref(query:CatalogQuery,patch:Partial<CatalogQuery>={}){
 const next={...query,...patch},params=new URLSearchParams();if(next.category)params.set('category',next.category);if(next.sort!=='code')params.set('sort',next.sort);if(next.q)params.set('q',next.q);return '/'+(params.size?'?'+params:'');
}
const batchHref=catalogBatchUrl;
function restoredFeed(identity:string|null,initial:Batch,query:CatalogQuery){
 const cached=identity?readPrivateQuery<Batch>(identity,batchHref(query,1)):null;
 const base=cached&&Date.parse(cached.value.serverNow)>=Date.parse(initial.serverNow)?cached.value:initial;
 let items=base.items,page=1,totalPages=base.totalPages,serverNow=base.serverNow,serverObservedAt=cached&&base===cached.value?cached.updatedAt:Date.now();
 const desired=Math.min(miniNavigationState.page(identity,homeAuctionHref(query)),totalPages);
 for(let next=2;identity&&next<=desired;next++){
  const saved=readPrivateQuery<Batch>(identity,batchHref(query,next));if(!saved)break;
  const codes=new Set(items.map(item=>item.code));items=[...items,...saved.value.items.filter(item=>!codes.has(item.code))];page=next;totalPages=saved.value.totalPages;
  serverNow=saved.value.serverNow;serverObservedAt=saved.updatedAt;
 }
 return {items,page,totalPages,serverNow,serverObservedAt};
}
export function HomeAuctions(props:{initial:Batch;query:CatalogQuery}){
 const {queryIdentity}=useTelegram();return <HomeAuctionFeed key={`${queryIdentity??'guest'}:${homeAuctionHref(props.query)}`} {...props} identity={queryIdentity}/>;
}
function HomeAuctionFeed({initial,query,identity}:{initial:Batch;query:CatalogQuery;identity:string|null}){
 const {language}=useMiniLocale(),sortRow=useRef<HTMLElement>(null);
 const [restored]=useState(()=>restoredFeed(identity,initial,query));
 const [items,setItems]=useState(restored.items),[serverNow,setServerNow]=useState(restored.serverNow),[serverObservedAt,setServerObservedAt]=useState(restored.serverObservedAt),[page,setPage]=useState(restored.page),[totalPages,setTotalPages]=useState(restored.totalPages),[busy,setBusy]=useState(false),pending=useRef(false);
 const firstBatch=usePrivateQuery<Batch>(batchHref(query,1),{initialData:initial});
 const batch=usePrivateQuery<Batch>(batchHref(query,page),{enabled:page>1});
 const lastInitial=useRef(initial);
 useEffect(()=>{const data=firstBatch.data;if(!data)return;const codes=new Set(data.items.map(item=>item.code));setItems(previous=>[...data.items,...previous.slice(10).filter(item=>!codes.has(item.code))]);setServerNow(data.serverNow);setServerObservedAt(firstBatch.updatedAt);setTotalPages(data.totalPages)},[firstBatch.data,firstBatch.updatedAt]);
 useEffect(()=>{if(lastInitial.current===initial)return;lastInitial.current=initial;const codes=new Set(initial.items.map(item=>item.code));setItems(previous=>[...initial.items,...previous.slice(10).filter(item=>!codes.has(item.code))]);setServerNow(initial.serverNow);setServerObservedAt(Date.now());setTotalPages(initial.totalPages)},[initial]);
 useEffect(()=>{if(!identity||!isPrivateQueryIdentity(identity))return;const key=batchHref(query,1),saved=readPrivateQuery<Batch>(identity,key);if(!saved||Date.parse(initial.serverNow)>Date.parse(saved.value.serverNow))seedPrivateQuery(identity,key,initial)},[identity,initial,query]);
 useEffect(()=>{miniNavigationState.rememberPage(identity,homeAuctionHref(query),page)},[identity,query,page]);
 useEffect(()=>{const row=sortRow.current,selected=row?.querySelector<HTMLElement>('[aria-current="page"]');if(!row||!selected)return;const left=selected.getBoundingClientRect().left-row.getBoundingClientRect().left;if(left<16)row.scrollLeft+=left-16;else if(left+selected.offsetWidth>row.clientWidth-16)row.scrollLeft+=left+selected.offsetWidth-row.clientWidth+16},[query.sort,language]);
 useEffect(()=>{if(page<=1||!batch.data)return;const data=batch.data;setItems(previous=>{const codes=new Set(previous.map(item=>item.code)),updates=new Map(data.items.map(item=>[item.code,item]));return [...previous.map(item=>updates.get(item.code)??item),...data.items.filter(item=>!codes.has(item.code))]});setServerNow(data.serverNow);setServerObservedAt(batch.updatedAt);setTotalPages(data.totalPages);pending.current=false;setBusy(false)},[batch.data,batch.updatedAt,page]);
 useEffect(()=>{if(batch.error){pending.current=false;setBusy(false)}},[batch.error]);
 const sorts=[['code','Default','መደበኛ'],['ending','Ends soon','በቅርቡ የሚዘጋ'],['newest','New','አዲስ'],['fee-low','Lowest fee','ዝቅተኛ ክፍያ'],['fee-high','Highest fee','ከፍተኛ ክፍያ']] as const;
 return <section id="discover-auctions" className={`${styles.section} ${styles.homeFeed}`}><h2 className={styles.feedTitle}><MiniPhrase en="Live auctions" am="ክፍት ጨረታዎች"/></h2><nav ref={sortRow} className={styles.sortChips} aria-label="Auction sorting">{sorts.map(([value,en,am])=><Link key={value} aria-current={query.sort===value?'page':undefined} href={homeAuctionHref(query,{sort:value})}>{value==='code'&&<ArrowDownUp size={11} aria-hidden="true"/>}<span><MiniPhrase en={en} am={am}/></span></Link>)}</nav><div className={styles.list}>{items.map((item,index)=><AuctionCard key={item.code} auction={item} priority={index===0} serverNow={serverNow} serverObservedAt={serverObservedAt}/>)}</div>{!items.length&&<p className={styles.empty}><MiniPhrase en="No live auctions in this category yet. Choose another category or check back soon." am="በዚህ ምድብ ክፍት ጨረታ ገና የለም። ሌላ ምድብ ይምረጡ ወይም በቅርቡ ይመለሱ።"/></p>}{batch.error?<div role="alert" className={styles.loadMore}><p><MiniPhrase en="Could not load more auctions." am="ተጨማሪ ጨረታዎችን ማምጣት አልተቻለም።"/></p><button onClick={()=>batch.reload()}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>:(page<totalPages||busy)&&<div className={styles.loadMore}><button disabled={busy} onClick={()=>{if(pending.current)return;pending.current=true;setBusy(true);setPage(value=>value+1)}}><MiniPhrase en={busy?'Loading…':'Load more'} am={busy?'በመጫን ላይ…':'ተጨማሪ አሳይ'}/></button></div>}</section>;
}
