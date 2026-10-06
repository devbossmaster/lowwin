'use client';

import {Search} from 'lucide-react';
import {useMiniLocale} from '@/components/mini-locale';
import type {CatalogQuery} from '@/modules/auctions/catalog';
import styles from './auctions-page.module.css';

type Category={slug:string;name:string;nameAm:string|null};

export function AuctionFilters({query,categories}:{query:CatalogQuery;categories:Category[]}){
 const {language}=useMiniLocale(),am=language==='am';
 return <form key={`${query.q}|${query.category}|${query.sort}|${query.status}`} className={styles.filters} action="/auctions/all" method="get" role="search">
  <input type="hidden" name="status" value={query.status}/>
  <div className={styles.search}><Search size={18} aria-hidden="true"/><input name="q" type="search" defaultValue={query.q} maxLength={80} enterKeyHint="search" aria-label={am?'ጨረታዎችን ፈልግ':'Search auctions'} placeholder={am?'ዕቃ ወይም የጨረታ ኮድ':'Product or auction code'}/></div>
  <div className={styles.selects}>
   <label>{am?'ምድብ':'Category'}<select name="category" defaultValue={query.category??''}><option value="">{am?'ሁሉም ምድቦች':'All categories'}</option>{categories.map(category=><option key={category.slug} value={category.slug}>{am?(category.nameAm?.trim()||category.name):category.name}</option>)}</select></label>
   <label>{am?'ቅደም ተከተል':'Sort'}<select name="sort" defaultValue={query.sort}><option value="code">{am?'የጨረታ ኮድ':'Auction code'}</option><option value="ending">{am?'በቅርቡ የሚያበቃ':'Ending soon'}</option><option value="newest">{am?'አዲስ':'Newest'}</option><option value="title">{am?'የዕቃ ስም':'Item name'}</option></select></label>
  </div>
  <button className={styles.apply} type="submit">{am?'ፈልግ':'Search auctions'}</button>
 </form>;
}
