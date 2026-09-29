'use client';
import {useState} from 'react';
import {MiniPhrase} from './mini-locale';

async function command(action:string,input:unknown){
 const response=await fetch('/api/admin/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input})});
 const body=await response.json();if(!response.ok)throw Error(body.error??'Broadcast could not be queued.');return body;
}
export function AdminBroadcast(){
 const [text,setText]=useState(''),[code,setCode]=useState(''),[file,setFile]=useState<File|null>(null),[rights,setRights]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[key,setKey]=useState(''),[imageId,setImageId]=useState<string|undefined>();
 const change=()=>{setKey('');setReview(false);setResult('')};
 async function send(){
  if(busy)return;setBusy(true);setError('');const requestKey=key||crypto.randomUUID();setKey(requestKey);
  try{
   let media=imageId;
   if(file&&!media){
    if(!rights)throw Error('Confirm permission to use the image.');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)throw Error('Choose a JPEG, PNG or WebP image up to 2 MiB.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Image could not be read.'));reader.readAsDataURL(file)});
    const uploaded=await command('media',{key:crypto.randomUUID(),mime:file.type,data,sourceType:'SUPPLIED',sourceCredit:'Owner supplied broadcast image',rightsConfirmed:true});
    media=uploaded.id;setImageId(media);
   }
   const receipt=await command('broadcast',{key:requestKey,text,...(code?{auctionCode:code}:{}),...(media?{imageId:media}:{}),reason:'Owner reviewed informative broadcast',confirmation:'SEND'});
   setResult(`Queued for ${receipt.audience} eligible users. Delivery progress is listed below.`);setReview(false);
  }catch(e){setError(e instanceof Error?e.message:'Broadcast could not be queued.')}finally{setBusy(false)}
 }
 return <section className="admin-panel admin-form"><h2><MiniPhrase en="Manual broadcast" am="በእጅ የሚላክ ማሳወቂያ"/></h2>
  <p><MiniPhrase en="Send an informative message to all players who have started the private bot. Each message includes their name and a Bid button. Automatic alerts cover new auctions, the last day, results and successful deposits." am="የግል ቦቱን ለጀመሩ ተጫዋቾች ሁሉ መረጃ ይላኩ። እያንዳንዱ መልዕክት ስማቸውንና የጨረታ ቁልፍ ይይዛል። አዲስ ጨረታ፣ የመጨረሻው ቀን፣ ውጤትና የተሳካ ገቢ ማሳወቂያዎች በራስ-ሰር ይላካሉ።"/></p>
  <label><MiniPhrase en="Message — use {name} to insert the recipient’s name" am="መልዕክት — የተቀባዩን ስም ለማስገባት {name} ይጠቀሙ"/><textarea value={text} maxLength={700} rows={5} disabled={busy} onChange={e=>{setText(e.target.value);change()}}/></label><small>{text.length}/700</small>
  <label><MiniPhrase en="Auction code (optional; blank opens all auctions)" am="የጨረታ ኮድ (አማራጭ፤ ባዶ ከተዉት ሁሉንም ጨረታዎች ይከፍታል)"/><input inputMode="numeric" value={code} disabled={busy} onChange={e=>{setCode(e.target.value);change()}}/></label>
  <label><MiniPhrase en="Optional image — JPEG, PNG or WebP, up to 2 MiB" am="አማራጭ ምስል — JPEG፣ PNG ወይም WebP፣ እስከ 2 MiB"/><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setImageId(undefined);setRights(false);change()}}/></label>
  {file&&<label className="admin-check"><input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/><MiniPhrase en="I have permission to use this image." am="ይህን ምስል ለመጠቀም ፈቃድ አለኝ።"/></label>}
  {review?<div className="admin-notice"><h3><MiniPhrase en="Message preview" am="የመልዕክት ቅድመ እይታ"/></h3>{file&&<p>{file.name}</p>}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text.includes('{name}')?text.replaceAll('{name}','Abebe'):`Abebe,\n${text}`}</p><p>Bid → {code?`Auction #${code}`:'All auctions'}</p><p><MiniPhrase en="This queues real messages. Already delivered messages cannot be recalled." am="ይህ እውነተኛ መልዕክቶችን ለመላክ ያስቀምጣል። የተላኩ መልዕክቶችን መመለስ አይቻልም።"/></p><button disabled={busy||!!result} onClick={()=>void send()}><MiniPhrase en={busy?'Queuing…':'Queue broadcast'} am={busy?'በመዘጋጀት ላይ…':'ለሁሉም ለመላክ አስቀምጥ'}/></button></div>:<button disabled={busy||!text.trim()||!!file&&!rights} onClick={()=>{setReview(true);setResult('')}}><MiniPhrase en="Preview broadcast" am="የመልዕክቱን ቅድመ እይታ አሳይ"/></button>}
  {error&&<p role="alert" className="admin-error">{error}</p>}{result&&<p role="status">{result}</p>}
 </section>;
}
