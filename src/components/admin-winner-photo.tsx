'use client';
import {useEffect,useRef,useState} from 'react';
import {ImagePlus,RotateCcw} from 'lucide-react';
import {ErrorNotice,useAdminMutation} from './admin-ui';
import styles from './admin-winner-photo.module.css';

export type WinnerPhotoRecord={auctionId:string;winnerPhotoPath?:string|null;winnerPhotoId?:string|null;winnerPhotoVersion?:number};
export default function AdminWinnerPhoto({winner,onSaved}:{winner:WinnerPhotoRecord;onSaved:()=>void}){
 const mutation=useAdminMutation(),pending=useRef(false);
 const [file,setFile]=useState<File|null>(null),[imageId,setImageId]=useState<string|null>(null),[preview,setPreview]=useState<string|null>(null),[consent,setConsent]=useState(false),[reason,setReason]=useState('Prize handover photo'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!file){setPreview(null);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
 async function save(reset=false){
  if(pending.current)return;
  if(!reset&&(!file||!consent||reason.trim().length<5))return;
  pending.current=true;setBusy(true);setError('');
  try{
   let media=reset?null:imageId;
   if(!reset&&file&&!media){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)throw Error('Choose a JPEG, PNG or WebP image up to 2 MiB.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('The photo could not be read. Choose it again.'));reader.readAsDataURL(file)});
    const uploaded=await mutation.run<{id:string}>('media',{mime:file.type,data,purpose:'WINNER_PHOTO',sourceType:'SUPPLIED',sourceCredit:'Administrator supplied winner photograph',rightsConfirmed:true});
    if(!uploaded)return;media=uploaded.id;setImageId(media);
   }
   const saved=await mutation.run('winnerPhoto',{auctionId:winner.auctionId,version:winner.winnerPhotoVersion??0,imageId:media,...(!reset?{consentConfirmed:true}:{}),reason:reset?'Restore product image in winner announcement':reason.trim()});
   if(saved)onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:'The winner photo could not be saved. Try again.')}finally{pending.current=false;setBusy(false)}
 }
 return <section className={styles.panel} aria-labelledby="winner-photo-heading">
  <h3 id="winner-photo-heading">Winner photo</h3>
  <p>The result banner uses the product image until you add a photo. You can save a photo before publishing the result. The calculated winner stays unchanged.</p>
  {(preview||winner.winnerPhotoPath)&&<img className={styles.preview} src={preview??winner.winnerPhotoPath!} alt={preview?'Selected winner photo preview':'Published winner photo'}/>}
  <form className="admin-form" onSubmit={event=>{event.preventDefault();void save()}}>
   <label>Choose winner photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{setFile(event.currentTarget.files?.[0]??null);setImageId(null);setConsent(false);setError('');mutation.clear()}}/><small>JPEG, PNG or WebP · up to 2 MiB. Leave space around the person.</small></label>
   {file&&<><label className="admin-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.currentTarget.checked)}/>The winner agreed to publish this photo, and I have permission to use it.</label><label>Update note<input value={reason} onChange={event=>setReason(event.currentTarget.value)} disabled={busy} minLength={5} maxLength={500} required placeholder="Prize handover photo"/></label><button disabled={busy||!consent||reason.trim().length<5}><ImagePlus size={16}/>{busy?'Saving photo…':winner.winnerPhotoId?'Replace winner photo':'Save winner photo'}</button></>}
  </form>
  {winner.winnerPhotoId&&<button type="button" className="secondary" disabled={busy} onClick={()=>void save(true)}><RotateCcw size={16}/>{busy?'Saving…':'Use product image again'}</button>}
  <ErrorNotice error={error||mutation.error}/>
 </section>;
}
