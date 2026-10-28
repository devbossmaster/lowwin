'use client';
import {LoadingSpinner} from './loading-spinner';
import {AdminLink as Link} from './admin-query';
import {Plus,ArrowUpRight} from 'lucide-react';
import type {OverviewData} from '@/modules/admin/workspace-read';
import {AdminHeading,Empty,ErrorNotice,Status,eat,useAdminRead} from './admin-ui';
import {useAdminAccess} from './admin-shell';

export function AdminOverview(){
 const query=useAdminRead<OverviewData>('dashboard'),d=query.data,access=useAdminAccess();
 const count=(part:{state:string;count?:number;live?:number}|undefined)=>!part||part.state!=='ready'?'Unavailable':(part.count??part.live??0).toLocaleString();
 return <><AdminHeading title="Overview" refresh={query.reload}>{access.permissions.includes('catalog')&&<Link className="admin-button" href="/admin/auctions/new"><Plus size={17}/>Create auction</Link>}</AdminHeading><ErrorNotice error={query.error} retry={query.reload}/>{!d&&query.loading&&<div className="admin-loading"><LoadingSpinner label="Loading overview…"/></div>}{d&&<>
 <div className="admin-table-wrap master-overview" role="region" aria-label="Workspace summary" tabIndex={0}><table><thead><tr><th>Workspace</th><th>Total</th><th>Action</th></tr></thead><tbody>{[
 {label:'Live auctions',value:count(d.auctions),href:'/admin/auctions'},
 {label:'Players',value:d.players?.state==='ready'?d.players.total.toLocaleString():'Unavailable',href:'/admin/users'},
 {label:'Payments to review',value:count(d.payments),href:'/admin/payments?status=NEEDS_REVIEW'},
 {label:'Winners to deliver',value:count(d.deliveries),href:'/admin/fulfillment?status=INCOMPLETE'},
 ].map(row=><tr key={row.label}><td><strong>{row.label}</strong></td><td className="admin-money">{row.value}</td><td><Link href={row.href}>Open <ArrowUpRight size={14}/></Link></td></tr>)}</tbody></table></div>
 <section className="master-overview-auctions"><div className="master-section-title"><h2>Active auctions</h2><Link href="/admin/auctions">View all</Link></div>{d.auctions?.state==='error'?<ErrorNotice error="Auctions could not load." retry={query.reload}/>:<div className="admin-table-wrap master-table" role="region" aria-label="Active auctions" tabIndex={0}><table><thead><tr><th>Product</th><th>Status</th><th>Players</th><th>Bids</th><th>Ends</th><th>Action</th></tr></thead><tbody>{d.auctions?.items?.map(a=><tr key={a.id}><td><div className="admin-item">{a.product?.images[0]&&<img src={a.product.images[0].path} width={36} height={36} alt="" loading="lazy"/>}<div><strong>{a.product?.title??'Auction'}</strong><small>#{a.code}</small></div></div></td><td><Status value={a.displayStatus}/></td><td>{a.participants}</td><td>{a.acceptedBids}</td><td>{eat(a.endsAt)}</td><td><Link href={`/admin/auctions/${a.id}`}>Details</Link></td></tr>)}</tbody></table>{!d.auctions?.items?.length&&<Empty title="No active auctions"/>}</div>}</section><p className="admin-snapshot">Updated {eat(d.serverNow)}</p>
 </>}</>;
}
