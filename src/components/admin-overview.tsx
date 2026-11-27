'use client';
import {AdminLink as Link} from './admin-query';
import {Plus,ArrowUpRight,Gavel,Users,WalletCards,Trophy,UserPlus,Wallet,Receipt,Coins} from 'lucide-react';
import type {OverviewSummary,OverviewAuctions} from '@/modules/admin/workspace-read';
import {formatEtb} from '@/lib/money';
import {ADDIS_ABABA_TIME_LABEL} from '@/lib/addis-time';
import {AdminHeading,Empty,ErrorNotice,Status,eat,useAdminRead} from './admin-ui';
import {useAdminAccess} from './admin-shell';
import styles from './admin-overview.module.css';

function count(value:OverviewSummary['players']){return value?.state==='ready'?value.count.toLocaleString():undefined}

export function AdminOverview(){
 const access=useAdminAccess(),catalog=access.permissions.includes('catalog');
 const summary=useAdminRead<OverviewSummary>('dashboard/summary'),auctions=useAdminRead<OverviewAuctions>('dashboard/auctions',{enabled:catalog});
 const players=['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(access.role);
 const financial=['OWNER','PAYMENTS_OPERATOR','AUDITOR'].includes(access.role);
 const data=summary.data,daily=data?.daily,money=financial&&daily?.money?.state==='ready'?daily.money:undefined;
 const cards=[
  {key:'auctions',label:'Live auctions',href:'/admin/auctions?status=LIVE',icon:Gavel,allowed:catalog,value:count(data?.auctions)},
  {key:'players',label:'Players',href:'/admin/users',icon:Users,allowed:players,value:count(data?.players)},
  {key:'wallet-paid-bids',label:'Wallet-paid bids today',icon:WalletCards,allowed:players,value:count(data?.walletPaidBids)},
  {key:'deliveries',label:'Winners to deliver',href:'/admin/fulfillment?status=INCOMPLETE',icon:Trophy,allowed:['OWNER','FULFILLMENT','AUDITOR'].includes(access.role),value:count(data?.deliveries)},
  {key:'new-members',label:'New members today',href:'/admin/users',action:'Open players',icon:UserPlus,allowed:players,value:count(daily?.newMembers)},
  {key:'deposits-today',label:'Deposits today',href:'/admin/payments?view=completed&purpose=TOP_UP',action:'Open wallet deposits',icon:Wallet,allowed:financial,value:money?formatEtb(money.depositEtb):undefined,isAmount:true},
  {key:'successful-payments',label:'Successful payments today',href:'/admin/payments?view=completed',action:'Open successful payments',icon:Receipt,allowed:financial,value:money?.successfulPayments.toLocaleString()},
  {key:'payments-today',label:'Payments today',href:'/admin/payments?view=completed',action:'Open successful payments',icon:Coins,allowed:financial,value:money?formatEtb(money.paymentEtb):undefined,isAmount:true},
 ].filter(card=>card.allowed);
 const refresh=()=>{summary.reload();if(catalog)auctions.reload()};
 return <><AdminHeading title="Overview" description={players?`Daily totals use ${ADDIS_ABABA_TIME_LABEL}.`:undefined} refresh={refresh}>{catalog&&<Link className="admin-button" href="/admin/auctions/new"><Plus size={17}/>Create auction</Link>}</AdminHeading>
 <ErrorNotice error={summary.error} retry={summary.reload}/>
 <section className={styles.summary} aria-label="Workspace summary" aria-busy={summary.refreshing}>
 {cards.map(({key,label,href,icon:Icon,value,action,isAmount})=>{
  const body=<><div className={styles.cardTop}><span className={styles.icon}><Icon size={19} strokeWidth={1.7} aria-hidden="true"/></span>{href&&<ArrowUpRight size={17} className={styles.arrow} aria-hidden="true"/>}</div><span className={styles.label}>{label}</span><strong className={isAmount?`${styles.value} ${styles.amount}`:styles.value}>{value??(summary.loading?<span className={styles.placeholder} aria-label={`Loading ${label.toLowerCase()}`}/>:<span className={styles.unavailable}>Unavailable</span>)}</strong></>;
  const props={className:styles.card,'data-overview-card':key};
  return href?<Link key={key} href={href} {...props}>{body}<span className={styles.cardAction}>{action??`Open ${label.toLowerCase()}`}</span></Link>:<div key={key} {...props}>{body}</div>;
 })}
 </section>
 {catalog&&<section className={styles.auctions} aria-busy={auctions.refreshing}><div className="master-section-title"><h2>Active auctions</h2><Link className={styles.viewAll} href="/admin/auctions">View all <ArrowUpRight size={14}/></Link></div><ErrorNotice error={auctions.error} retry={auctions.reload}/>
 <div className="admin-table-wrap master-table" role="region" aria-label="Active auctions" tabIndex={0}><table><thead><tr><th>Product</th><th>Status</th><th>Players</th><th>Bids</th><th>Ends</th><th>Action</th></tr></thead><tbody>{auctions.data?.items.map(a=><tr key={a.id}><td><div className="admin-item">{a.image&&<img src={a.image} width={36} height={36} alt="" loading="lazy"/>}<div><strong>{a.title}</strong><small>#{a.code}</small></div></div></td><td><Status value={a.displayStatus}/></td><td>{a.participants}</td><td>{a.acceptedBids}</td><td>{eat(a.endsAt)}</td><td><Link href={`/admin/auctions/${a.id}`}>Details</Link></td></tr>)}</tbody></table>{auctions.loading&&!auctions.data?<div className={styles.tableLoading} role="status">Loading active auctions…</div>:auctions.data&&!auctions.data.items.length?<Empty title="No active auctions"/>:null}</div></section>}
 {summary.data&&<p className="admin-snapshot">Updated {eat(summary.data.serverNow)}{summary.refreshing?' · Refreshing…':''}</p>}</>;
}
