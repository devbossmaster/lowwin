'use client';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {AdminHeading,ErrorNotice,eat,useAdminMutation,useAdminRead} from './admin-ui';
import type {DepositBonusAdminRead,DepositBonusPolicyReceipt} from '@/modules/admin/deposit-bonus';
import styles from './admin-deposit-bonus.module.css';

const localDate=(value:string|null)=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export function AdminDepositBonus(){
 const query=useAdminRead<DepositBonusAdminRead>('bonus'),mutation=useAdminMutation('bonus'),[dirty,setDirty]=useState(false),[saved,setSaved]=useState<DepositBonusPolicyReceipt|null>(null),data=query.data,policy=data?.policy;
 return <>
  <AdminHeading title="Bonus" description="Reward qualifying wallet deposits with extra bidding funds."><button className="secondary" disabled={dirty||mutation.busy||query.loading} onClick={query.reload}><RefreshCw size={17} aria-hidden="true"/>Refresh</button></AdminHeading>
  <ErrorNotice error={query.error} retry={query.reload}/>
  {!data&&query.loading&&<p role="status">Loading bonus settings…</p>}
  {data&&policy&&<div className={styles.workspace}>
   <section className="admin-panel">
    <div className={styles.heading}><div><h2>Deposit bonus</h2><p>{policy.version?`Version ${policy.version} · Updated ${eat(policy.updatedAt)}`:'Draft settings · Not yet enabled'}</p></div><span className={`admin-status ${!policy.enabled?'is-caution':''}`}>{policy.enabled?'Enabled':'Disabled'}</span></div>
    {!data.schemaReady&&<p className="admin-notice" role="status">The deposit bonus migration is required. Settings will become available after it is applied.</p>}
    <form key={policy.version} className="admin-form" onChange={()=>{setDirty(true);setSaved(null);mutation.clear()}} onSubmit={async event=>{
     event.preventDefault();const form=new FormData(event.currentTarget),end=String(form.get('endsAt')??''),max=String(form.get('maxBonus')??'').trim();
     const receipt=await mutation.run<DepositBonusPolicyReceipt>('save-policy',{version:policy.version,enabled:form.get('enabled')==='on',percent:Number(form.get('percent')),minAmount:String(form.get('minAmount')??''),maxBonus:max||null,validityDays:Number(form.get('validityDays')),endsAt:end?new Date(end).toISOString():null,reason:String(form.get('reason')??'')});
     if(receipt){setDirty(false);setSaved(receipt);query.reload()}
    }}>
     <fieldset className={styles.fields} disabled={!data.schemaReady||mutation.busy}>
      <label className={`admin-check ${styles.toggle}`}><input type="checkbox" name="enabled" defaultChecked={policy.enabled}/><span>Enable deposit bonus<small>Qualifying new deposits receive the offer confirmed at checkout.</small></span></label>
      <div className={styles.two}><label>Bonus percentage<input name="percent" type="number" min={10} max={100} step={1} required defaultValue={policy.percent}/><small>10–100% of each qualifying deposit.</small></label><label>Minimum deposit (ETB)<input name="minAmount" type="number" min={1} max={43200} step="0.01" required defaultValue={policy.minAmount}/><small>The deposited amount must reach this minimum.</small></label></div>
      <div className={styles.two}><label>Maximum bonus per deposit (ETB)<input name="maxBonus" type="number" min="0.01" max={43200} step="0.01" defaultValue={policy.maxBonus??''} placeholder="No cap"/><small>Leave empty for no per-deposit cap.</small></label><label>Bonus valid for (days)<input name="validityDays" type="number" min={1} max={365} step={1} required defaultValue={policy.validityDays}/><small>Starts when the payment is verified and credited.</small></label></div>
      <label>Offer ends (optional)<input name="endsAt" type="datetime-local" defaultValue={localDate(policy.endsAt)}/><small>Uses your browser’s local time. Leave empty to keep the offer open.</small></label>
      <label>Reason for change<textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Explain this bonus policy change"/></label>
      <button disabled={!dirty||mutation.busy}>{mutation.busy?'Saving…':'Save bonus settings'}</button>
     </fieldset>
    </form>
    <ErrorNotice error={mutation.error}/>
    {saved&&<p className="admin-notice" role="status">Saved. The {saved.percent}% deposit bonus is {saved.enabled?'enabled':'disabled'}; credited bonuses are valid for {saved.validityDays} days.</p>}
   </section>
   <aside className={`admin-panel ${styles.explanation}`}><h2>How it works</h2><ol><li>The customer reviews the deposit and its bonus before paying.</li><li>Chapa verifies the exact payment.</li><li>The deposit enters their cash balance, and the bonus enters their bidding balance.</li></ol><h3>Bonus funds</h3><p>Bonus funds pay eligible submission fees before cash, starting with the earliest expiry. They cannot fund monetary holds or winning charges. Unused bonus expires after its recorded validity.</p><h3>Policy changes</h3><p>Changes apply to new checkout offers. A started payment keeps its confirmed bonus and validity, including if the offer is later disabled.</p><p>Direct bid payments receive no deposit bonus. Rejected and unverified payments earn nothing.</p></aside>
  </div>}
 </>;
}
