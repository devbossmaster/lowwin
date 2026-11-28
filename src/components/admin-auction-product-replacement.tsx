import {useCallback,useId,useRef,useState} from 'react';
import {ArrowRightLeft} from 'lucide-react';
import {adminRequest,AdminLink,useAdminQuery} from './admin-query';
import {AdminPhoto} from './admin-catalog';
import {AdminAuctionProductPicker,auctionProductTitle,type AdminAuctionProduct} from './admin-auction-product-picker';
import {useMiniLocale} from './mini-locale';
import styles from './admin-auction-product-replacement.module.css';

export type AuctionProductReplacement={productId:string;reason:string;confirmation:string};
type Lookup={items:AdminAuctionProduct[]};

export function AdminAuctionProductReplacement({current,publishedTitle,code,isDemo,busy,saving,onSave}:{
 current:AdminAuctionProduct;publishedTitle:string;code:string;isDemo:boolean;busy:boolean;saving:boolean;
 onSave:(selection:AuctionProductReplacement)=>void;
}){
 const {language}=useMiniLocale(),phrase=(en:string,am:string)=>language==='am'?am:en;
 const [selected,setSelected]=useState<AdminAuctionProduct|null>(null),[found,setFound]=useState<AdminAuctionProduct[]>([]);
 const [reason,setReason]=useState(''),[confirmation,setConfirmation]=useState('');
 const captionId=useId(),searchSequence=useRef(0);
 const resource=`products?lookup=1&replacement=${isDemo?'demo':'live'}`;
 const lookup=useAdminQuery<Lookup>(resource);
 const find=useCallback(async(query:string)=>{
  const sequence=++searchSequence.current;
  const {items}=await adminRequest<Lookup>(`${resource}&q=${encodeURIComponent(query)}`);
  if(sequence===searchSequence.current)setFound(items);
 },[resource]);
 const products=[...new Map([...(lookup.data?.items??[]),...found,...(selected?[selected]:[])]
  .filter(product=>product.id!==current.id).map(product=>[product.id,product])).values()];
 const currentTitle=auctionProductTitle(current,language);
 const canSave=!busy&&selected&&reason.trim()&&confirmation.trim()===code;

 return <form className={`admin-form ${styles.form}`} aria-labelledby={captionId} onSubmit={event=>{
  event.preventDefault();
  if(!canSave)return;
  onSave({productId:selected.id,reason:reason.trim(),confirmation:confirmation.trim()});
 }}>
  <header>
   <h3 id={captionId}>{phrase('Replace the auction product','የጨረታውን ምርት ይቀይሩ')}</h3>
   <p>{phrase('This changes the prize and public listing. Existing bids stay on this auction.','ይህ የጨረታውን ሽልማት እና የሚታየውን መረጃ ይቀይራል። የገቡ ጨረታዎች በዚህ ጨረታ ላይ ይቆያሉ።')}</p>
  </header>
  <div className={styles.preview} aria-live="polite">
   <div className={styles.product}>
    <span>{phrase('Current product','የአሁኑ ምርት')}</span>
    <div className="auction-selected-product"><AdminPhoto src={current.images?.[0]?.path}/><div><strong>{currentTitle}</strong>
     {publishedTitle!==currentTitle&&<small>{phrase('Public title','የሚታየው ስም')} · {publishedTitle}</small>}
    </div></div>
   </div>
   <div className={styles.product} data-selected={!!selected}>
    <span>{phrase('Replacement product','ተተኪ ምርት')}</span>
    {selected?<div className="auction-selected-product"><AdminPhoto src={selected.images?.[0]?.path}/><div><strong>{auctionProductTitle(selected,language)}</strong>
     <small>{language==='am'?selected.category?.nameAm||selected.category?.name:selected.category?.name}</small>
    </div></div>:<p>{phrase('Choose a product below.','ከታች ምርት ይምረጡ።')}</p>}
   </div>
  </div>
  <AdminAuctionProductPicker products={products} value={selected?.id??''} onChange={id=>setSelected(products.find(product=>product.id===id)??null)} onFind={find} language={language} disabled={busy}/>
  {lookup.loading&&<small role="status">{phrase('Loading eligible products…','ተስማሚ ምርቶችን በመጫን ላይ…')}</small>}
  {lookup.error&&<div className="admin-error" role="alert">{lookup.error} <button type="button" className="admin-text-button" onClick={lookup.reload}>{phrase('Retry','እንደገና ይሞክሩ')}</button></div>}
  <AdminLink href="/admin/products" target="_blank" rel="noopener noreferrer" className="auction-add-product">{phrase('Manage catalog products','የካታሎግ ምርቶችን ያስተዳድሩ')}</AdminLink>
  <label>{phrase('Reason','ምክንያት')}<textarea value={reason} onChange={event=>setReason(event.target.value)} required maxLength={1000} rows={2} disabled={busy}/></label>
  <label>{phrase(`Type ${code} to confirm`,`ለማረጋገጥ ${code} ይጻፉ`)}<input value={confirmation} onChange={event=>setConfirmation(event.target.value)} required maxLength={100} autoComplete="off" spellCheck={false} disabled={busy}/></label>
  <button type="submit" disabled={!canSave} aria-busy={saving}><ArrowRightLeft size={17} aria-hidden="true"/>{saving?phrase('Replacing product…','ምርቱን በመቀየር ላይ…'):phrase('Replace product','ምርት ቀይር')}</button>
 </form>;
}
