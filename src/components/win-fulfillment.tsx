'use client';
import {useState} from 'react';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';

type Fulfillment={auctionId:string;state:string;tracking:string};
export function WinFulfillment({auctionId,isDemo}:{auctionId:string;isDemo:boolean}){
 const {language}=useMiniLocale(),am=language==='am',t=(en:string,amharic:string)=>am?amharic:en;
 const query=usePrivateQuery<Fulfillment[]>('/api/fulfillment');
 const row=query.data?.find(item=>item.auctionId===auctionId),claim=!row||['PENDING','CLAIMED'].includes(row.state);
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const stateText:Record<string,string>={PENDING:t('Pending','በመጠባበቅ ላይ'),CLAIMED:t('Claimed','ጥያቄ ቀርቧል'),SHIPPED:t('Shipped','ተልኳል'),DELIVERED:t('Delivered','ደርሷል'),DISPUTED:t('Disputed','ክርክር ቀርቧል')};
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{const response=await fetch('/api/fulfillment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId,action:claim?'claim':'dispute',...(claim?{name:form.get('name'),phone:form.get('phone'),address:form.get('address')}:{reason:form.get('reason')})})});if(!response.ok)throw Error();query.reload();setOpen(false)}catch{setError(t('Could not save the delivery request. Retry.','የርክክብ ጥያቄውን ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።'))}finally{setBusy(false)}
 }
 return <div className="win-fulfillment">
  <p><strong>{t('Fulfillment','ርክክብ')}: {stateText[row?.state??'PENDING']??row?.state}</strong>{isDemo?t(' · DEMO test, no real shipment.',' · የDEMO ሙከራ፣ እውነተኛ ርክክብ የለም።'):''}</p>
  {row?.tracking&&<p>{t('Shipment reference','የጭነት ማጣቀሻ')}: {row.tracking}</p>}
  {query.error&&<p role="alert">{t('Delivery details are unavailable. Retry.','የርክክብ ዝርዝር አይገኝም። እንደገና ይሞክሩ።')}</p>}
  <button className="text-link" type="button" onClick={()=>setOpen(!open)}>{open?t('Close delivery form','የርክክብ ቅጹን ዝጋ'):claim?t('Claim / update delivery contact','የርክክብ መረጃ አስገባ / አዘምን'):t('Report a delivery issue','የርክክብ ችግር ሪፖርት አድርግ')}</button>
  {open&&<form className="support-form" onSubmit={submit}>{claim?<>
   <p>{isDemo?t('Use fictional contact details for this DEMO. ','ለዚህ DEMO የሙከራ መረጃ ይጠቀሙ። '):''}{t('Delivery contact never changes your login identity.','የርክክብ መረጃ የመግቢያ ማንነትዎን አይለውጥም።')}</p>
   <label>{t('Recipient name','የተቀባይ ስም')}<input name="name" required maxLength={100}/></label>
   <label>{t('Delivery phone','የርክክብ ስልክ')}<input name="phone" type="tel" required maxLength={40}/></label>
   <label>{t('Delivery address','የርክክብ አድራሻ')}<textarea name="address" required maxLength={500}/></label>
   <small>{t('Only the Owner and assigned fulfillment staff can read this contact. Deleted 30 days after delivery.','ይህን መረጃ ባለቤቱና የተመደቡ የርክክብ ሠራተኞች ብቻ ያያሉ። ከርክክብ 30 ቀናት በኋላ ይሰረዛል።')}</small>
  </>:<label>{t('Dispute reason','የቅሬታ ምክንያት')}<textarea name="reason" required minLength={5} maxLength={500}/></label>}<button className="primary-button" disabled={busy}>{busy?t('Saving…','በማስቀመጥ ላይ…'):t('Save delivery request','የርክክብ ጥያቄ አስቀምጥ')}</button></form>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
