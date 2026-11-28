'use client';
import {AdminLink as Link} from './admin-query';
import {useId,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Plus} from 'lucide-react';
import {AdminPhoto} from './admin-catalog';
import {AdminAuctionProductPicker,type AdminAuctionProduct} from './admin-auction-product-picker';
import {AdminAuctionDateTimeField,AdminAuctionSchedulePreview,parseAuctionScheduleTime} from './admin-auction-schedule-preview';
import {eat} from './admin-ui';
import {ADDIS_ABABA_TIME_LABEL,formatAddisDateTimeLocal} from '@/lib/addis-time';

type Row=Record<string,any>;
type Props={item:Row;products:AdminAuctionProduct[];auctionId:string|null;busy:boolean;owner:boolean;dirty:boolean;preflight:Row|null;onChange:()=>void;onFind:(query:string)=>Promise<void>;onSave:(body:Row)=>void;onReview:()=>void;onPublish:()=>void};
const dateLabel=(value:Date|null)=>value?eat(value):'Choose a time';

export function AdminAuctionHomeOrderField({value,disabled=false}:{value?:number|null;disabled?:boolean}){
 const hint=useId();
 return <div>
  <label>Home order<input name="homeOrder" type="number" min={1} max={2147483647} step={1} defaultValue={value??''} placeholder="Automatic" aria-describedby={hint} disabled={disabled}/></label>
  <p id={hint} className="admin-group-note">Numbered auctions come first. If a slot is taken, the other auction moves to your old slot or shifts down. Leave blank for automatic placement.</p>
 </div>;
}

export function readAuctionHomeOrder(form:FormData){
 const value=form.get('homeOrder');
 return value===null||value===''?null:Number(value);
}

