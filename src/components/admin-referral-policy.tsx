'use client';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {AdminHeading,ErrorNotice,eat,useAdminMutation,useAdminRead} from './admin-ui';
import type {ReferralAdminRead,ReferralPolicyReceipt} from '@/modules/admin/referrals';
import styles from './admin-referral-policy.module.css';

export function AdminReferralPolicy(){
 const query=useAdminRead<ReferralAdminRead>('referrals'),mutation=useAdminMutation('referrals'),[dirty,setDirty]=useState(false),[saved,setSaved]=useState<ReferralPolicyReceipt|null>(null),data=query.data,policy=data?.policy;
 return <>
  <AdminHeading title="Referral rewards" description="Set the wallet reward an inviter earns after a new member’s first accepted bid."><button className="secondary" disabled={dirty||mutation.busy||query.loading} onClick={query.reload}><RefreshCw size={17} aria-hidden="true"/>Refresh</button></AdminHeading>
  <ErrorNotice error={query.error} retry={query.reload}/>
  {!data&&query.loading&&<p role="status">Loading referral settings…</p>}
  {data&&policy&&<div className={styles.workspace}>
   <section className="admin-panel">
    <div className={styles.heading}><div><h2>Reward settings</h2><p>{policy.version?`Version ${policy.version} · Updated ${eat(policy.updatedAt)}`:'Draft defaults · No policy has been saved'}</p></div><span className={`admin-status ${!policy.enabled?'is-caution':''}`}>{policy.enabled?'New rewards enabled':'New rewards paused'}</span></div>
    {!data.schemaReady&&<p className="admin-notice">Referral rewards storage is not configured. Apply the referral migration and runtime grants, then set REFERRAL_REWARDS_SCHEMA_READY=true on Web, the bot and payment workers. No rewards are enabled by that setting alone.</p>}
    {data.schemaReady&&!policy.configured&&<p className="admin-notice">Enter a reward amount and enable new referral rewards when you’re ready.</p>}
    <form key={policy.version} className="admin-form" onChange={()=>{setDirty(true);setSaved(null);mutation.clear()}} onSubmit={async event=>{
     event.preventDefault();const form=new FormData(event.currentTarget);
     const receipt=await mutation.run<ReferralPolicyReceipt>('save-policy',{version:policy.version,rewardEtb:String(form.get('rewardEtb')??''),enabled:form.get('enabled')==='on',reason:String(form.get('reason')??'')});
     if(receipt){setDirty(false);setSaved(receipt)}
    }}>
     <fieldset disabled={!data.schemaReady||mutation.busy} className={styles.fields}>
      <label>Reward amount (ETB)<input name="rewardEtb" inputMode="decimal" pattern="(0|[1-9][0-9]{0,5})([.][0-9]{1,2})?" required defaultValue={policy.configured?policy.rewardEtb:''} aria-describedby="referral-amount-help"/><small id="referral-amount-help">ETB 0.01–100,000 per qualifying new member.</small></label>
      <label className={`admin-check ${styles.toggle}`}><input type="checkbox" name="enabled" defaultChecked={policy.enabled}/><span>Allow new referral rewards<small>Pausing prevents new rewards from being earned.</small></span></label>
      <label>Reason for change<textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Explain this reward policy change"/></label>
      <button disabled={!dirty||mutation.busy}>{mutation.busy?'Saving…':'Save reward settings'}</button>
     </fieldset>
    </form>
    <ErrorNotice error={mutation.error}/>
    {saved&&<p className="admin-notice" role="status">Saved ETB {saved.rewardEtb} per qualifying member. New rewards are {saved.enabled?'enabled':'paused'}.</p>}
   </section>
   <aside className={`admin-panel ${styles.explanation}`}><h2>How a reward is earned</h2><ol><li>A customer shares their own invitation link.</li><li>A new customer registers through that link.</li><li>The first accepted bid on a listed auction earns the inviter one wallet credit.</li></ol><p>Each invited member can earn one reward for their inviter. Changes apply to future rewards.</p></aside>
  </div>}
 </>;
}
