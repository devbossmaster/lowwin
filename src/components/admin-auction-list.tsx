'use client';

import {LoadingSpinner} from './loading-spinner';
import {AdminPhoto} from './admin-catalog';
import Link from 'next/link';
import {Plus} from 'lucide-react';
import type {auctionList} from '@/modules/admin/workspace-read';
import {AdminHeading,Empty,ErrorNotice,Pagination,Status,eat,statusLabel,useAdminRead,useQueueParams} from './admin-ui';

type View='in-progress'|'drafts'|'completed'|'cancelled';
const views:{id:View;label:string}[]=[
  {id:'in-progress',label:'In progress'},
  {id:'drafts',label:'Drafts'},
  {id:'completed',label:'Completed'},
  {id:'cancelled',label:'Cancelled'},
];
const runningStatuses=['UPCOMING','LIVE','CLOSING','FAILED'];

export function AdminAuctionList(){
  const queue=useQueueParams();
  const rawStatus=queue.params.get('status')??'';
  const rawView=queue.params.get('view');
  const view:View=views.some(item=>item.id===rawView)?rawView as View:rawStatus==='CANCELLED'?'cancelled':rawStatus==='DRAFT'?'drafts':rawStatus==='COMPLETED'?'completed':'in-progress';
  const status=view==='in-progress'&&runningStatuses.includes(rawStatus)?rawStatus:'';
  const q=queue.params.get('q')??'';
  const category=queue.params.get('category')??'';
  const apiStatus=view==='in-progress'?status||'IN_PROGRESS':view==='drafts'?'DRAFT':view==='completed'?'COMPLETED':'CANCELLED';
  const query=useAdminRead<Awaited<ReturnType<typeof auctionList>>>(`auctions?${new URLSearchParams({status:apiStatus,q,category,page:String(queue.page)})}`);

  return <>
    <AdminHeading title="Auctions" description="Prepare items, follow participation, and review completed outcomes." refresh={query.reload}>
      <Link className="admin-button" href="/admin/auctions/new"><Plus size={18}/>Create auction</Link>
    </AdminHeading>
    <nav className="admin-local-tabs" aria-label="Auction views">
      {views.map(item=><button key={item.id} type="button" aria-current={view===item.id?'page':undefined} onClick={()=>queue.set({view:item.id==='in-progress'?'':item.id,status:'',page:'1'})}>{item.label}</button>)}
    </nav>
    <form className="admin-queue-filter" onSubmit={event=>{event.preventDefault();queue.set({q:String(new FormData(event.currentTarget).get('q')),page:'1'})}}>
      <label>Find an auction<input name="q" defaultValue={q} key={q} placeholder="Product title or auction code"/></label>
      <label>Category<select value={category} onChange={event=>queue.set({category:event.target.value,page:'1'})}><option value="">All categories</option>{query.data?.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {view==='in-progress'&&<label>Status<select value={status} onChange={event=>queue.set({status:event.target.value,page:'1'})}><option value="">All in progress</option>{runningStatuses.map(item=><option value={item} key={item}>{item==='FAILED'?'Closing needs attention':statusLabel(item)}</option>)}</select></label>}
      <button>Search</button>
      <button type="button" className="secondary" onClick={()=>queue.set({q:'',status:'',category:'',page:'1'})}>Reset filters</button>
    </form>
    <ErrorNotice error={query.error} retry={query.reload}/>
    {query.loading&&!query.data&&<div className="admin-loading"><LoadingSpinner label="Loading auctions…"/></div>}
    {query.data&&<>
      <p className="admin-snapshot">Status checked {eat(query.data.serverNow)} · counts include labelled DEMO inventory</p>
      <div className="admin-table-wrap"><table><thead><tr><th>Item / auction</th><th>Status</th><th>Participants</th><th>Accepted bids</th><th>Schedule</th><th>Action</th></tr></thead><tbody>
        {query.data.items.map(item=><tr key={item.id}>
          <td><div className="admin-item"><AdminPhoto src={item.product?.images[0]?.path}/><div><strong>{item.product?.title??'Untitled draft'}</strong><small>{item.code}{item.isDemo?' · DEMO':''}</small></div></div></td>
          <td><Status value={item.displayStatus}/>{item.closeErrorCode&&item.displayStatus==='CLOSING'&&<small>Closing needs investigation</small>}</td>
          <td>{item.participants} people{item.terms&&item.participants<item.terms.minParticipants&&<small>Below {item.terms.minParticipants}-person minimum</small>}</td>
          <td>{item.acceptedBids}</td>
          <td><small>Starts {eat(item.startsAt)}</small><small>Ends {eat(item.endsAt)}</small></td>
          <td><Link href={`/admin/auctions/${item.id}`}>{item.displayStatus==='DRAFT'?'Edit draft':['COMPLETED','CANCELLED'].includes(item.displayStatus)?'View result':'Open auction'} →</Link></td>
        </tr>)}
      </tbody></table>{!query.data.items.length&&<Empty title={`No ${view.replace('-', ' ')} auctions`}>Adjust the filters or choose another tab.</Empty>}</div>
      <Pagination page={query.data.page} total={query.data.total} totalPages={query.data.totalPages} onPage={page=>queue.set({page:String(page)})}/>
    </>}
  </>;
}
