'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Gavel,Info,X} from 'lucide-react';
import {LoadingSpinner} from './loading-spinner';
import styles from './bid-confirm-dialog.module.css';

type Props={
 open:boolean;language:'en'|'am';item:string;bidNumber:string;submissionFee:string;
 total?:string;feeOnly:boolean;agreed:boolean;submitting:boolean;valid:boolean;error?:string;
 onAgreedChange:(value:boolean)=>void;onClose:()=>void;onConfirm:()=>void;
};
export function BidConfirmDialog({open,language,item,bidNumber,submissionFee,total,feeOnly,agreed,submitting,valid,error,onAgreedChange,onClose,onConfirm}:Props){
 const dialog=useRef<HTMLDialogElement>(null),agreement=useRef<HTMLInputElement>(null),titleId=useId(),agreementErrorId=useId(),am=language==='am';
 const [agreementError,setAgreementError]=useState(false);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open)dialog.current.close();if(!open)setAgreementError(false)},[open]);
 const confirm=()=>{if(!agreed){setAgreementError(true);agreement.current?.focus();return}onConfirm()};
 return <dialog ref={dialog} className={styles.dialog} onCancel={event=>{if(submitting)event.preventDefault();else onClose()}} onClose={onClose} aria-labelledby={titleId}>
  <header className={styles.header}><span className={styles.icon}><Gavel size={19}/></span><h2 id={titleId}>{am?'ጨረታዎን ያረጋግጡ':'Confirm your bid'}</h2><button type="button" className={styles.close} onClick={onClose} disabled={submitting} aria-label={am?'ዝጋ':'Close'}><X size={20}/></button></header>
  <dl className={styles.summary}>
   <div className={styles.row}><dt>{am?'ዕቃ':'Item'}</dt><dd>{item}</dd></div>
   <div className={`${styles.row} ${styles.bidRow}`}><dt>{am?'የጨረታ ቁጥር':'Your bid number'}</dt><dd>{bidNumber}</dd></div>
   <div className={`${styles.row} ${styles.feeRow}`}><dt className={styles.feeLabel}>{am?'የጨረታ አገልግሎት ክፍያ':'Bid service fee'}{feeOnly&&<span className={styles.badge}>{am?'ተመላሽ አይሆንም':'Non-refundable'}</span>}</dt><dd>{submissionFee}</dd></div>
   {!feeOnly&&total&&<div className={styles.row}><dt>{am?'ጠቅላላ ክፍያ':'Total to pay'}</dt><dd>{total}</dd></div>}
  </dl>
  <p className={styles.note}><Info size={17}/><span>{feeOnly?(am?'የጨረታ አገልግሎት ክፍያው ተመላሽ አይሆንም፤ ለመሳተፍ የሚከፈል ነው። የጨረታ ቁጥሩ ገንዘብ አይደለም እና ፈጽሞ አይቀነስም። ዝቅተኛው ብቸኛ ቁጥር ያሸንፋል።':'The bid service fee is non-refundable and pays for participation. Your bid number is not money and is never charged. The lowest unique number wins.'):(am?'ይህ የቆየ ጨረታ በሚታየው ጠቅላላ መሠረት ገንዘብ ሊይዝ ይችላል።':'This older auction may reserve money according to the total shown.')}</span></p>
  <label className={styles.agreement}><input ref={agreement} type="checkbox" checked={agreed} aria-describedby={agreementError?agreementErrorId:undefined} onChange={event=>{onAgreedChange(event.target.checked);if(event.target.checked)setAgreementError(false)}}/><span>{am?'ለመቀጠል ተስማምቻለሁ':'I agree to continue'}</span></label>
  {agreementError&&<p id={agreementErrorId} className={styles.error} role="alert">{am?'ከመቀጠልዎ በፊት «ተስማምቻለሁ» የሚለውን ይምረጡ።':'Select “I agree to continue” before submitting your bid.'}</p>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <button type="button" className={styles.confirm} disabled={submitting||!valid} onClick={confirm}>{submitting?<LoadingSpinner/>:(am?'አረጋግጥና ጨረታ አቅርብ':'Confirm & submit bid')}</button>
 </dialog>;
}
