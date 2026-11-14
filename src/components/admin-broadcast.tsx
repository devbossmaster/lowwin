'use client';
import {useEffect,useRef,useState} from 'react';
import {Send,Check,Megaphone,AlertCircle} from 'lucide-react';
import styles from './admin-broadcast.module.css';

async function command(action:string,input:unknown){
 const response=await fetch('/api/admin/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store'});
 const body=await response.json();if(!response.ok){const reference=typeof body.traceId==='string'&&/^[0-9a-f-]{36}$/i.test(body.traceId)?` Reference: ${body.traceId}`:'';throw Error((body.error??'Broadcast could not be queued.')+reference)}return body;
}
export type BroadcastDraft={id:string;text:string;auctionCode:string;imageId:string|null;buttonLabel?:string;miniAppPath?:string;auctionId?:string;draftHash?:string;imagePath?:string;title?:string};
const destinations=[['/','Home'],['/auctions/all','Auctions'],['/my-bids','My bids'],['/winners','Winners'],['/profile','Profile']];
export function AdminBroadcast({initial,onQueued}:{initial?:BroadcastDraft;onQueued?:()=>void}){
 const [text,setText]=useState(initial?.text??''),[buttonLabel,setButtonLabel]=useState(initial?.buttonLabel??'Open Lowwin'),[miniAppPath,setMiniAppPath]=useState(initial?.miniAppPath||(initial?.auctionCode?`/auctions/${initial.auctionCode}`:'/'));
 const [file,setFile]=useState<File|null>(null),[rights,setRights]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[key,setKey]=useState(''),[imageId,setImageId]=useState<string|undefined>(initial?.imageId??undefined),[preview,setPreview]=useState<string|undefined>(),pending=useRef(false);
 useEffect(()=>{if(!file){setPreview(imageId?`/api/media/${imageId}`:initial?.imagePath);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file,imageId,initial?.imagePath]);
 const change=()=>{setKey('');setReview(false);setResult('')};
 async function send(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');const requestKey=key||crypto.randomUUID();setKey(requestKey);
  try{
   let media=imageId;
   if(file&&!media){
    if(!rights)throw Error('Confirm permission to use the image.');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)throw Error('Choose a JPEG, PNG or WebP image up to 2 MiB.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Image could not be read.'));reader.readAsDataURL(file)});
    const uploaded=await command('media',{key:crypto.randomUUID(),mime:file.type,data,sourceType:'SUPPLIED',sourceCredit:'Administrator supplied broadcast image',rightsConfirmed:true});media=uploaded.id;setImageId(media);
   }
   await command(initial?.auctionId?'auctionBroadcast':'broadcast',initial?.auctionId?{key:requestKey,auctionId:initial.auctionId,draftHash:initial.draftHash,reason:'Administrator reviewed auction promotion',confirmation:'SEND'}:{key:requestKey,text,buttonLabel,miniAppPath,...(media?{imageId:media}:{}),reason:'Administrator reviewed Telegram broadcast',confirmation:'SEND'});
   setResult('Queued. Delivery progress appears below.');setReview(false);onQueued?.();
  }catch(e){setError(e instanceof Error?e.message:'Broadcast could not be queued.')}finally{pending.current=false;setBusy(false)}
 }
 return <div className={styles.layout}>
  <section className={`admin-form ${styles.composer}`} aria-label="Compose broadcast">
   <div className={styles.heading}><Megaphone size={20}/><h2>{initial?.auctionId?'Promote this auction':'New message'}</h2></div>
   {initial?.auctionId?<><p className={styles.auctionTitle}>{initial.title}</p><p className={styles.help}>Product photo, invitation and Bid button are ready. Review the preview before sending.</p></>:<label>Message<textarea value={text} maxLength={700} rows={5} disabled={busy||!!result} placeholder="What would you like players to know?" onChange={e=>{setText(e.target.value);change()}}/><small>{text.length}/700 · Optional: {'{name}'}</small></label>}
   {!initial?.auctionId&&<details className={styles.options}><summary>Image &amp; button</summary><label>Image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||!!result} onChange={e=>{setFile(e.target.files?.[0]??null);setImageId(undefined);setRights(false);change()}}/><small>JPEG, PNG or WebP · up to 2 MiB</small></label>{(file||imageId)&&<button type="button" className="admin-text-button" disabled={busy} onClick={()=>{setFile(null);setImageId(undefined);setRights(false);change()}}>Remove image</button>}{file&&<label className="admin-check"><input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/>I have permission to use this image.</label>}<div className="admin-two"><label>Button text<input value={buttonLabel} disabled={busy||!!result} maxLength={40} onChange={e=>{setButtonLabel(e.target.value);change()}}/></label><label>Open page<select value={miniAppPath} disabled={busy||!!result} onChange={e=>{setMiniAppPath(e.target.value);change()}}>{destinations.map(([path,label])=><option key={path} value={path}>{label}</option>)}{!destinations.some(([path])=>path===miniAppPath)&&<option value={miniAppPath}>Linked auction</option>}</select></label></div></details>}
   <p className={styles.help}>Sends to eligible players who have started the bot. Blocked chats and staff are excluded.</p>
   {review?<div className={styles.confirm}><p>Send this message to all eligible Telegram recipients?</p><div className="admin-actions"><button disabled={busy||!!result} onClick={()=>void send()}><Send size={16}/>{busy?'Queuing…':'Send to players'}</button><button className="secondary" disabled={busy} onClick={()=>setReview(false)}>Back</button></div></div>:<button disabled={busy||!text.trim()||!buttonLabel.trim()||!!file&&!rights||!!result} onClick={()=>{setReview(true);setResult('')}}><Send size={16}/>Review &amp; send</button>}
   {error&&<p role="alert" className={styles.error}><AlertCircle size={16} aria-hidden="true"/>{error}</p>}{result&&<p role="status" className={styles.queued}><Check size={16}/>{result}</p>}
  </section>
  <aside className={styles.preview} aria-label="Broadcast preview"><h2>Telegram preview</h2><div className={styles.message}>{preview&&<img src={preview} alt="Broadcast product preview"/>}<p>{text?text.replaceAll('{name}','Abebe'):'Your message will appear here.'}</p><span>{buttonLabel||'Open LowWin'}</span></div></aside>
 </div>;
}
