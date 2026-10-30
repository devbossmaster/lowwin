'use client';
import {useEffect,useRef,useState} from 'react';
import {ImagePlus,Send} from 'lucide-react';

async function command(action:string,input:unknown){
 const response=await fetch('/api/admin/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store'});
 const body=await response.json();if(!response.ok){const reference=typeof body.traceId==='string'&&/^[0-9a-f-]{36}$/i.test(body.traceId)?` Reference: ${body.traceId}`:'';throw Error((body.error??'Broadcast could not be queued.')+reference)}return body;
}
export type BroadcastDraft={id:string;text:string;auctionCode:string;imageId:string|null;buttonLabel?:string;miniAppPath?:string};
const destinations=[['/','Home'],['/auctions/all','Auctions'],['/my-bids','My bids'],['/winners','Winners'],['/profile','Profile']];
export function AdminBroadcast({initial,onQueued}:{initial?:BroadcastDraft;onQueued?:()=>void}){
 const [text,setText]=useState(initial?.text??''),[buttonLabel,setButtonLabel]=useState(initial?.buttonLabel??'Open Lowwin'),[miniAppPath,setMiniAppPath]=useState(initial?.miniAppPath||(initial?.auctionCode?`/auctions/${initial.auctionCode}`:'/'));
 const [file,setFile]=useState<File|null>(null),[rights,setRights]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[key,setKey]=useState(''),[imageId,setImageId]=useState<string|undefined>(initial?.imageId??undefined),[preview,setPreview]=useState<string|undefined>(),pending=useRef(false);
 useEffect(()=>{if(!file){setPreview(imageId?`/api/media/${imageId}`:undefined);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file,imageId]);
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
   const receipt=await command('broadcast',{key:requestKey,text,buttonLabel,miniAppPath,...(media?{imageId:media}:{}),reason:'Administrator reviewed Telegram broadcast',confirmation:'SEND'});
   setResult(`Queued for ${receipt.audience} Telegram recipients.`);setReview(false);onQueued?.();
  }catch(e){setError(e instanceof Error?e.message:'Broadcast could not be queued.')}finally{pending.current=false;setBusy(false)}
 }
 return <div className="master-broadcast-layout"><section className="admin-panel admin-form master-broadcast-form"><h2>New broadcast</h2><p>Send an image and message through the Telegram bot.</p><label>Message<textarea value={text} maxLength={700} rows={6} disabled={busy} placeholder="Write your update…" onChange={e=>{setText(e.target.value);change()}}/></label><small>{text.length}/700 · Use {'{name}'} for the recipient's name.</small><label>Image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setImageId(undefined);setRights(false);change()}}/><small>JPEG, PNG or WebP · up to 2 MiB</small></label>{(file||imageId)&&<button type="button" className="admin-text-button" disabled={busy} onClick={()=>{setFile(null);setImageId(undefined);setRights(false);change()}}>Remove image</button>}{file&&<label className="admin-check"><input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/>I have permission to use this image.</label>}<div className="admin-two"><label>Button text<input value={buttonLabel} disabled={busy} maxLength={40} onChange={e=>{setButtonLabel(e.target.value);change()}}/></label><label>Open page<select value={miniAppPath} disabled={busy} onChange={e=>{setMiniAppPath(e.target.value);change()}}>{destinations.map(([path,label])=><option key={path} value={path}>{label}</option>)}{!destinations.some(([path])=>path===miniAppPath)&&<option value={miniAppPath}>Linked auction</option>}</select></label></div>{review?<div className="master-send-confirm"><p>Send this broadcast to Telegram recipients?</p><div className="admin-actions"><button disabled={busy||!!result} onClick={()=>void send()}><Send size={16}/>{busy?'Queuing…':'Send broadcast'}</button><button className="secondary" disabled={busy} onClick={()=>setReview(false)}>Keep editing</button></div></div>:<button disabled={busy||!text.trim()||!buttonLabel.trim()||!!file&&!rights} onClick={()=>{setReview(true);setResult('')}}>Review broadcast</button>}{error&&<p role="alert" className="admin-error">{error}</p>}{result&&<p role="status" className="admin-notice">{result}</p>}</section><aside className="master-message-preview" aria-label="Broadcast preview"><h2>Preview</h2><div className="master-telegram-message">{preview?<img src={preview} alt="Broadcast attachment preview"/>:<div className="master-image-placeholder"><ImagePlus size={25}/><span>Optional image</span></div>}<p>{text?text.includes('{name}')?text.replaceAll('{name}','Abebe'):`Abebe,\n${text}`:'Your message will appear here.'}</p><span className="master-preview-button">{buttonLabel||'Open Lowwin'}</span></div><p>Telegram bot only.</p></aside></div>;
}
