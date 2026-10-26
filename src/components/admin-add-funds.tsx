'use client';
import {useState} from 'react';
import {centsToEtb,etbToCents,ErrorNotice,useAdminMutation} from './admin-ui';

export function AdminAddFunds({depositId,name,reference='',reload}:{depositId:string;name:string;reference?:string;reload:()=>void}){
 const m=useAdminMutation('payments'),[open,setOpen]=useState(false),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[transactionId,setTransactionId]=useState(reference),[error,setError]=useState(''),[credited,setCredited]=useState('');
 async function submit(){
  setError('');
  try{
   const amountCents=etbToCents(amount);
   if(BigInt(amountCents)<1n||BigInt(amountCents)>1000000n)throw Error('Enter an amount from ETB 0.01 to ETB 10,000.');
   const result=await m.run<{amountCents:string}>('add-funds',{id:depositId,amountCents,reason,reference:transactionId});
   if(result){setCredited(centsToEtb(result.amountCents));setOpen(false);reload()}
  }catch(e){setError(e instanceof Error?e.message:'Check the amount.')}
 }
 if(credited)return <p className="admin-notice" role="status">ETB {credited} added to {name}. The Mini App alert is ready and the bot notification is queued.</p>;
 return <section className="money-add-funds">
  {!open?<><button onClick={()=>setOpen(true)} aria-expanded={false}>Add funds</button><p className="money-approval-help">Credit this player and close this deposit review.</p></>:<>
   <h3>Add funds to {name}</h3>
   <p className="money-approval-help">The player receives an admin credit and a notification.</p>
   {m.error.startsWith('Fresh MFA is required.')&&null}
   <form className="money-approval-form" onSubmit={e=>{e.preventDefault();void submit()}}>
    <fieldset disabled={m.busy}>
     <label>Amount (ETB)<input autoFocus required inputMode="decimal" pattern="[0-9]{1,5}(\.[0-9]{1,2})?" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 100.00"/></label>
     <label>Reason<input required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why are you adding funds?"/></label>
     <label>Transaction ID (optional)<input maxLength={128} value={transactionId} readOnly={!!reference} onChange={e=>setTransactionId(e.target.value)} placeholder="Leave blank if unavailable"/></label>
    </fieldset>
    <ErrorNotice error={m.error||error}/>
    <div className="admin-actions"><button disabled={m.busy}>{m.busy?'Adding funds…':`Add${amount?` ETB ${amount}`:' funds'}`}</button><button type="button" className="secondary" disabled={m.busy} onClick={()=>setOpen(false)}>Cancel</button></div>
   </form>
  </>}
 </section>;
}
