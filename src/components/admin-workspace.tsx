'use client';
import {adminRequest,useAdminQuery} from './admin-query';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {AdminAuctionSummary} from './admin-results';
import {AdminAuctionDraft,AdminAuctionHomeOrderField,readAuctionHomeOrder} from './admin-auction-draft';
import {AdminAuctionProductReplacement,type AuctionProductReplacement} from './admin-auction-product-replacement';
import type {AdminAuctionProduct} from './admin-auction-product-picker';
import {AdminAuctionDeadlineField,AdminAuctionStartField,parseAuctionScheduleTime} from './admin-auction-schedule-preview';
import {AdminImageUpload} from './admin-catalog';
import {AdminProductDescription} from './admin-product-description';
import {ResultExplanation} from './auction-rule';
import {useAdminAccess} from './admin-shell';
import {Status,Evidence,eat} from './admin-ui';
import {notifyAdminAction} from './admin-action-toast';
import {PageLoading} from '@/components/loading-spinner';
import {useMiniLocale} from './mini-locale';


import {AdminLink as Link} from './admin-query';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowUpRight,Plus,RefreshCw,ShieldCheck,Star,StarOff} from 'lucide-react';
type Row=Record<string,any>; // JSON-only admin projection; never reused by public components.
const read=(path:string)=>adminRequest<any>(path);
const command=(action:string,input:Row)=>adminRequest<any>('command',{action,input});
const date=eat;
const emptyDraft:Row={};
function Field({label,name,value='',type='text',required=true}:{label:string;name:string;value?:string;type?:string;required?:boolean}){return <label>{label}<input name={name} defaultValue={value} type={type} step={type==='number'?"0.01":undefined} required={required}/></label>}
function DataTable({rows,columns}:{rows:Row[];columns:[string,(row:Row)=>React.ReactNode][]}){return <div className="admin-table-wrap"><table><thead><tr>{columns.map(([title])=><th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={row.id??row.auctionId??index}>{columns.map(([title,render])=><td key={title}>{render(row)}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="admin-empty">Nothing here yet.</p>}</div>}
export function AdminWorkspace({path}:{path:string[]}){
  const access=useAdminAccess(),router=useRouter(),section=path[0]??'dashboard',auctionId=section==='auctions'&&path[1]&&path[1]!=='new'?path[1]:null;
  const {language}=useMiniLocale(),phrase=(en:string,am:string)=>language==='am'?am:en;
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[filter,setFilter]=useState(''),[products,setProducts]=useState<AdminAuctionProduct[]>([]),[productError,setProductError]=useState(''),[pendingAction,setPendingAction]=useState(''),[uploading,setUploading]=useState(false),[edit,setEdit]=useState<Row|null>(null),[impact,setImpact]=useState<Row|null>(null),[preflight,setPreflight]=useState<Row|null>(null),[auctionTab,setAuctionTab]=useState('details'),[selectedManageTab,setManageTab]=useState('deadline'),[media,setMedia]=useState<string[]>([]),[key,setKey]=useState(''),[draftDirty,setDraftDirty]=useState(false),[presentationDirty,setPresentationDirty]=useState(false);
  const pending=useRef(false),presentationEdited=useRef(false),busy=!!pendingAction;
  const homePlacementAttempt=useRef<{signature:string;key:string}|null>(null);
  const replacementAttempt=useRef<{signature:string;key:string}|null>(null);
  const changePresentation=()=>{presentationEdited.current=true;setPresentationDirty(true);setKey(crypto.randomUUID())};
  const location=path.join('/');
  const isNew=section==='auctions'&&path[1]==='new',resource=auctionId?`auctions/${auctionId}`:section;
  const canReload=!isNew&&!draftDirty&&!presentationDirty&&!busy&&!uploading;
  const reloadGuard=useRef({location,canReload});
  reloadGuard.current={location,canReload};
  const primary=useAdminQuery<Row|Row[]>(`${resource}?${new URLSearchParams({page:String(page),q,status:filter})}`,{enabled:!isNew}),data=isNew?emptyDraft:primary.data;
  const needsProducts=section==='auctions'&&(isNew||!!data&&!Array.isArray(data)&&!data.publishedAt),lookup=useAdminQuery<{items:AdminAuctionProduct[]}>('products?lookup=1',{enabled:needsProducts});
  useEffect(()=>{setAuctionTab('details')},[location]);
  const error=primary.error||(needsProducts?lookup.error||productError:'');
  useEffect(()=>{setProductError('');setDraftDirty(false);setPresentationDirty(false);presentationEdited.current=false;setImpact(null);setPreflight(null);setEdit(null);setMedia([]);setProducts([]);setKey(crypto.randomUUID())},[location]);
  useEffect(()=>{if(!data||Array.isArray(data)||!data.publishedAt||draftDirty||presentationEdited.current)return;const images=data.presentation?.images??data.product?.images??[];setMedia(images.filter((image:Row)=>String(image.path).startsWith('/api/media/')).map((image:Row)=>String(image.path).split('/').at(-1)!))},[data,draftDirty]);
  useEffect(()=>{if(!needsProducts||!lookup.data)return;let active=true;const rows=lookup.data.items,id=!Array.isArray(data)?data?.draft?.body.productId:null;setProductError('');setProducts(previous=>[...rows,...previous.filter(product=>!rows.some(row=>row.id===product.id))]);if(id&&!rows.some(row=>row.id===id))void read(`products/${id}`).then(product=>{if(active)setProducts(previous=>previous.some(row=>row.id===product.id)?previous:[product,...previous])}).catch(err=>{if(active)setProductError(err.message)});return()=>{active=false}},[needsProducts,lookup.data,data]);
  async function run(action:string,task:()=>Promise<void>){
    if(pending.current)return;
    pending.current=true;setPendingAction(action);
    try{await task()}catch(err){
      const message=err instanceof Error?err.message:'Please retry.';
      const unsaved=draftDirty||presentationDirty;
      const pathname=window.location.pathname;
      notifyAdminAction(unsaved?`${message} Your draft values are kept.`:message,'error',{
        action:!isNew&&!unsaved?{label:'Reload data',onClick:()=>{
          if(window.location.pathname===pathname&&reloadGuard.current.location===location&&reloadGuard.current.canReload)primary.reload();
        }}:undefined,
      });
    }
    finally{pending.current=false;setPendingAction('')}
  }
  const findProducts=useCallback(async(query:string)=>{
    const found=(await adminRequest<{items:AdminAuctionProduct[]}>(`products?lookup=1&q=${encodeURIComponent(query)}`)).items;
    setProducts(previous=>[...found,...previous.filter(product=>!found.some(match=>match.id===product.id))]);
  },[]);
  async function save(action:string,input:Row,success:string|((result:Row)=>string)='Saved. The database confirmed this change.'){
    const result=await command(action,{...input,key});setDraftDirty(false);setKey(crypto.randomUUID());
    notifyAdminAction(typeof success==='string'?success:success(result));return result;
  }
  const list:Row[]=Array.isArray(data)?data:((data as Row)?.items??[]),item=(!Array.isArray(data)?data:null)??{};
  const showFeeTab=isSubmissionFeeOnly(item.terms?.ruleVersion)||Number(item.feeRevisions?.[0]?.feePoints??item.terms?.entryFeePoints)>0;
  const canAdvanceStart=['SCHEDULED','LIVE'].includes(item.status)&&item.displayStatus==='UPCOMING'&&!!item.startsAt&&!!item.endsAt&&!item.result&&item.acceptedBids===0;
  const canReplaceProduct=!!item.product&&['LIVE','UPCOMING'].includes(item.displayStatus)&&!item.result&&!item.settlement;
  const manageTab=(selectedManageTab==='startTime'&&!canAdvanceStart)||(selectedManageTab==='replaceProduct'&&!canReplaceProduct)?'deadline':selectedManageTab;
  const replacementLabel=phrase('Replace product','ምርት ቀይር');
  const managementTools=[...(showFeeTab?[['fee','Submission fee']]:[]),...(canAdvanceStart?[['startTime','Start time']]:[]),['deadline','Deadline'],['presentation','Photos & description'],...(canReplaceProduct?[['replaceProduct',replacementLabel]]:[]),['homeOrder','Home order']];
  const homeOrderEditable=['LIVE','UPCOMING'].includes(item.displayStatus);
  function replaceProduct(selection:AuctionProductReplacement){
    if(!auctionId||!canReplaceProduct||presentationDirty||uploading)return;
    const input={auctionId,version:item.controlVersion,...selection},signature=JSON.stringify(input);
    void run('replaceProduct',async()=>{
      if(replacementAttempt.current?.signature!==signature)replacementAttempt.current={signature,key:crypto.randomUUID()};
      await command('replaceProduct',{...input,key:replacementAttempt.current.key});
      replacementAttempt.current=null;
      notifyAdminAction(phrase('Auction product replaced.','የጨረታው ምርት ተቀይሯል።'));
    });
  }
  function saveHomePlacement(homeOrder:number|null,featured?:boolean){
    if(!auctionId||!homeOrderEditable)return;
    const input={auctionId,version:item.controlVersion,homeOrder,...(featured===undefined?{}:{featured})};
    void run(featured===undefined?'homeOrder':'homeFeature',async()=>{
      const signature=JSON.stringify(input);
      if(homePlacementAttempt.current?.signature!==signature)homePlacementAttempt.current={signature,key:crypto.randomUUID()};
      await command('homeOrder',{...input,key:homePlacementAttempt.current.key});
      homePlacementAttempt.current=null;
      notifyAdminAction(featured===undefined?'Home order saved.':featured?'Auction featured on Home.':'Auction removed from featured placement.');
    });
  }
  const titles:Row={dashboard:['Overview','Your auction operations, at a glance.'],auctions:['Auction work queue','Choose an item, set the schedule, then publish.'],products:['Products','Describe inventory and attach validated, credited images.'],categories:['Categories','Organize the public catalog. Published inventory is protected.'],content:['Home & FAQ','Plain text content. Auction rules remain visible and unchanged.'],reconciliation:['Ledger reconciliation','Read-only account, journal and hold integrity checks.']};
  const title=auctionId?item.presentation?.title??item.product?.title??products.find(p=>p.id===item.draft?.body.productId)?.title??item.code??'Auction':path[1]==='new'?'Create auction':titles[section]?.[0]??'Admin resource';
  return <><header className="admin-page-head"><div><h1>{title}</h1><p>{titles[section]?.[1]}</p></div><div className="admin-actions"><button className="secondary" disabled={draftDirty||presentationDirty||busy||uploading} onClick={()=>{if(!isNew)primary.reload()}} aria-label="Refresh admin data"><RefreshCw size={17}/>Refresh</button>{section==='auctions'&&!path[1]&&<Link className="admin-button" href="/admin/auctions/new"><Plus size={17}/>New draft</Link>}</div></header>
    {error&&<p role="alert" className="admin-error">{error} <button className="admin-text-button" disabled={draftDirty||presentationDirty} onClick={()=>{if(primary.error)primary.reload();else lookup.reload()}}>Reload data</button>{draftDirty&&<span> Your draft values are kept. Correct the issue and save again.</span>}</p>}
    {!data&&!error&&<PageLoading/>}
    {data&&['products','auctions'].includes(section)&&!path[1]&&<><form className="admin-queue-filter" onSubmit={e=>{e.preventDefault();setQ(String(new FormData(e.currentTarget).get('q')));setPage(1)}}><label>Search<input name="q" defaultValue={q}/></label><label>Status<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}><option value="">All</option>{(section==='auctions'?['DRAFT','SCHEDULED','PENDING','CLOSED','CANCELLED']:['VISIBLE','HIDDEN']).map(s=><option key={s}>{s}</option>)}</select></label><button>Search</button></form><p>{item.total} records</p><nav className="admin-pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button disabled={page>=item.totalPages} onClick={()=>setPage(p=>p+1)}>Next page</button></nav></>}
    {data&&section==='auctions'&&!path[1]&&<DataTable rows={list} columns={[["Auction",r=><Link href={`/admin/auctions/${r.id}`}>{r.code}<small>{r.product?.title??'Untitled draft'}{r.isDemo?' · DEMO':''}</small></Link>],['Status',r=>r.publishedAt&&!r.settlement&&r.status!=='CANCELLED'&&new Date(r.endsAt)<new Date()?'Closing / result pending':r.status],['Start',r=>date(r.startsAt)],['End',r=>date(r.endsAt)]]}/>}
    {data&&section==='auctions'&&(path[1]==='new'||auctionId)&&<>
      {item.publishedAt?<><nav className="admin-local-tabs" aria-label="Auction workspace">{['details',...(!item.settlement||item.status==='CANCELLED'?['manage']:[]),'history'].map(tab=><button key={tab} aria-current={auctionTab===tab?'page':undefined} onClick={()=>setAuctionTab(tab)}>{tab==='details'?(item.settlement?'Result':'Details'):tab==='manage'?'Manage':'History'}</button>)}</nav>{auctionTab==='details'&&<AdminAuctionSummary item={item}/>}
      {auctionTab==='manage'&&!item.settlement&&access.role==='OWNER'&&<section id="auction-manage" className="admin-panel"><h2>Manage auction</h2><p>Changes require your current staff permissions and the latest control version. Previous bid receipts remain unchanged.</p><nav className="admin-local-tabs" aria-label="Management tools">{managementTools.map(([tab,label])=><button key={tab} aria-current={manageTab===tab?'page':undefined} onClick={()=>setManageTab(tab)}>{label}</button>)}</nav>
      {manageTab==='replaceProduct'&&canReplaceProduct&&(
        presentationDirty?<p role="status" className="admin-group-note">{phrase('Save your public corrections before replacing the product.','ምርቱን ከመቀየርዎ በፊት ያስተካከሉትን የጨረታ መረጃ ያስቀምጡ።')}</p>:
        <AdminAuctionProductReplacement key={`${auctionId}:${item.product.id}`} current={item.product} code={item.code} isDemo={item.isDemo}
         publishedTitle={language==='am'?(item.presentation?.titleAm||item.presentation?.title||item.product.titleAm||item.product.title):(item.presentation?.title??item.product.title)}
         busy={busy||uploading} saving={pendingAction==='replaceProduct'} onSave={replaceProduct}/>
      )}
      {canAdvanceStart&&<div className="auction-manage-form" hidden={manageTab!=='startTime'}>
        <form key={item.startsAt} className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{
          event.preventDefault();
          const fields=new FormData(event.currentTarget);
          const next=parseAuctionScheduleTime(String(fields.get('startsAt')??''));
          run('startTime',async()=>{
            if(!next)throw Error('Enter a valid date and time with AM or PM.');
            await save('startTime',{auctionId,version:item.controlVersion,startsAt:next.toISOString(),reason:fields.get('reason')},'Earlier start time saved.');
          });
        }}>
          <h3>Open the auction earlier</h3>
          <p className="admin-group-note">Starts {date(item.startsAt)}. Choose an earlier opening time in Addis Ababa.</p>
          {manageTab==='startTime'&&<AdminAuctionStartField startsAt={item.startsAt} endsAt={item.endsAt}/>}
          <label>Reason<textarea name="reason" required maxLength={1000}/></label>
          <button disabled={busy} aria-busy={pendingAction==='startTime'}>{pendingAction==='startTime'?'Saving start time…':'Save earlier start time'}</button>
        </form>
      </div>}
      <div className="auction-manage-form" hidden={manageTab!=='homeOrder'}>
        <form className="admin-form" onSubmit={event=>{
          event.preventDefault();
          saveHomePlacement(readAuctionHomeOrder(new FormData(event.currentTarget)));
        }}>
          <div className="auction-home-placement">
            <div><h3>Home placement</h3><p className="admin-group-note">{item.featured?'Featured on Home. Featured auctions come first among automatically ordered auctions.':'Regular placement. Feature this auction to give it priority in automatic ordering.'}</p></div>
            <button type="button" className={item.featured?'secondary':undefined} disabled={busy||!homeOrderEditable} aria-busy={pendingAction==='homeFeature'} onClick={()=>saveHomePlacement(item.homeOrder??null,!item.featured)}>
              {item.featured?<StarOff size={16} aria-hidden="true"/>:<Star size={16} aria-hidden="true"/>}
              {pendingAction==='homeFeature'?'Saving…':item.featured?'Unfeature from Home':'Feature on Home'}
            </button>
          </div>
          <AdminAuctionHomeOrderField key={`${auctionId}:${item.homeOrder??'automatic'}`} value={item.homeOrder} disabled={busy||!homeOrderEditable}/>
          {!homeOrderEditable&&<p className="admin-group-note">Home settings apply to live and upcoming auctions.</p>}
          <button type="submit" disabled={busy||!homeOrderEditable} aria-busy={pendingAction==='homeOrder'}>{pendingAction==='homeOrder'?'Saving…':'Save Home order'}</button>
        </form>
      </div>
      <div className="auction-manage-form"><form hidden={manageTab!=='fee'} className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);run('fee',async()=>{await save('fee',{auctionId,version:item.controlVersion,feePoints:f.get('feePoints'),reason:f.get('reason')})})}}><h3>Submission fee</h3>{isSubmissionFeeOnly(item.terms?.ruleVersion)?<label>Fee per accepted bid (ETB)<input name="feePoints" inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})([.][0-9]{1,2})?" defaultValue={item.feeRevisions?.[0]?.feePoints??item.terms?.entryFeePoints} required/></label>:<><p>This auction uses its original bid-hold rules. Only removal of its extra fee is supported.</p><input type="hidden" name="feePoints" value="0"/></>}<label>Reason<textarea name="reason" required maxLength={1000}/></label><button disabled={busy} aria-busy={pendingAction==='fee'}>{pendingAction==='fee'?'Updating fee…':'Apply to future bids'}</button></form><form hidden={manageTab!=='deadline'} className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{
        event.preventDefault();
        const fields=new FormData(event.currentTarget);
        const next=parseAuctionScheduleTime(String(fields.get('endsAt')??''));
        const confirmation=String(fields.get('overrideConfirmation')??'').trim();
        run('deadline',async()=>{
          if(!next)throw Error('Enter a valid date and time with AM or PM.');
          await save('deadline',{
            auctionId,version:item.controlVersion,endsAt:next.toISOString(),reason:fields.get('reason'),
            ...(confirmation?{overrideConfirmation:confirmation}:{}),
          },result=>result.paidShorteningOverride?'Shorter deadline saved and recorded as an owner override.':'Auction deadline saved.');
        });
      }}>
        <h3>Deadline</h3>
        <AdminAuctionDeadlineField key={`deadline-editor:${item.endsAt}`} endsAt={item.endsAt} showPreview={manageTab==='deadline'}/>
        <p className="admin-group-note">Maximum extension: {item.terms?.maxExtensionMinutes} minutes after the published deadline. Shortening after bids: {item.terms?.allowPaidShortening?`allowed with ${item.terms.shortenNoticeMinutes} minutes notice`:'restricted by the published rules'}.</p>
        {item.terms?.allowPaidShortening===false&&Number(item.acceptedBidCount??item.acceptedBids)>0&&<details key={`deadline-override:${item.endsAt}`} className="admin-evidence">
          <summary>Override shortening restriction</summary>
          <p>This owner action closes the auction earlier than its published rules permit. Choose an earlier end time at least five minutes from now and give a reason for the audit record.</p>
          <label>Type {item.code} to authorize this override<input name="overrideConfirmation" autoComplete="off" maxLength={100}/></label>
        </details>}
        <label>Reason<textarea name="reason" required maxLength={1000}/></label>
        <button disabled={busy} aria-busy={pendingAction==='deadline'}>{pendingAction==='deadline'?'Updating deadline…':'Change deadline'}</button>
      </form></div><div hidden={manageTab!=='presentation'}><form key={item.product?.id} className="admin-form" onChange={changePresentation} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);run('presentation',async()=>{const saved=await save('presentation',{auctionId,version:item.controlVersion,title:f.get('title'),titleAm:f.get('titleAm'),description:f.get('description'),descriptionAm:f.get('descriptionAm'),condition:f.get('condition'),conditionAm:f.get('conditionAm'),imageIds:media,reason:f.get('reason')});presentationEdited.current=false;setPresentationDirty(false);setMedia(saved.presentation.images.map((image:Row)=>String(image.path).split('/').at(-1)!))})}}><h3>Public presentation</h3><Field name="title" label="Title (English)" value={item.presentation?.title??item.product?.title}/><Field name="titleAm" label="Title (Amharic)" value={item.presentation?.titleAm??item.product?.titleAm??''}/><AdminProductDescription description={item.presentation?.description??item.product?.description} descriptionAm={item.presentation?.descriptionAm??item.product?.descriptionAm}/><Field name="condition" label="Condition (English)" value={item.presentation?.condition??item.product?.condition}/><Field name="conditionAm" label="Condition (Amharic)" value={item.presentation?.conditionAm??item.product?.conditionAm??''}/><div className="admin-image-strip">{media.map(id=><figure key={id}><img src={`/api/media/${id}`} alt="Auction presentation"/><button type="button" className="admin-text-button" disabled={busy||uploading} onClick={()=>{changePresentation();setMedia(v=>v.filter(value=>value!==id))}}>Remove</button>{media[0]===id?<small>Cover photo</small>:<button type="button" className="admin-text-button" disabled={busy||uploading} onClick={()=>{changePresentation();setMedia(v=>[id,...v.filter(value=>value!==id)])}}>Use as cover</button>}</figure>)}</div><AdminImageUpload onBusyChange={setUploading} disabled={busy||uploading||media.length>=8} onAttach={id=>{changePresentation();setMedia(v=>v.length<8?[...v,id]:v);notifyAdminAction('Photo uploaded. Save public corrections below to publish it.')}}/><p className="admin-group-note">The first photo is the cover. Uploads and removals appear publicly only after you save.</p><label>Reason<textarea name="reason" required maxLength={1000}/></label><button disabled={busy||uploading||!media.length}>{pendingAction==='presentation'?'Saving…':'Save public corrections'}</button>{presentationDirty&&<small role="status">Unsaved public corrections</small>}</form></div>{null}</section>}
      {auctionTab==='history'&&<section id="auction-history" className="admin-panel"><h2>Control history</h2><p>Append-only changes for this auction. Settlement evidence keeps every accepted fee revision.</p><DataTable rows={item.controlRevisions??[]} columns={[["When",r=>date(r.createdAt)],["Change",r=>r.kind],["Reason",r=>r.reason],["Version",r=>r.version]]}/></section>}
      {item.settlement&&auctionTab==='manage'?<section className="admin-panel"><h2>Final outcome: {item.settlement.outcome}</h2><p>Completed {date(item.settlement.completedAt)}. {item.settlement.outcome==='WINNER'?'Open deliveries for the current fulfillment state.':'No prize fulfillment is due.'}</p><p><ResultExplanation outcome={item.settlement.outcome} decision={item.settlement.decision} ruleVersion={item.settlement.ruleVersion}/></p>{item.settlement.winningPoints&&<p>Winning bid: {item.settlement.winningPoints}{isSubmissionFeeOnly(item.settlement.ruleVersion)?'':' ETB'}</p>}{item.settlement.outcome==='WINNER'&&access.permissions.includes('fulfillment')&&<p><Link href={`/admin/fulfillment?q=${encodeURIComponent(item.code)}`}>Open delivery →</Link></p>}{access.permissions.includes('audit')&&<Link className="admin-button secondary" href={`/admin/auctions/${auctionId}/proof`}>Open result</Link>}{item.status==='CANCELLED'&&<><button className="secondary" disabled={busy} onClick={()=>run('replace',async()=>{const result=await save('replace',{auctionId});router.push(`/admin/auctions/${result.auctionId}`)})}>Create replacement draft</button>{item.slug&&item.product?.visible&&<form className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);run('removeCancelled',async()=>{await save('removeCancelled',{auctionId,version:item.controlVersion,confirmation:f.get('confirmation'),reason:f.get('reason')})})}}><h3>Remove this listing from the public site</h3><p>The listing disappears from categories and its direct link stops working. Settlement, payment and audit records remain in Admin.</p><label>Reason<textarea name="reason" required maxLength={1000}/></label><Field label={`Type ${item.code} to confirm`} name="confirmation"/><button className="danger" disabled={busy}>Remove listing from public site</button></form>}</>}</section>:!item.settlement&&auctionTab==='manage'&&access.permissions.includes('cancel')?<section className="admin-panel"><details><summary>Cancel this auction</summary><h2>Controlled cancellation</h2><p>Review every refund before cancelling. This cannot alter a settled result.</p><button className="secondary" disabled={busy} onClick={()=>run('impact',async()=>setImpact(await read(`auctions/${auctionId}/impact`)))}>{pendingAction==='impact'?'Checking refunds…':'Review cancellation impact'}</button>{impact&&<><p className="admin-notice">{impact.affectedBidders} affected bidders · {impact.heldPoints} ETB held to release · {impact.feeRefund} ETB in fees to refund</p><DataTable rows={impact.participants} columns={[["Internal participant",r=>r.userId],['Held ETB',r=>r.heldPoints],['Fee refund',r=>r.feeRefund],['Accepted bids',r=>r.acceptedBids]]}/><form className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);run('cancel',async()=>{await save('cancel',{auctionId,reason:f.get('reason'),confirmation:f.get('confirmation'),impactHash:impact.impactHash})})}}><label>Cancellation reason<textarea name="reason" required maxLength={1000}/></label><Field label={`Type ${item.code} to confirm`} name="confirmation"/><button disabled={busy} className="danger">{pendingAction==='cancel'?'Cancelling…':'Cancel auction'}</button></form>{null}</>}</details></section>:null}</>:
      <AdminAuctionDraft key={`${auctionId??'new'}:${item.draft?.version??0}`} item={item} products={products} auctionId={auctionId} busy={busy} owner={access.role==='OWNER'} dirty={draftDirty} preflight={preflight}
       onChange={()=>{setKey(crypto.randomUUID());setPreflight(null);setDraftDirty(true)}}
       onFind={findProducts}
       onSave={body=>run('draft',async()=>{const result=await save('draft',{...(auctionId?{auctionId}:{}),version:item.draft?.version??0,body});router.push(`/admin/auctions/${result.auctionId}`)})}
       onReview={()=>run('preflight',async()=>setPreflight(await read(`auctions/${auctionId}/preflight`)))}
       onPublish={()=>run('publish',async()=>{await save('publish',{auctionId,version:preflight?.version})})}/>}</>}
    {data&&section==='auctions'&&auctionId&&!item.publishedAt&&<section className="admin-panel"><details><summary>Delete unused draft</summary><form className="admin-form" onChange={()=>setKey(crypto.randomUUID())} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);run('deleteDraft',async()=>{await save('deleteDraft',{auctionId,confirmation:f.get('confirmation'),reason:f.get('reason')});router.push('/admin/auctions')})}}><p>Only an unpublished draft with no bids, holds or live history can be deleted.</p><label>Reason<textarea name="reason" required maxLength={1000}/></label><Field label={`Type ${item.code} to confirm`} name="confirmation"/><button className="danger" disabled={busy}>Delete draft</button></form></details></section>}
    {data&&section==='reconciliation'&&<section className="admin-panel"><h2>Database reconciliation report</h2><p>Read-only. Corrections require an audited operational investigation; there is no balance editor.</p><p role="status">{item.drift?.length?`${item.drift.length} discrepancies require investigation.`:'No drift found across accounts, holds, bid fees, refunds or settlement charges.'}</p><DataTable rows={item.drift??[]} columns={[["Check",r=>r.kind],["Account or reference",r=>r.name],["Projected",r=>r.projected],["Journal / hold total",r=>r.actual]]}/></section>}
  </>;
}
