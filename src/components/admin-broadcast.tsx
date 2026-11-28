'use client';
import {useEffect,useRef,useState} from 'react';
import {Send,Megaphone,AlertCircle} from 'lucide-react';
import {adminRequest} from './admin-query';
import {AdminActionToast,notifyAdminAction} from './admin-action-toast';
import {TELEGRAM_CHANNEL_BUTTON} from '@/lib/telegram-community';
import styles from './admin-broadcast.module.css';

const command=<T,>(action:string,input:unknown)=>adminRequest<T>('command',{action,input});
const acceptedImage=['image/jpeg','image/png','image/webp'];
const imageInputError='Choose a JPEG, PNG or WebP image up to 2 MiB.';
export type BroadcastDraft={id:string;text:string;auctionCode:string;imageId:string|null;buttonLabel?:string;miniAppPath?:string;auctionId?:string;draftHash?:string;imagePath?:string|null;title?:string};
const destinations=[['/','Home'],['/my-bids','My bids'],['/winners','Winners'],['/profile','Profile']];
export function AdminBroadcast({initial,onQueued}:{initial?:BroadcastDraft;onQueued?:()=>void}){
 const [text,setText]=useState(initial?.text??''),[buttonLabel,setButtonLabel]=useState(initial?.buttonLabel??'Open Lowwin'),[miniAppPath,setMiniAppPath]=useState((initial?.miniAppPath==='/auctions/all'?'/':initial?.miniAppPath)||(initial?.auctionCode?`/auctions/${initial.auctionCode}`:'/'));
 const [file,setFile]=useState<File|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[queued,setQueued]=useState(false),[key,setKey]=useState(''),[imageId,setImageId]=useState<string|undefined>(initial?.imageId??undefined),[preview,setPreview]=useState<string|undefined>(),pending=useRef(false),imageInput=useRef<HTMLInputElement>(null);
 const [productImage,setProductImage]=useState(initial?.imagePath??undefined);
 const invalidImage=!!file&&(!acceptedImage.includes(file.type)||file.size===0||file.size>2097152);
 useEffect(()=>{if(!file||invalidImage){setPreview(imageId?`/api/media/${imageId}`:productImage);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file,invalidImage,imageId,productImage]);
 const change=()=>{setKey('');setReview(false);setQueued(false);setError('')};
 function selectImage(next:File|null,useProduct=false){
  setFile(next);setImageId(undefined);setProductImage(useProduct?initial?.imagePath??undefined:undefined);change();
  if(!next&&imageInput.current)imageInput.current.value='';
 }
 async function send(){
  if(pending.current||invalidImage||!text.trim()||!buttonLabel.trim())return;pending.current=true;setBusy(true);setError('');const requestKey=key||crypto.randomUUID();setKey(requestKey);
  try{
   let media=imageId;
   if(file&&!media){
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Image could not be read.'));reader.readAsDataURL(file)});
    const uploaded=await command<{id:string}>('media',{key:crypto.randomUUID(),mime:file.type,data,sourceType:'SUPPLIED',sourceCredit:'Administrator supplied broadcast image',rightsConfirmed:true});media=uploaded.id;setImageId(media);
   }
   if(initial?.auctionId){
    await command('auctionBroadcast',{key:requestKey,auctionId:initial.auctionId,draftHash:initial.draftHash,
     ...(text.trim()!==initial.text.trim()?{text}:{}),buttonLabel,...(productImage?{}:{imageId:media??null}),
     reason:'Administrator reviewed auction promotion',confirmation:'SEND'});
   }else{
    await command('broadcast',{key:requestKey,text,buttonLabel,miniAppPath,...(media?{imageId:media}:{}),reason:'Administrator reviewed Telegram broadcast',confirmation:'SEND'});
   }
   notifyAdminAction('Broadcast queued for Telegram.');setQueued(true);setReview(false);onQueued?.();
  }catch(e){setError(e instanceof Error?e.message:'Broadcast could not be queued.')}finally{pending.current=false;setBusy(false)}
 }
 return <div className={styles.layout}>
  <section className={`admin-form ${styles.composer}`} aria-label="Compose broadcast">
   <div className={styles.heading}><Megaphone size={20}/><h2>{initial?.auctionId?'Promote this auction':'New message'}</h2></div>
   {initial?.auctionId&&<p className={styles.auctionTitle}>{initial.title}</p>}
   <label>Message<textarea value={text} maxLength={700} rows={5} disabled={busy||queued} placeholder="What would you like players to know?" onChange={e=>{setText(e.target.value);change()}}/><small>{text.length}/700 · Use {'{name}'} to greet each player by name.</small></label>
   <details className={styles.options}><summary>Image &amp; button</summary>
    <label>Image<input ref={imageInput} type="file" accept={acceptedImage.join(',')} disabled={busy||queued} onChange={e=>{const next=e.target.files?.[0];if(next)selectImage(next)}}/><small>JPEG, PNG or WebP up to 2 MiB</small></label>
    <div className="admin-actions">
     {(productImage||file||imageId)&&<button type="button" className="admin-text-button" disabled={busy||queued} onClick={()=>selectImage(null)}>Remove image</button>}
     {initial?.imagePath&&!productImage&&<button type="button" className="admin-text-button" disabled={busy||queued} onClick={()=>selectImage(null,true)}>Use product photo</button>}
    </div>
    <div className={initial?.auctionId?undefined:'admin-two'}>
     <label>Button text<input value={buttonLabel} disabled={busy||queued} maxLength={40} onChange={e=>{setButtonLabel(e.target.value);change()}}/>{initial?.auctionId&&<small>Opens auction #{initial.auctionCode}</small>}</label>
     {!initial?.auctionId&&<label>Open page<select value={miniAppPath} disabled={busy||queued} onChange={e=>{setMiniAppPath(e.target.value);change()}}>{destinations.map(([path,label])=><option key={path} value={path}>{label}</option>)}{!destinations.some(([path])=>path===miniAppPath)&&<option value={miniAppPath}>Linked auction</option>}</select></label>}
    </div>
   </details>
   <p className={styles.help}>Sends to eligible players who have started the bot. Blocked chats and staff are excluded.</p>
   {review?<div className={styles.confirm}><p>Send this message to all eligible Telegram recipients?</p><div className="admin-actions"><button disabled={busy||queued} onClick={()=>void send()}><Send size={16}/>{busy?'Queuing…':'Send to players'}</button><button className="secondary" disabled={busy} onClick={()=>setReview(false)}>Back</button></div></div>:<button disabled={busy||invalidImage||!text.trim()||!buttonLabel.trim()||queued} onClick={()=>setReview(true)}><Send size={16}/>Review &amp; send</button>}
   {invalidImage&&<p role="alert" className={styles.error}><AlertCircle size={16} aria-hidden="true"/>{imageInputError}</p>}<AdminActionToast message={error} kind="error"/>
  </section>
  <aside className={styles.preview} aria-label="Broadcast preview"><h2>Telegram preview</h2><div className={styles.message}>{preview&&<img src={preview} alt="Broadcast product preview"/>}<p>{text?text.replaceAll('{name}','Abebe'):'Your message will appear here.'}</p><span>{buttonLabel||'Open LowWin'}</span><span lang="am">{TELEGRAM_CHANNEL_BUTTON.text}</span></div></aside>
 </div>;
}
