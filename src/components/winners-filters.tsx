'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Search} from 'lucide-react';
import {MiniSelect} from './mini-select';
import {useMiniLocale} from './mini-locale';
import styles from './winners-page.module.css';

type Query={q:string;category:string;sort:string;pageSize:number};
export function WinnersFilters({query,categories}:{query:Query;categories:{slug:string;name:string}[]}){
  const router=useRouter(),{language}=useMiniLocale(),am=language==='am';
  const [search,setSearch]=useState(query.q),[pending,startTransition]=useTransition();
  const navigate=(changes:Partial<Query>)=>{
    const next={...query,q:search,...changes};
    const params=new URLSearchParams({q:next.q.trim(),category:next.category,sort:next.sort,pageSize:String(next.pageSize)});
    startTransition(()=>router.push(`/winners/all?${params}`));
  };
  return <div className={styles.controls} aria-busy={pending}>
    <form className={styles.search} action="/winners/all" onSubmit={event=>{event.preventDefault();navigate({q:search})}}>
      <Search size={18} aria-hidden="true"/><input name="q" aria-label={am?'ውጤቶችን ፈልግ':'Search auctions'} placeholder={am?'ጨረታ ወይም ኮድ ይፈልጉ…':'Search auctions, codes…'} value={search} onChange={event=>setSearch(event.target.value)} maxLength={80} enterKeyHint="search"/>
    </form>
    <MiniSelect label={am?'ምድብ':'Category'} value={query.category} disabled={pending} options={[{value:'',label:am?'ሁሉም ምድቦች':'All Categories'},...categories.map(category=>({value:category.slug,label:category.name}))]} onChange={category=>navigate({category})}/>
    <MiniSelect label={am?'ቅደም ተከተል':'Sort order'} value={query.sort} disabled={pending} options={[{value:'newest',label:am?'አዲስ በቅድሚያ':'Newest First'},{value:'oldest',label:am?'የቆየ በቅድሚያ':'Oldest First'},{value:'title',label:am?'የዕቃ ስም':'Item Name'}]} onChange={sort=>navigate({sort})}/>
    <MiniSelect label={am?'በገጽ የሚታዩ ውጤቶች':'Results per page'} value={String(query.pageSize)} disabled={pending} options={[12,24,48,96].map(value=>({value:String(value),label:String(value)}))} onChange={pageSize=>navigate({pageSize:Number(pageSize)})}/>
  </div>;
}
