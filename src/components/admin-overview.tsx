'use client';
import {AdminLink as Link} from './admin-query';
import {Plus,ArrowUpRight,Gavel,Users,CreditCard,Trophy} from 'lucide-react';
import type {OverviewSummary,OverviewAuctions} from '@/modules/admin/workspace-read';
import {AdminHeading,Empty,ErrorNotice,Status,eat,useAdminRead} from './admin-ui';
import {useAdminAccess} from './admin-shell';
import styles from './admin-overview.module.css';

export function AdminOverview(){
 const access=useAdminAccess(),catalog=access.permissions.includes('catalog');
 const summary=useAdminRead<OverviewSummary>('dashboard/summary'),auctions=useAdminRead<OverviewAuctions>('dashboard/auctions',{enabled:catalog});
 const cards=[
  {key:'auctions' as const,label:'Live auctions',href:'/admin/auctions?status=LIVE',icon:Gavel,allowed:catalog},
  {key:'players' as const,label:'Players',href:'/admin/users',icon:Users,allowed:['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(access.role)},
  {key:'payments' as const,label:'Payments to review',href:'/admin/payments?status=NEEDS_REVIEW',icon:CreditCard,allowed:['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(access.role)},
  {key:'deliveries' as const,label:'Winners to deliver',href:'/admin/fulfillment?status=INCOMPLETE',icon:Trophy,allowed:['OWNER','FULFILLMENT','AUDITOR'].includes(access.role)},
 ].filter(card=>card.allowed);
 const refresh=()=>{summary.reload();if(catalog)auctions.reload()};
 return <><AdminHeading title="Overview" refresh={refresh}>{catalog&&<Link className="admin-button" href="/admin/auctions/new"><Plus size={17}/>Create auction</Link>}</AdminHeading>
 <ErrorNotice error={summary.error} retry={summary.reload}/>
 <section className={styles.summary} aria-label="Workspace summary" aria-busy={summary.refreshing}>
 {cards.map(({key,label,href,icon:Icon})=>{const value=summary.data?.[key];return <Link key={key} href={href} className={styles.card} data-overview-card><div className={styles.cardTop}><span className={styles.icon}><Icon size={19} strokeWidth={1.7}/></span><ArrowUpRight size={17} className={styles.arrow} aria-hidden="true"/></div><span className={styles.label}>{label}</span><strong className={styles.value}>{value?.state==='ready'?value.count.toLocaleString():summary.loading?<span className={styles.placeholder} aria-label={`Loading ${label.toLowerCase()}`}/>:<span className={styles.unavailable}>Unavailable</span>}</strong><span className={styles.cardAction}>Open {label.toLowerCase()}</span></Link>})}
 </section>
 {catalog&&<section className={styles.auctions} aria-busy={auctions.refreshing}><div className="master-section-title"><h2>Active auctions</h2><Link className={styles.viewAll} href="/admin/auctions">View all <ArrowUpRight size={14}/></Link></div><ErrorNotice error={auctions.error} retry={auctions.reload}/>
 <div className="admin-table-wrap master-table" role="region" aria-label="Active auctions" tabIndex={0}><table><thead><tr><th>Product</th><th>Status</th><th>Players</th><th>Bids</th><th>Ends</th><th>Action</th></tr></thead><tbody>{auctions.data?.items.map(a=><tr key={a.id}><td><div className="admin-item">{a.image&&<img src={a.image} width={36} height={36} alt="" loading="lazy"/>}<div><strong>{a.title}</strong><small>#{a.code}</small></div></div></td><td><Status value={a.displayStatus}/></td><td>{a.participants}</td><td>{a.acceptedBids}</td><td>{eat(a.endsAt)}</td><td><Link href={`/admin/auctions/${a.id}`}>Details</Link></td></tr>)}</tbody></table>{auctions.loading&&!auctions.data?<div className={styles.tableLoading} role="status">Loading active auctions…</div>:auctions.data&&!auctions.data.items.length?<Empty title="No active auctions"/>:null}</div></section>}
 {summary.data&&<p className="admin-snapshot">Updated {eat(summary.data.serverNow)}{summary.refreshing?' · Refreshing…':''}</p>}</>;
}