export function AdminAuctionDraft({item,products,auctionId,busy,owner,dirty,preflight,onChange,onFind,onSave,onReview,onPublish}:Props){
 const body=item.draft?.body??{},form=useRef<HTMLFormElement>(null),[step,setStep]=useState(auctionId?2:0),[language,setLanguage]=useState('en');
 const [productId,setProductId]=useState<string>(body.productId??''),[fee,setFee]=useState(body.entryFeePoints??''),[start,setStart]=useState(formatAddisDateTimeLocal(body.startsAt)),[end,setEnd]=useState(formatAddisDateTimeLocal(body.endsAt));
 const [startOnPublish,setStartOnPublish]=useState(body.startOnPublish===true);
 const previewStart=startOnPublish?formatAddisDateTimeLocal(new Date()):start;
 const startTime=parseAuctionScheduleTime(previewStart),endTime=parseAuctionScheduleTime(end);
 const product=products.find(p=>p.id===productId),duration=startTime&&endTime?(endTime.getTime()-startTime.getTime())/86400000:0;
 const steps=['Product','Schedule','Delivery & publish'],[editingDelivery,setEditingDelivery]=useState(false),[summaryExpanded,setSummaryExpanded]=useState(false),summaryId=useId();
 const reviewMode=step===2&&!!auctionId&&!dirty&&!editingDelivery;
 function revealInvalid(all=false){
  const fields=Array.from(form.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')??[]);
  const invalid=fields.find(field=>(all||field.closest('fieldset[data-step]')?.getAttribute('data-step')===String(step))&&!field.validity.valid);
  if(!invalid)return false;
  const destination=Number(invalid.closest('fieldset[data-step]')?.getAttribute('data-step')??0);setStep(destination);
  if(invalid.name.endsWith('Am'))setLanguage('am');else if(invalid.name.startsWith('fulfillment'))setLanguage('en');
  const details=invalid.closest('details');if(details)details.open=true;
  requestAnimationFrame(()=>{invalid.focus();invalid.reportValidity()});return true;
 }
 function preset(days:number){if(!startTime)return;setEnd(formatAddisDateTimeLocal(new Date(startTime.getTime()+days*86400000)));onChange()}
 function submit(){if(revealInvalid(true)||!startTime||!endTime)return;const f=new FormData(form.current!);onSave({productId,startsAt:startTime.toISOString(),...(startOnPublish?{startOnPublish:true}:{}),endsAt:endTime.toISOString(),minPoints:'1.00',stepPoints:'0.01',entryFeePoints:fee,fulfillmentSummary:f.get('fulfillmentSummary'),fulfillmentSummaryAm:f.get('fulfillmentSummaryAm'),fulfillmentRegion:f.get('fulfillmentRegion'),fulfillmentRegionAm:f.get('fulfillmentRegionAm'),featured:f.get('featured')==='on',homeOrder:readAuctionHomeOrder(f),maxExtensionMinutes:Number(f.get('maxExtensionMinutes')),allowPaidShortening:f.get('allowPaidShortening')==='on',shortenNoticeMinutes:Number(f.get('shortenNoticeMinutes'))})}
 return <div className="auction-draft-layout">
  <section className="admin-panel auction-draft-main">
   <nav className="auction-draft-steps" aria-label="Auction setup steps">{steps.map((label,index)=><button type="button" key={label} aria-current={step===index?'step':undefined} disabled={busy} onClick={()=>setStep(index)}><span>{index+1}</span>{label}</button>)}</nav>
   <form ref={form} hidden={reviewMode} className="admin-form auction-draft-form" noValidate onChange={onChange} onSubmit={event=>{event.preventDefault();if(step<2){if(!revealInvalid())setStep(step+1)}else submit()}}>
    <fieldset data-step="0" hidden={step!==0} disabled={busy}>
     <legend>Choose your product</legend><p>Pick the item you want to auction.</p>
     <AdminAuctionProductPicker products={products} value={productId} onFind={onFind} onChange={id=>{setProductId(id);onChange()}}/>
     {product&&<div className="auction-selected-product"><AdminPhoto src={product.images?.[0]?.path} alt={product.title}/><div><strong>{product.title}</strong><small>{product.category?.name} · {product.condition}{product.isDemo?' · DEMO':''}</small></div></div>}
     <Link href="/admin/products" target="_blank" rel="noopener noreferrer" className="auction-add-product"><Plus size={16}/>Add a product</Link>
     <label className="admin-check"><input type="checkbox" name="featured" defaultChecked={body.featured??false}/>Feature on Home</label>
     <AdminAuctionHomeOrderField value={body.homeOrder}/>
    </fieldset>
    <fieldset data-step="1" hidden={step!==1} disabled={busy}>
     <legend>Set the schedule</legend><p>Enter times in {ADDIS_ABABA_TIME_LABEL}.</p>
     <label>Start bidding<select value={startOnPublish?'publish':'schedule'} onChange={event=>setStartOnPublish(event.target.value==='publish')}><option value="schedule">At a scheduled time</option><option value="publish">When published</option></select></label>
     <div className={startOnPublish?undefined:'admin-two'}>{!startOnPublish&&<AdminAuctionDateTimeField label="Starts" name="startsAt" value={start} onChange={setStart}/>}<AdminAuctionDateTimeField label="Ends" name="endsAt" value={end} after={previewStart} onChange={setEnd}/></div>
     <div className="auction-duration" role="group" aria-label="Auction duration"><span>Run for</span>{[7,14,21].map(days=><button type="button" className="secondary" key={days} disabled={!startTime} aria-pressed={duration===days} onClick={()=>preset(days)}>{days} days</button>)}</div>
     {step===1&&<AdminAuctionSchedulePreview start={previewStart} end={end}/>}
     <label>Submission fee (ETB)<input name="entryFeePoints" inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})([.][0-9]{1,2})?" value={fee} onChange={event=>setFee(event.target.value)} placeholder="Set the fee for this auction" required/><small>Charged per accepted bid. On cancellation, actual paid cash fees return to wallet cash; bonus returns as bonus, never cash.</small></label><div className="auction-fixed-rules"><Check size={18}/><p><strong>Numbers from 1.00 · 0.01 steps</strong><span>No maximum. Players pay only the submission fee.</span></p></div>
     <details className="auction-deadline-options"><summary>Deadline change settings</summary><p>These limits apply after publication.</p><div className="admin-two"><label>Maximum extension (minutes)<input type="number" name="maxExtensionMinutes" min="0" max="43200" step="1" defaultValue={body.maxExtensionMinutes??10080} required/><small>10,080 minutes = 7 days</small></label><label>Shortening notice (minutes)<input type="number" name="shortenNoticeMinutes" min="5" max="10080" step="1" defaultValue={body.shortenNoticeMinutes??1440} required/><small>1,440 minutes = 24 hours</small></label></div><label className="admin-check"><input name="allowPaidShortening" type="checkbox" defaultChecked={body.allowPaidShortening??false}/>Allow shortening after bids with this notice</label></details>
    </fieldset>
    <fieldset data-step="2" hidden={step!==2} disabled={busy}>
     <legend>Delivery details</legend><p>Tell the winner where and how to receive the item.</p>
     <div className="auction-language-tabs" role="group" aria-label="Delivery language">{[['en','English'],['am','አማርኛ']].map(([value,label])=><button type="button" className="secondary" key={value} aria-pressed={language===value} onClick={()=>setLanguage(value)}>{label}</button>)}</div>
     <div hidden={language!=='en'} className="auction-delivery-fields"><label>Delivery information (English)<textarea name="fulfillmentSummary" defaultValue={body.fulfillmentSummary??''} required maxLength={500} rows={3}/></label><label>Delivery area (English)<input name="fulfillmentRegion" defaultValue={body.fulfillmentRegion??''} required maxLength={160}/></label></div>
     <div hidden={language!=='am'} className="auction-delivery-fields" lang="am"><label>Delivery information (Amharic)<textarea name="fulfillmentSummaryAm" defaultValue={body.fulfillmentSummaryAm??''} required maxLength={500} rows={3}/></label><label>Delivery area (Amharic)<input name="fulfillmentRegionAm" defaultValue={body.fulfillmentRegionAm??''} required maxLength={160}/></label></div>
    </fieldset>
    <footer className="auction-draft-actions"><span>Step {step+1} of 3</span><div>{step>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>setStep(step-1)}><ArrowLeft size={16}/>Back</button>}<button type="submit" disabled={busy}>{busy?'Saving…':step<2?'Continue':'Save draft'}{step<2&&<ArrowRight size={16}/>}</button></div></footer>
   </form>
   {reviewMode&&<section className="auction-delivery-review"><div><h2>Delivery details</h2><button type="button" className="secondary" onClick={()=>setEditingDelivery(true)}>Edit details</button></div><div className="auction-language-tabs" role="group" aria-label="Delivery language"><button type="button" className="secondary" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>English</button><button type="button" className="secondary" aria-pressed={language==='am'} onClick={()=>setLanguage('am')}>Amharic</button></div><p>{language==='en'?body.fulfillmentSummary:body.fulfillmentSummaryAm}</p><small>{language==='en'?body.fulfillmentRegion:body.fulfillmentRegionAm}</small></section>}
   {step===2&&auctionId&&!editingDelivery&&<section className="auction-draft-publish" aria-label="Publish auction"><h2>Ready to publish?</h2>{dirty?<p>Save your changes to check this draft.</p>:<p>Check the saved item, schedule and delivery details.</p>}<button className="secondary" disabled={busy||dirty} onClick={onReview}>Check draft</button>{preflight&&!dirty&&<><p className={preflight.ready?'auction-check-ready':'admin-error'} role="status">{preflight.ready?'All checks passed. Review the details, then publish.':'Update the details below, then save again.'}</p>{!preflight.ready&&<ul>{preflight.errors.map((error:string)=><li key={error}>{error}</li>)}</ul>}{preflight.ready&&owner&&<>{null}<button disabled={busy} onClick={onPublish}>Publish auction</button></>}{preflight.ready&&!owner&&<p>The Owner can publish this draft.</p>}</>}</section>}
  </section>
  <aside className="auction-draft-summary" aria-label="Draft summary">
   <div className="auction-summary-heading"><h2>Draft summary</h2><button type="button" className="secondary" aria-controls={summaryId} aria-expanded={summaryExpanded} onClick={()=>setSummaryExpanded(!summaryExpanded)}>{summaryExpanded?'Hide':'Show'}</button></div>
   <p className="auction-draft-status">{dirty?'Unsaved changes':auctionId?'Saved draft':'Not published'}</p>
   <div id={summaryId} className={`auction-summary-content ${summaryExpanded?'is-expanded':''}`}>
    <AdminPhoto src={product?.images?.[0]?.path} alt={product?.title??'Product preview'}/><h3>{product?.title??'Your product appears here'}</h3>{product?.isDemo&&<span className="admin-tag">DEMO</span>}
    <dl><div><dt>Starts</dt><dd>{startOnPublish?'When published':dateLabel(startTime)}</dd></div><div><dt>Ends</dt><dd>{dateLabel(endTime)}</dd></div>{duration>0&&<div><dt>Duration</dt><dd>{Number(duration.toFixed(2))} days</dd></div>}<div><dt>Minimum bid</dt><dd>1.00</dd></div><div><dt>Submission fee</dt><dd>{fee?`${fee} ETB`:'Set a fee'}</dd></div></dl>
    <p className="auction-draft-rule">lowest-unique-v5: lowest unique number wins. No unique number or fewer than 2 eligible players cancels the auction and returns actual paid fees. Up to 100 numbers per player.</p>
   </div>
  </aside>
 </div>;
}
