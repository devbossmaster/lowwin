'use client';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {AdminHeading,ErrorNotice,eat,useAdminMutation,useAdminRead} from './admin-ui';
import type {ReferralAdminRead,ReferralPolicyReceipt} from '@/modules/admin/referrals';
import styles from './admin-referral-policy.module.css';

export function AdminReferralPolicy(){
 const query=useAdminRead<ReferralAdminRead>('referrals'),mutation=useAdminMutation('referrals'),[dirty,setDirty]=useState(false),[saved,setSaved]=useState<ReferralPolicyReceipt|null>(null),data=query.data,policy=data?.policy;
 return <>
  <AdminHeading title="Referral rewards" description="Set the discount earned when an invited customer makes their first accepted bid."><button className="secondary" disabled={dirty||mutation.busy||query.loading} onClick={query.reload}><RefreshCw size={17} aria-hidden="true"/>Refresh</button></AdminHeading>
  <ErrorNotice error={query.error} retry={query.reload}/>
  {!data&&query.loading&&<p role="status">Loading referral settings…</p>}
  {data&&policy&&<div className={styles.workspace}>
   <section className="admin-panel">
    <div className={styles.heading}><div><h2>Reward settings</h2><p>{policy.version?`Version ${policy.version} · Updated ${eat(policy.updatedAt)}`:'Draft defaults · No policy has been saved'}</p></div><span className={`admin-status ${!policy.enabled?'is-caution':''}`}>{policy.enabled?'New rewards enabled':'New rewards paused'}</span></div>
    {!data.schemaReady&&<p className="admin-notice">Referral rewards storage is not configured. Apply the referral migration and runtime grants, then set REFERRAL_REWARDS_SCHEMA_READY=true on Web, the bot and payment workers. No rewards are enabled by that setting alone.</p>}
    {data.schemaReady&&!policy.configured&&<p className="admin-notice">Ready to configure. Review the existing 10% / 30-day draft below, check “Allow new referral rewards”, add a reason and save to start new invitations.</p>}
    <form key={policy.version} className="admin-form" onChange={()=>{setDirty(true);setSaved(null);mutation.clear()}} onSubmit={async event=>{
     event.preventDefault();const form=new FormData(event.currentTarget);
     const receipt=await mutation.run<ReferralPolicyReceipt>('save-policy',{version:policy.version,discountPercent:Number(form.get('discountPercent')),expiryDays:Number(form.get('expiryDays')),enabled:form.get('enabled')==='on',reason:String(form.get('reason')??'')});
     if(receipt){setDirty(false);setSaved(receipt);query.reload()}
    }}>
     <fieldset disabled={!data.schemaReady||mutation.busy} className={styles.fields}>
      <div className={styles.two}><label>Discount percentage<input name="discountPercent" type="number" min={5} max={15} step={1} required defaultValue={policy.discountPercent} aria-describedby="referral-percent-help"/><small id="referral-percent-help">5–15% off one submission fee.</small></label><label>Valid for (days)<input name="expiryDays" type="number" min={15} max={30} step={1} required defaultValue={policy.expiryDays} aria-describedby="referral-expiry-help"/><small id="referral-expiry-help">15–30 days from when the reward is earned.</small></label></div>
      <label className={`admin-check ${styles.toggle}`}><input type="checkbox" name="enabled" defaultChecked={policy.enabled}/><span>Allow new referral rewards<small>Saving the percentage or validity does not enable this automatically.</small></span></label>
      <label>Reason for change<textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Explain this reward policy change"/></label>
      <button disabled={!dirty||mutation.busy}>{mutation.busy?'Saving…':'Save reward settings'}</button>
     </fieldset>
    </form>
    {null}
    <ErrorNotice error={mutation.error}/>
    {saved&&<p className="admin-notice" role="status">Saved: {saved.discountPercent}% discount, valid for {saved.expiryDays} days. New rewards are {saved.enabled?'enabled':'paused'}.</p>}
   </section>
   <aside className={`admin-panel ${styles.explanation}`}><h2>How a reward is earned</h2><ol><li>A customer shares their own invitation link.</li><li>A new customer registers through that link.</li><li>The invited customer’s first accepted bid earns the referrer one discount.</li></ol><p>Failed payment attempts do not qualify. A customer cannot refer themselves.</p><h3>Existing rewards stay the same</h3><p>Each earned reward keeps the discount and expiry recorded when it was awarded. Changing or pausing this policy affects new rewards only.</p><p>Rewards discount the submission fee, not the chosen bid number. This page does not enable Wallet or Chapa payments.</p></aside>
  </div>}
 </>;
}
