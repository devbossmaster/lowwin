'use client';
import {lazy,Suspense,useState} from 'react';
import {AdminLink} from './admin-query';
import {Gift,Phone} from 'lucide-react';
import {useAdminAccess} from './admin-shell';
import {AdminHeading,Empty,ErrorNotice,Pagination,Status,eat,useAdminRead,useAdminMutation,useQueueParams} from './admin-ui';
import {AdminDrawer} from './admin-drawer';
import {notifyAdminAction} from './admin-action-toast';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import {ADDIS_ABABA_TIME_LABEL} from '@/lib/addis-time';
import {LoadingSpinner} from './loading-spinner';
import type {WinnerPhotoRecord} from './admin-winner-photo';
const AdminWinnerPhoto=lazy(()=>import('./admin-winner-photo'));

type Player={id:string;name:string;telegramId:string|null;telegramUsername:string|null;phone:string|null;phoneUnavailable:boolean;createdAt:string;bidCount:number;winCount:number;suspended:boolean;restrictionReason?:string|null;available?:string|null;held?:string|null;referralCount?:number;rewardCount?:number};
type Winner=WinnerPhotoRecord&{auctionId:string;publicCode:number;code:string;title:string|null;completedAt:string;state:string;version:number;tracking:string|null;assignedTo:string|null;winner:Pick<Player,'id'|'name'|'telegramUsername'|'phone'|'phoneUnavailable'>|null;deliveredAt:string|null};
type Queue<T>={items:T[];total:number;page:number;totalPages:number};
type LiveWinner={auctionId:string;publicCode:number;title:string;endsAt:string;ruleVersion:string;leader:{bidderName:string;amount:string}|null;reason:'NO_BIDS'|'MINIMUM_PARTICIPANTS'|'NO_UNIQUE_BID'|null};
type DeliveredReceipt={auctionId:string;state:'DELIVERED';version:number;deliveredAt?:string};
const leaderReasons={NO_BIDS:'No accepted bids',MINIMUM_PARTICIPANTS:'Minimum participants not reached',NO_UNIQUE_BID:'No unique bid yet'};
function Name({player}:{player:Pick<Player,'name'|'telegramUsername'>}){return <><strong>{player.name}</strong><small>{player.telegramUsername?`@${player.telegramUsername}`:'—'}</small></>}
function Contact({player}:{player:Pick<Player,'phone'|'phoneUnavailable'>}){return player.phone?<a className="people-phone" href={`tel:${player.phone}`}><Phone size={14}/>{player.phone}</a>:<span className="people-muted">{player.phoneUnavailable?'Unavailable':'Not shared'}</span>}
function Filters({placeholder,statuses=[]}:{placeholder:string;statuses?:[string,string][]}){const queue=useQueueParams(),q=queue.params.get('q')??'',status=queue.params.get('status')??'';return <form className="admin-queue-filter" onSubmit={e=>{e.preventDefault();queue.set({q:String(new FormData(e.currentTarget).get('q')??''),page:'1'})}}><label>Search<input name="q" key={q} defaultValue={q} placeholder={placeholder} type="search"/></label>{statuses.length>0&&<label>Status<select value={status} onChange={e=>queue.set({status:e.target.value,page:'1'})}><option value="">All</option>{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}<button>Search</button>{q&&<button type="button" className="secondary" onClick={()=>queue.set({q:'',page:'1'})}>Clear</button>}</form>}
function Pages({data}:{data:Queue<unknown>}){const queue=useQueueParams();return <Pagination {...data} onPage={page=>queue.set({page:String(page)})}/>}
function useQueue<T>(section:string){const queue=useQueueParams();return useAdminRead<Queue<T>>(`workspace/${section}?${new URLSearchParams({page:String(queue.page),q:queue.params.get('q')??'',status:queue.params.get('status')??''})}`)}
const money=(amount:string|null|undefined)=>amount==null?'Unavailable':formatEtb(amount);
export function AdminPeople({section}:{section:'users'|'fulfillment'}){return <div className="admin-people">{section==='users'?<Players/>:<Winners/>}</div>}

function Players(){const query=useQueue<Player>('players'),access=useAdminAccess(),[selected,setSelected]=useState<string|null>(null);return <>
 <AdminHeading title="Players" description={`Times shown in ${ADDIS_ABABA_TIME_LABEL}.`} refresh={query.reload}>{access.permissions.includes('settings')&&<AdminLink className="admin-button secondary" href="/admin/users/referrals"><Gift size={16} aria-hidden="true"/>Referral rewards setup</AdminLink>}</AdminHeading><Filters placeholder="Name, username, phone or player ID" statuses={[["ACTIVE","Active"],["SUSPENDED","Suspended"]]}/>
 <ErrorNotice error={query.error} retry={query.reload}/>{!query.data&&query.loading&&<div className="admin-loading"><LoadingSpinner label="Loading players…"/></div>}
 {query.data&&<><div className="admin-table-wrap master-table" role="region" aria-label="Players and wallets" tabIndex={0}><table><thead><tr><th>Player</th><th>Phone</th><th className="admin-money">Available</th><th className="admin-money">Held</th><th>Bids / wins</th><th>Referrals</th><th>Status</th><th>Joined</th><th>Action</th></tr></thead><tbody>{query.data.items.map(p=><tr key={p.id}><td><Name player={p}/></td><td><Contact player={p}/></td><td className="admin-money">{money(p.available)}</td><td className="admin-money">{money(p.held)}</td><td>{p.bidCount} / {p.winCount}</td><td>{p.referralCount??'—'}<small>{p.rewardCount??'—'} wallet rewards</small></td><td><Status value={p.suspended?'SUSPENDED':'ACTIVE'}/></td><td><time dateTime={p.createdAt}>{eat(p.createdAt)}</time></td><td><button className="secondary" onClick={()=>setSelected(p.id)}>Details</button></td></tr>)}</tbody></table>{!query.data.items.length&&<Empty title="No players found">Try another search.</Empty>}</div><Pages data={query.data}/></>}
 {selected&&<PlayerDetails key={selected} id={selected} close={()=>setSelected(null)} saved={()=>setSelected(null)}/>}
 </>}
function PlayerDetails({id,close,saved}:{id:string;close:()=>void;saved:()=>void}){const query=useAdminRead<Player>(`users/${encodeURIComponent(id)}`),mutation=useAdminMutation(),me=useAdminAccess(),p=query.data;return <AdminDrawer title="Player details" onClose={close}><ErrorNotice error={query.error} retry={query.reload}/>{!p&&query.loading&&<LoadingSpinner label="Loading player…"/>}{p&&<><div className="people-detail-name"><Name player={p}/></div><dl className="admin-facts"><div><dt>Phone</dt><dd><Contact player={p}/></dd></div><div><dt>Bids / wins</dt><dd>{p.bidCount} / {p.winCount}</dd></div><div><dt>Joined</dt><dd><time dateTime={p.createdAt} title={ADDIS_ABABA_TIME_LABEL}>{eat(p.createdAt)}</time></dd></div><div><dt>Status</dt><dd><Status value={p.suspended?'SUSPENDED':'ACTIVE'}/></dd></div><div><dt>Telegram ID</dt><dd>{p.telegramId??'—'}</dd></div><div><dt>Player ID</dt><dd>{p.id}</dd></div></dl>{me.role==='OWNER'&&<form className="admin-form" onSubmit={async e=>{e.preventDefault();if(await mutation.run('suspend',{userId:p.id,suspended:!p.suspended,reason:new FormData(e.currentTarget).get('reason')})){notifyAdminAction(p.suspended?'Bidding access restored.':'Bidding access suspended.');saved()}}}>{p.restrictionReason&&<p>{p.restrictionReason}</p>}<label>Reason<textarea name="reason" required minLength={5} maxLength={500} rows={2}/></label><button disabled={mutation.busy}>{mutation.busy?'Saving…':p.suspended?'Restore bidding':'Suspend bidding'}</button><ErrorNotice error={mutation.error}/></form>}</>}</AdminDrawer>}

function LiveWinners(){
 const [open,setOpen]=useState(false),[criteria,setCriteria]=useState({page:1,q:''});
 const query=useAdminRead<Queue<LiveWinner>&{serverNow:string}>(`workspace/live-winners?${new URLSearchParams({page:String(criteria.page),q:criteria.q})}`,{enabled:open});
 return <details className="admin-evidence" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Live provisional leaders</summary>
  {open&&<>
   <p className="admin-group-note">Provisional leaders can change until the auction closes.</p>
   <form className="admin-queue-filter" onSubmit={event=>{
    event.preventDefault();
    const q=String(new FormData(event.currentTarget).get('q')??'').trim();
    setCriteria({page:1,q});
   }}>
    <label>Search live auctions<input name="q" key={criteria.q} defaultValue={criteria.q} placeholder="Product or auction code" type="search"/></label>
    <button type="submit">Search</button>
    <button type="button" className="secondary" onClick={query.reload} disabled={query.fetching}>Refresh leaders</button>
   </form>
   <ErrorNotice error={query.error} retry={query.reload}/>
   {!query.data&&query.loading&&<div className="admin-loading"><LoadingSpinner label="Loading live leaders…"/></div>}
   {query.data&&<>
    <div className="admin-table-wrap master-table" role="region" aria-label="Live provisional leaders" tabIndex={0} aria-busy={query.fetching}>
     <table><thead><tr><th>Auction</th><th>Provisional leader</th><th className="admin-money">Leading bid</th><th>Closes</th></tr></thead>
      <tbody>{query.data.items.map(item=><tr key={item.auctionId}>
       <td><strong>{item.title}</strong><small>#{item.publicCode}</small></td>
       <td>{item.leader?.bidderName??(item.reason?leaderReasons[item.reason]:'Unavailable')}</td>
       <td className="admin-money">{item.leader?formatAuctionBid(item.leader.amount,item.ruleVersion):'—'}</td>
       <td><time dateTime={item.endsAt}>{eat(item.endsAt)}</time></td>
      </tr>)}</tbody>
     </table>
     {!query.data.items.length&&<Empty title="No matching live auctions"/>}
    </div>
    <Pagination {...query.data} onPage={page=>setCriteria(current=>({...current,page}))}/>
   </>}
  </>}
 </details>;
}

function WinnerDetails({winner,close,onDelivered,refresh}:{winner:Winner;close:()=>void;onDelivered:(receipt:DeliveredReceipt)=>void;refresh:()=>void}){
 const access=useAdminAccess(),mutation=useAdminMutation();
 const canDeliver=access.permissions.includes('fulfillment')&&winner.state!=='DELIVERED';
 return <AdminDrawer title="Winner details" onClose={close}>
  <dl className="admin-facts">
   <div><dt>Product</dt><dd>{winner.title??'Auction item'} · #{winner.publicCode??winner.code}</dd></div>
   <div><dt>Winner</dt><dd>{winner.winner?.name??'Unavailable'}</dd></div>
   <div><dt>Phone</dt><dd>{winner.winner&&<Contact player={winner.winner}/>}</dd></div>
   <div><dt>Won</dt><dd>{eat(winner.completedAt)}</dd></div>
   <div><dt>Delivery</dt><dd><Status value={winner.state}/></dd></div>
   {winner.tracking&&<div><dt>Tracking</dt><dd>{winner.tracking}</dd></div>}
   {winner.deliveredAt&&<div><dt>Delivered</dt><dd><time dateTime={winner.deliveredAt}>{eat(winner.deliveredAt)}</time></dd></div>}
  </dl>
  {canDeliver&&<form className="admin-form" onSubmit={async event=>{
   event.preventDefault();
   const receipt=await mutation.run<DeliveredReceipt>('deliveryDone',{auctionId:winner.auctionId,version:winner.version,reason:'Marked delivered by staff'});
   if(receipt){notifyAdminAction('Delivery recorded.');onDelivered(receipt)}
  }}><button type="submit" disabled={mutation.busy}>{mutation.busy?'Saving delivery…':'Mark delivered'}</button></form>}
  <ErrorNotice error={mutation.error} inline/>
  {mutation.error&&<button type="button" className="secondary" onClick={()=>{refresh();mutation.clear()}}>Refresh winner</button>}
  {access.permissions.includes('fulfillment')&&access.permissions.includes('catalog')&&<Suspense fallback={<LoadingSpinner label="Loading banner controls…"/>}><AdminWinnerPhoto key={winner.auctionId+':'+(winner.winnerBannerVersion??winner.winnerPhotoVersion??0)} winner={winner} onSaved={close}/></Suspense>}
 </AdminDrawer>;
}

function Winners(){
 const query=useQueue<Winner>('winners'),access=useAdminAccess(),[selected,setSelected]=useState<Winner|null>(null);
 const current=selected&&query.data?.items.find(item=>item.auctionId===selected.auctionId&&item.version>=selected.version);
 const winner=current||selected;
 return <>
 <AdminHeading title="Winners" refresh={query.reload}><AdminLink className="admin-button secondary" href="/admin/results">Result records</AdminLink></AdminHeading>
 {access.role==='OWNER'&&<LiveWinners/>}
 <Filters placeholder="Winner, product or auction code" statuses={[["INCOMPLETE","To deliver"],["DELIVERED","Delivered"]]}/>
 <ErrorNotice error={query.error} retry={query.reload}/>{!query.data&&query.loading&&<div className="admin-loading"><LoadingSpinner label="Loading winners…"/></div>}
 {query.data&&<><div className="admin-table-wrap master-table" role="region" aria-label="Winners" tabIndex={0}><table><thead><tr><th>Winner</th><th>Phone</th><th>Product</th><th>Won</th><th>Delivery</th><th>Action</th></tr></thead><tbody>{query.data.items.map(w=><tr key={w.auctionId}><td>{w.winner?<Name player={w.winner}/>:<span>Unavailable</span>}</td><td>{w.winner&&<Contact player={w.winner}/>}</td><td><strong>{w.title??'Auction item'}</strong><small>#{w.publicCode??w.code}</small></td><td><time>{eat(w.completedAt)}</time></td><td><Status value={w.state}/>{w.deliveredAt&&<small>{eat(w.deliveredAt)}</small>}</td><td><button className="secondary" disabled={query.loading} onClick={()=>setSelected(w)}>Details</button></td></tr>)}</tbody></table>{!query.data.items.length&&<Empty title="No winners found">Winning items will appear here.</Empty>}</div><Pages data={query.data}/></>}
 {winner&&<WinnerDetails key={winner.auctionId} winner={winner} close={()=>setSelected(null)} refresh={query.reload} onDelivered={receipt=>{
  setSelected(item=>item?.auctionId===receipt.auctionId?{...item,state:receipt.state,version:receipt.version,deliveredAt:receipt.deliveredAt??item.deliveredAt}:item);
  query.reload();
 }}/>}
 </>}
