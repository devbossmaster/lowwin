import {useEffect,useState} from 'react';
import {Check} from 'lucide-react';
import {AdminPhoto} from './admin-catalog';
import type {MiniLanguage} from './mini-locale';

export type AdminAuctionProduct={
 id:string;title:string;titleAm?:string|null;slug?:string;condition?:string;isDemo?:boolean;
 category?:{name:string;nameAm?:string|null};images?:{path:string}[];
};

export function auctionProductTitle(product:AdminAuctionProduct,language:MiniLanguage){
 return language==='am'?product.titleAm?.trim()||product.title:product.title;
}

export function AdminAuctionProductPicker({products,value,onChange,onFind,language='en',disabled=false}:{
 products:AdminAuctionProduct[];value:string;onChange:(id:string)=>void;
 onFind:(query:string)=>Promise<void>;language?:MiniLanguage;disabled?:boolean;
}){
 const [query,setQuery]=useState(''),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState(false);
 const phrase=(en:string,am:string)=>language==='am'?am:en;
 const term=query.trim().toLowerCase();
 const matches=term?products.filter(product=>[product.title,product.titleAm,product.slug,product.category?.name,product.category?.nameAm]
  .some(value=>value?.toLowerCase().includes(term))).slice(0,8):[];

 useEffect(()=>{
  if(!term||disabled){setSearching(false);setSearchError(false);return}
  let active=true;
  setSearching(true);setSearchError(false);
  const timer=setTimeout(()=>{
   void onFind(term).catch(()=>{if(active)setSearchError(true)}).finally(()=>{if(active)setSearching(false)});
  },250);
  return()=>{active=false;clearTimeout(timer)};
 },[term,onFind,disabled]);

 return <>
  <div className="auction-product-search">
   <label>{phrase('Find product','ምርት ይፈልጉ')}<input value={query} onChange={event=>{event.stopPropagation();setQuery(event.target.value)}} placeholder={phrase('Type a product name','የምርት ስም ይጻፉ')} autoComplete="off" disabled={disabled} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault()}}/></label>
   {term&&<div className="auction-product-matches" aria-live="polite" aria-busy={searching}>
    {matches.map(product=><button type="button" key={product.id} className={product.id===value?'is-selected':''} disabled={disabled} onClick={()=>{onChange(product.id);setQuery('')}}>
     <AdminPhoto src={product.images?.[0]?.path}/><span><strong>{auctionProductTitle(product,language)}</strong><small>{language==='am'?product.category?.nameAm||product.category?.name:product.category?.name}{product.isDemo?' · DEMO':''}</small></span>{product.id===value&&<Check size={17} aria-label={phrase('Selected','ተመርጧል')}/>}
    </button>)}
    {searching?<p>{phrase('Searching…','በመፈለግ ላይ…')}</p>:searchError?<p role="alert">{phrase('Search is unavailable. Choose from the product list below.','ፍለጋ አልተሳካም። ከዚህ በታች ካለው ዝርዝር ይምረጡ።')}</p>:!matches.length&&<p>{phrase('No matching products.','ተዛማጅ ምርት የለም።')}</p>}
   </div>}
  </div>
  <label>{phrase('Product','ምርት')}<select name="productId" value={value} onChange={event=>{event.stopPropagation();onChange(event.target.value)}} required disabled={disabled}>
   <option value="">{phrase('Select a product','ምርት ይምረጡ')}</option>
   {products.map(product=><option key={product.id} value={product.id}>{auctionProductTitle(product,language)}{product.isDemo?' · DEMO':''}</option>)}
  </select></label>
 </>;
}
