'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {Clock3,RefreshCw,Wallet as WalletIcon} from 'lucide-react';
import {useMiniPage,useMiniQueryState} from '@/components/mini-query-state';
import {useTelegram} from '@/components/telegram-provider';
import {useMiniLocale} from '@/components/mini-locale';
import {PersonalPagination,usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
import {PaymentHistory} from '@/components/payment-history';
import {formatEtb,etbToCents} from '@/lib/money';
import {paymentChannelName} from '@/lib/payment-channels';
import {TelegramLink} from '@/components/telegram-link';
import styles from '@/components/account-pages.module.css';
const AccountSheet=dynamic(()=>import('@/components/account-sheet').then(module=>module.AccountSheet));
type WalletView={page:number;total:number;totalPages:number;wallet:{available:string;held:string};activity:{id:string;kind:string;at:string;availableDelta:string;heldDelta:string}[]};
type Transfer={id:string;createdAt:string;channel:string;status:string;points:string;reference:string|null;demo?:boolean};
type Transfers={items:Transfer[];totalPages:number};
const names:Record<string,[string,string]>={ADMIN_CREDIT:['Funds added by admin','በአስተዳዳሪ የተጨመረ ገንዘብ'],TOPUP_CREDIT:['Verified transfer credit','የተረጋገጠ ዝውውር'],TOPUP_REVERSAL:['Reviewed transfer correction','የዝውውር ማስተካከያ'],ARIFPAY_RECEIPT:['Verified bid payment','የተረጋገጠ የጨረታ ክፍያ'],DEMO_CREDIT:['DEMO ETB credit','የሙከራ ETB'],DEV_CREDIT:['Development ETB credit','የልማት ሙከራ ETB'],HOLD_RESERVE:['Auction funds reserved','ለጨረታ የተያዘ'],HOLD_RELEASE:['Auction funds released','ከጨረታ የተለቀቀ'],BID_FEE:['Auction submission fee','የጨረታ ማቅረቢያ ክፍያ'],AUCTION_WIN_CHARGE:['Winning amount charged','ያሸነፈ መጠን ክፍያ'],AUCTION_FEE_REFUND:['Auction fee refund','የጨረታ ክፍያ ተመላሽ']};
const statuses:Record<string,[string,string]>={PENDING:['Pending','በመጠባበቅ ላይ'],VERIFYING:['Verifying','በማረጋገጥ ላይ'],CREDITED:['Credited','ገብቷል'],NEEDS_REVIEW:['Needs review','ግምገማ ይፈልጋል'],REJECTED:['Rejected','ውድቅ ተደርጓል'],DUPLICATE_CONFLICT:['Needs review','ግምገማ ይፈልጋል'],PROVIDER_OUTAGE:['Verification delayed','ማረጋገጥ ዘግይቷል'],REVERSED:['Corrected','ተስተካክሏል']};
export default function Wallet(){const {queryIdentity}=useTelegram();return <History key={queryIdentity??'guest'}/>}
function History(){
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {params,set}=useMiniQueryState(),[page,setPage]=useMiniPage(),[selected,setSelected]=useState<Transfer|null>(null);
  const tab=params.get('type')==='deposits'?'transfers':params.get('type')==='activity'?'activity':'payments';
  const query=usePrivateQuery<WalletView>(`/api/wallet?page=${page}`),view=query.data;
  const transfers=usePrivateQuery<Transfers>(`/api/wallet/top-ups?page=${page}`,{enabled:tab==='transfers',pollMs:30000});
  useEffect(()=>{const refresh=()=>query.reload();window.addEventListener('lowin-wallet-updated',refresh);return()=>window.removeEventListener('lowin-wallet-updated',refresh)},[query.reload]);
  const transfer=selected?transfers.data?.items.find(item=>item.id===selected.id)??selected:null;
  const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  if(query.status==='loading'||query.status==='authenticated'&&!view&&!query.error)return <MiniRouteSkeleton/>;
  return <section className={styles.page}><header className={styles.heading}><h1>{text('Wallet & history','ቦርሳ እና ታሪክ')}</h1><p>{text('Your existing balance and payment records.','ነባር ቀሪዎ እና የክፍያ መዝገቦችዎ።')}</p></header><PrivateState query={query}/>{view&&<div className={styles.balance}><p>{text('Available balance','ለመጠቀም ያለ ቀሪ')}</p><strong>{formatEtb(view.wallet.available)}</strong>{etbToCents(view.wallet.held)>0n&&<p style={{marginTop:10}}>{formatEtb(view.wallet.held)} {text('held under existing auction terms','በነባር የጨረታ ውሎች የተያዘ')}</p>}</div>}
    <div className={styles.tabs} role="group" aria-label={text('Payment history','የክፍያ ታሪክ')}><button type="button" aria-pressed={tab==='payments'} onClick={()=>set({tab:'transactions',type:'payments',page:null})}>{text('Bid payments','የጨረታ ክፍያዎች')}</button><button type="button" aria-pressed={tab==='activity'} onClick={()=>set({tab:'transactions',type:'activity',page:null})}>{text('Wallet activity','የቦርሳ እንቅስቃሴ')}</button><button type="button" aria-pressed={tab==='transfers'} onClick={()=>set({tab:'transactions',type:'deposits',page:null})}>{text('Past transfers','ያለፉ ዝውውሮች')}</button></div>
    {tab==='payments'&&<PaymentHistory/>}
    {tab!=='payments'&&<div className={styles.panelHead}><h2>{tab==='activity'?text('Wallet activity','የቦርሳ እንቅስቃሴ'):text('Past transfers','ያለፉ ዝውውሮች')}</h2><button className={styles.textButton} type="button" disabled={query.fetching||transfers.fetching} onClick={()=>tab==='activity'?query.reload():transfers.reload()}><RefreshCw size={13} aria-hidden="true"/>{text('Refresh','አድስ')}</button></div>}
    {tab==='activity'&&view&&<>{!view.activity.length&&<div className={styles.empty}><WalletIcon size={26} aria-hidden="true"/><h2>{text('No wallet activity yet','የቦርሳ እንቅስቃሴ ገና የለም')}</h2><p>{text('Credits, fees and refunds will appear here.','ገቢዎች፣ ክፍያዎች እና ተመላሾች እዚህ ይታያሉ።')}</p></div>}<div className={styles.list}>{view.activity.map(item=><article key={item.id} className={styles.activityRow}><Clock3 size={18} aria-hidden="true"/><div><strong>{(names[item.kind]??['ETB journal entry','የETB መዝገብ'])[am?1:0]}</strong><small>{date(item.at)}</small></div><span>{formatEtb(item.availableDelta)}{etbToCents(item.heldDelta)!==0n&&<small>{formatEtb(item.heldDelta)} {text('held','የተያዘ')}</small>}</span></article>)}</div><PersonalPagination page={page} totalPages={view.totalPages} setPage={setPage}/></>}
    {tab==='transfers'&&<><PrivateState query={transfers}/>{transfers.data&&!transfers.data.items.length&&<div className={styles.empty}><h2>{text('No past transfers','ያለፉ ዝውውሮች የሉም')}</h2><p>{text('Existing transfer receipts will appear here.','ነባር የዝውውር ደረሰኞች እዚህ ይታያሉ።')}</p></div>}<div className={styles.list}>{transfers.data?.items.map(item=><button className={styles.bidRow} type="button" key={item.id} onClick={()=>setSelected(item)}><Clock3 size={19} aria-hidden="true"/><span className={styles.rowBody}><span className={styles.rowTitle}>{paymentChannelName(item.channel)}{item.demo?' · DEMO':''}</span><span className={styles.rowMeta}>{date(item.createdAt)}</span><span className={styles.pill}>{(statuses[item.status]??['Pending review','ግምገማ በመጠባበቅ ላይ'])[am?1:0]}</span></span><strong>{formatEtb(item.points)}</strong></button>)}</div><PersonalPagination page={page} totalPages={transfers.data?.totalPages??0} setPage={setPage}/></>}
    <p className={styles.caption}>{text('Need help with an existing payment?','በነባር ክፍያ ላይ እገዛ ይፈልጋሉ?')} <TelegramLink>{text('Contact support','ድጋፍ ያግኙ')}</TelegramLink></p>
    {transfer&&query.status==='authenticated'&&<AccountSheet title={text('Transfer receipt','የዝውውር ደረሰኝ')} onClose={()=>setSelected(null)}><div className={styles.receiptTitle}><h3>{formatEtb(transfer.points)}</h3><span className={styles.pill}>{(statuses[transfer.status]??['Pending review','ግምገማ በመጠባበቅ ላይ'])[am?1:0]}</span></div><dl className={styles.facts}><div><dt>{text('Channel','የክፍያ መንገድ')}</dt><dd>{paymentChannelName(transfer.channel)}</dd></div><div><dt>{text('Created','የተፈጠረበት')}</dt><dd>{date(transfer.createdAt)}</dd></div><div><dt>{text('Reference','የዝውውር መለያ')}</dt><dd>{transfer.reference??'—'}</dd></div><div><dt>{text('Receipt ID','የደረሰኝ መለያ')}</dt><dd>{transfer.id}</dd></div></dl>{transfer.status!=='CREDITED'&&<p className={styles.notice}>{text('This record is not a confirmation of credit. Contact support with the receipt ID if verification needs review.','ይህ መዝገብ ገንዘብ መግባቱን አያረጋግጥም። ማረጋገጥ ግምገማ ከፈለገ የደረሰኙን መለያ በመጠቀም ድጋፍ ያግኙ።')}</p>}<Link className={styles.action} href="/profile/support" onClick={()=>setSelected(null)}>{text('Payment support','የክፍያ ድጋፍ')}</Link></AccountSheet>}
  </section>;
}
