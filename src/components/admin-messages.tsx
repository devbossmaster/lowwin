'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Plus,Square,RotateCcw,Trash2} from 'lucide-react';
import {AdminLink,useAdminQuery} from './admin-query';
import {AdminBroadcast,type BroadcastDraft} from './admin-broadcast';
import {useAdminAccess} from './admin-shell';
import {AdminHeading,Empty,ErrorNotice,Pagination,Status,eat,useAdminMutation,useAdminRead,useQueueParams} from './admin-ui';
import {LoadingSpinner} from './loading-spinner';
import styles from './admin-broadcast.module.css';

type Campaign=BroadcastDraft&{createdAt:string;state:string;sent:number;pending:number;failed:number;skipped:number;canStop:boolean;canDelete?:boolean;parentCampaignId?:string|null;pendingBatches:number;failedBatches:number;recipientCount:number;eligibleRecipients?:number;audienceComplete?:boolean;queued?:number;retrying?:number;inFlight?:number;deletion?:{deleted:number;pending:number;failed:number;unavailable:number;preparing:boolean};failureReasons:{blocked:number;invalid:number;exhausted:number;other:number}};
type History={items:Campaign[];total:number;page:number;totalPages:number};
type Confirmation={campaign:Campaign;action:'resend'|'delete'|'stop';resendId:string};
const image=(c:Campaign)=>c.imagePath||(c.imageId?`/api/media/${c.imageId}`:null);

