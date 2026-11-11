'use client';
import {ArrowLeft,ExternalLink,LockKeyhole} from 'lucide-react';
import {formatEtb} from '@/lib/money';
import {AccountSheetFooter} from './account-sheet';
import {useMiniLocale} from './mini-locale';
import styles from './payment-method-form.module.css';

/** CBE Bank is hosted checkout, distinct from the CBE Birr wallet. */
export default function CbeBankGuide({total,video,onBack,onContinue,disabled=false,footerPortal=true}:{total:string;video:string|null;onBack:()=>void;onContinue:()=>void;disabled?:boolean;footerPortal?:boolean}){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en;
 const action=<button type="button" className={styles.pay} disabled={disabled} onClick={onContinue}>{text('Continue to payment','ወደ ክፍያ ቀጥል')}<ExternalLink size={16}/></button>;
 return <section className={styles.form} data-cbe-bank-guide>
  <div className={styles.heading}><button type="button" onClick={onBack} aria-label={text('Back to payment options','ወደ ክፍያ ምርጫዎች ተመለስ')}><ArrowLeft size={18}/></button><h3>{text('Pay with CBE Bank','በCBE ባንክ ይክፈሉ')}</h3></div>
  <p className={styles.guideCopy}>{text('Continue to Chapa’s secure payment page and choose the bank method available there. CBE Bank is different from CBE Birr.','ወደ Chapa የክፍያ ገጽ ይቀጥሉና የሚገኘውን የባንክ መንገድ ይምረጡ። CBE ባንክ ከCBE Birr የተለየ ነው።')}</p>
  {video&&<video className={styles.guideVideo} src={video} controls preload="none" playsInline aria-label={text('CBE Bank payment guide','የCBE ባንክ ክፍያ መመሪያ')}/>}
  <div className={styles.total}><span>{text('Total payable','ጠቅላላ ክፍያ')}</span><strong>{formatEtb(total)}</strong></div>
  {footerPortal?<AccountSheetFooter>{action}</AccountSheetFooter>:action}
  <p className={styles.security}><LockKeyhole size={14}/>{text('Your result updates automatically when you return.','ሲመለሱ የክፍያው ሁኔታ በራሱ ይዘምናል።')}</p>
 </section>;
}
