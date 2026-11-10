'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ImagePlus,RotateCcw} from 'lucide-react';
import {ErrorNotice,useAdminMutation} from './admin-ui';
import {WINNER_IMAGE_HEIGHT,WINNER_IMAGE_WIDTH} from '@/lib/winner-image';
import styles from './admin-winner-photo.module.css';

export type WinnerPhotoRecord={auctionId:string;winnerPresentationMode?:string;winnerBannerPath?:string|null;winnerBannerId?:string|null;winnerBannerVersion?:number;winnerPhotoPath?:string|null;winnerPhotoId?:string|null;winnerPhotoVersion?:number};
export default function AdminWinnerPhoto({winner,onSaved}:{winner:WinnerPhotoRecord;onSaved:()=>void}){
 const mutation=useAdminMutation(),pending=useRef(false),heading=useId(),help=useId();
 const [file,setFile]=useState<File|null>(null),[imageId,setImageId]=useState<string|null>(null),[preview,setPreview]=useState<string|null>(null),[consent,setConsent]=useState(false),[reason,setReason]=useState('Update Winners presentation banner'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!file){setPreview(null);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
 async function save(reset=false){
  if(pending.current||!reset&&(!file||!consent||reason.trim().length<5))return;
  pending.current=true;setBusy(true);setError('');
  try{
   let media=reset?null:imageId;
   if(!reset&&file&&!media){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)throw Error('Choose a JPEG, PNG or WebP image up to 2 MiB.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('The banner could not be read. Choose it again.'));reader.readAsDataURL(file)});
    const uploaded=await mutation.run<{id:string}>('media',{mime:file.type,data,purpose:'WINNER_BANNER',sourceType:'SUPPLIED',sourceCredit:'Administrator supplied Winners presentation banner',rightsConfirmed:true});
    if(!uploaded)return;media=uploaded.id;setImageId(media);
   }
   const saved=await mutation.run('winnerBanner',{auctionId:winner.auctionId,version:winner.winnerBannerVersion??winner.winnerPhotoVersion??0,imageId:media,...(!reset?{consentConfirmed:true}:{}),reason:reset?'Restore original product image in Winners':reason.trim()});
   if(saved)onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:'The Winners banner could not be saved. Try again.')}finally{pending.current=false;setBusy(false)}
 }
 const shown=preview??winner.winnerBannerPath,hasOverride=Boolean(winner.winnerBannerId||winner.winnerPhotoId);
 return <section className={styles.panel} aria-labelledby={heading}>
  <h3 id={heading}>Winners banner</h3>
  <p>Results publish automatically with the product image. A banner changes only the Winners presentation; it does not change the result or send another announcement.</p>
  <p id={help}>Upload a complete {WINNER_IMAGE_WIDTH} × {WINNER_IMAGE_HEIGHT} banner (2.3:1), including any artwork or text you want shown. Images are center-cropped without stretching and saved as WebP.</p>
  {shown&&<figure className={styles.previewFigure}><div className={styles.preview} data-winner-banner-preview><img src={shown} width={WINNER_IMAGE_WIDTH} height={WINNER_IMAGE_HEIGHT} alt={preview?'Selected complete Winners banner preview':'Saved complete Winners banner'}/></div><figcaption>The complete banner appears in Winners. Original product and past-draw images stay unchanged.</figcaption></figure>}
  {!shown&&winner.winnerPhotoId&&<p>Existing photograph layout retained. Uploading a complete banner replaces its display without deleting the original photograph.</p>}
  <form className="admin-form" onSubmit={event=>{event.preventDefault();void save()}}>
   <label>Choose Winners banner<input type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={help} disabled={busy} onChange={event=>{setFile(event.currentTarget.files?.[0]??null);setImageId(null);setConsent(false);setError('');mutation.clear()}}/><small>JPEG, PNG or WebP · up to 2 MiB · {WINNER_IMAGE_WIDTH} × {WINNER_IMAGE_HEIGHT} WebP output.</small></label>
   {file&&<><label className="admin-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.currentTarget.checked)}/>I have permission to use this banner and consent from anyone identifiable in it.</label><label>Update note<input value={reason} onChange={event=>setReason(event.currentTarget.value)} disabled={busy} minLength={5} maxLength={500} required/></label><button disabled={busy||!consent||reason.trim().length<5}><ImagePlus size={16} aria-hidden="true"/>{busy?'Saving banner…':hasOverride?'Replace Winners banner':'Save Winners banner'}</button></>}
  </form>
  {hasOverride&&<button type="button" className="secondary" disabled={busy} onClick={()=>void save(true)}><RotateCcw size={16} aria-hidden="true"/>{busy?'Saving…':'Use product image again'}</button>}
  <ErrorNotice error={error||mutation.error}/>
 </section>;
}