function DeliveryIssues({campaign:c}:{campaign:Campaign}){
 return <>{c.failureReasons?.blocked>0&&<small>{c.failureReasons.blocked} blocked the bot</small>}{c.failureReasons?.invalid>0&&<small>{c.failureReasons.invalid} rejected by Telegram</small>}{c.failureReasons?.exhausted>0&&<small>{c.failureReasons.exhausted} reached the retry limit</small>}{c.failureReasons?.other>0&&<small>{c.failureReasons.other} delivery errors</small>}{c.failedBatches>0&&<small>{c.failedBatches} recipient batches failed</small>}</>;
}
function ConfirmBroadcast({value,busy,error,onNo,onYes}:{value:Confirmation;busy:boolean;error:string;onNo:()=>void;onYes:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),titleId=useId(),descriptionId=useId();
 const {campaign:c,action}=value,source=image(c),title=action==='resend'?'Resend this broadcast?':action==='delete'?'Delete sent Telegram messages?':'Stop this broadcast?';
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,node=dialog.current;node?.showModal();cancel.current?.focus();return()=>{node?.close();if(previous?.isConnected)previous.focus({preventScroll:true})}},[]);
 return <dialog ref={dialog} className={styles.confirmDialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={e=>{e.preventDefault();if(!busy)onNo()}}>
  <h2 id={titleId}>{title}</h2><p id={descriptionId}>{action==='resend'?'Yes queues a new campaign with this original image, message and button. Eligible recipients and linked auction availability are checked again.':action==='delete'?'Yes stops remaining sends and queues deletion of this campaign’s recorded messages. Telegram permits deletion within 48 hours; delivery history remains available.':'Yes stops remaining unsent messages. Messages already accepted by Telegram stay in delivery history.'}</p>
  {source&&<img src={source} alt="Original broadcast image"/>}<p className={styles.originalCaption}>{c.text}</p><p className={styles.help}>{c.buttonLabel??'Open Lowwin'} opens {c.miniAppPath??'/'}</p>
  <ErrorNotice error={error}/><div className="admin-actions"><button className={action==='delete'?'danger':undefined} disabled={busy} onClick={onYes}>{busy?'Queuing…':'Yes'}</button><button ref={cancel} className="secondary" disabled={busy} onClick={onNo}>No</button></div>
 </dialog>;
}
export function AdminMessages(){
 const me=useAdminAccess(),owner=me.role==='OWNER',queue=useQueueParams(),mutation=useAdminMutation();
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[notice,setNotice]=useState(''),[draftVersion,setDraftVersion]=useState(0);
 const view=queue.params.get('view')==='active'?'active':queue.params.get('view')==='history'?'history':'compose',auctionId=queue.params.get('auction')??'';
 const query=useAdminRead<History>(`notifications?${new URLSearchParams({page:String(queue.page),q:queue.params.get('q')??'',view:view==='active'?'active':'history'})}`,{enabled:view!=='compose'}),reload=useRef(query.reload);reload.current=query.reload;
 const auctionDraft=useAdminQuery<BroadcastDraft>(`notifications/auction/${auctionId}`,{enabled:owner&&view==='compose'&&!!auctionId});
 const active=view==='active'||query.data?.items.some(item=>item.canStop||item.deletion?.pending||item.deletion?.preparing)===true;
 useEffect(()=>{if(!active||view==='compose')return;const timer=setInterval(()=>{if(document.visibilityState==='visible')reload.current()},5000);return()=>clearInterval(timer)},[active,view]);
 const open=(campaign:Campaign,action:Confirmation['action'])=>{mutation.clear();setNotice('');setConfirmation({campaign,action,resendId:crypto.randomUUID()})};
 const confirm=async()=>{
  if(!confirmation)return;const {campaign:c,action,resendId}=confirmation;
  const result=await mutation.run(action==='resend'?'broadcastResend':action==='delete'?'broadcastDelete':'broadcastStop',{id:c.id,reason:action==='resend'?'Administrator confirmed resend of original broadcast':action==='delete'?'Administrator requested deletion of sent broadcast messages':'Administrator stopped remaining Telegram broadcast',...(action==='resend'?{resendId,confirmation:'RESEND'}:action==='delete'?{confirmation:'DELETE'}:{})});
  if(result){setConfirmation(null);setNotice(action==='resend'?'New campaign queued. The original campaign is unchanged.':action==='delete'?'Deletion queued. Follow the pending, deleted and unavailable counts below.':'Remaining sends stopped.');query.reload()}
 };
 return <div className="admin-people">
  <AdminHeading title="Broadcast" description="Compose an update, follow the queue, or manage delivered messages." refresh={view==='compose'?undefined:query.reload}>{owner&&<AdminLink className="admin-button secondary" href="/admin/auctions"><Plus size={16}/>Promote an auction</AdminLink>}</AdminHeading>
  <nav className={styles.areas} aria-label="Broadcast areas">{(['compose','active','history'] as const).map(area=><button type="button" key={area} className={view===area?'':'secondary'} aria-pressed={view===area} onClick={()=>{setNotice('');queue.set({view:area,page:'1',q:''})}}>{area==='compose'?'Compose / Review':area==='active'?'Active Queue':'Delivery History'}</button>)}</nav>
  {notice&&<p role="status" className="admin-notice">{notice}</p>}
  {view==='compose'?(owner?<section aria-label="Compose and review"><ErrorNotice error={auctionDraft.error} retry={auctionDraft.reload}/>{auctionId&&<button className="secondary" onClick={()=>queue.set({auction:''})}>New message</button>}{auctionId&&!auctionDraft.data&&!auctionDraft.error?<p role="status">Loading auction preview…</p>:<AdminBroadcast key={`${auctionDraft.data?.draftHash??'new'}:${draftVersion}`} initial={auctionDraft.data??undefined} onQueued={()=>{setDraftVersion(v=>v+1);queue.set({view:'active',page:'1',q:''})}}/>}</section>:<Empty title="Broadcast composition requires Owner access"/>):
  <section className="master-broadcast-history" aria-label={view==='active'?'Active Queue':'Delivery History'}>
   <h2>{view==='active'?'Active Queue':'Delivery History'}</h2><form className="admin-queue-filter" onSubmit={e=>{e.preventDefault();queue.set({q:String(new FormData(e.currentTarget).get('q')??''),page:'1'})}}><label>Search<input name="q" key={queue.params.get('q')??''} type="search" defaultValue={queue.params.get('q')??''} placeholder="Message text"/></label><button>Search</button></form>
   <ErrorNotice error={query.error||(!confirmation?mutation.error:'')} retry={query.reload}/>{!query.data&&query.loading&&<div className="admin-loading"><LoadingSpinner label="Loading broadcasts…"/></div>}
   {query.data&&<><div className="admin-table-wrap master-table" role="region" aria-label="Broadcast history" tabIndex={0}><table><thead><tr><th>Message</th><th>Sent</th><th>Pending</th><th>Skipped / Failed</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>{query.data.items.map(c=><tr key={c.id}>
    <td>{image(c)&&(owner?<button className={styles.historyImage} aria-label="Resend this broadcast image and message" disabled={mutation.busy} onClick={()=>open(c,'resend')}><img src={image(c)!} alt="Original broadcast image" loading="lazy"/></button>:<img className={styles.readonlyImage} src={image(c)!} alt="Original broadcast image" loading="lazy"/>)}<p className="master-message-excerpt">{c.text}</p><small>{c.buttonLabel??'Open Lowwin'} opens {c.miniAppPath??'/'}</small>{c.parentCampaignId&&<small>Resent campaign · original {c.parentCampaignId.slice(0,8)}</small>}<small>{c.eligibleRecipients??c.recipientCount} eligible recipients{c.audienceComplete===false?' · Preparing audience':''}</small>{c.deletion&&(c.deletion.preparing||c.deletion.deleted+c.deletion.pending+c.deletion.failed+c.deletion.unavailable>0)&&<div className={styles.deletionProgress} aria-label="Message deletion progress"><small>{c.deletion.deleted} deleted · {c.deletion.pending} pending · {c.deletion.failed} failed · {c.deletion.unavailable} unavailable</small>{c.deletion.preparing&&<small>Finding recorded messages and waiting for in-flight sends</small>}</div>}</td>
    <td className="admin-money">{c.sent}</td><td className="admin-money">{c.pending}{!!c.retrying&&<small>{c.retrying} retrying</small>}{!!c.inFlight&&<small>{c.inFlight} sending</small>}{c.pendingBatches>0&&<small>Preparing recipients</small>}</td><td className="admin-money">{c.skipped} skipped<small>{c.failed} failed</small><DeliveryIssues campaign={c}/></td><td><Status value={c.state}/></td><td>{eat(c.createdAt)}</td>
    <td>{owner&&<div className="people-row-actions"><button className="secondary" disabled={mutation.busy} onClick={()=>open(c,'resend')}><RotateCcw size={14}/>Resend</button>{c.canDelete!==false&&(c.sent>0||c.canStop)&&<button className="secondary" disabled={mutation.busy} onClick={()=>open(c,'delete')}><Trash2 size={14}/>Delete sent</button>}{c.canStop&&<button className="secondary" disabled={mutation.busy} onClick={()=>open(c,'stop')}><Square size={13}/>Stop</button>}</div>}</td>
   </tr>)}</tbody></table>{!query.data.items.length&&<Empty title={view==='active'?'No active campaigns':'No broadcasts yet'}/>}</div><Pagination {...query.data} onPage={page=>queue.set({page:String(page)})}/></>}
  </section>}
  {confirmation&&<ConfirmBroadcast value={confirmation} busy={mutation.busy} error={mutation.error} onNo={()=>{mutation.clear();setConfirmation(null)}} onYes={()=>void confirm()}/>}
 </div>;
}
