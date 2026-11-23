import {paymentSummaryLabel,paymentSummaryState,type PaymentSummaryEvidence} from '@/lib/payment-summary';
import styles from './admin-payment-state.module.css';

const terminalLabels:Partial<Record<string,string>>={
 CANCELLED:'Cancelled', EXPIRED:'Expired', INCOMPLETE:'Incomplete', BLOCKED:'Blocked', FAILED_OR_CANCELLED:'Failed or cancelled',
};

export function AdminPaymentStatus({evidence}:{evidence:PaymentSummaryEvidence&{cancelledBy?:'USER'|'SYSTEM'|null}}){
 const state=paymentSummaryState(evidence);
 const label=state==='failed'
  ? (evidence.providerStatus==='CANCELLED'&&evidence.cancelledBy==='USER'?'Cancelled by player':terminalLabels[evidence.providerStatus??'']??'Failed')
  : paymentSummaryLabel(state);
 return <span className={`admin-status ${state==='failed'?'is-danger':state==='checking'?'is-caution':''}`} data-payment-summary={state}>{label}</span>;
}

export function AdminPaymentSkeleton({table=false}:{table?:boolean}){
 return <div className={table?'admin-table-wrap master-table':styles.details} role="status" aria-label={table?'Loading payments':'Loading payment details'} data-admin-payment-skeleton>
  {table?<table aria-hidden="true"><tbody>{Array.from({length:5},(_,row)=><tr key={row}>{Array.from({length:8},(_,cell)=><td key={cell}><div className={`skeleton ${styles.line}`}/></td>)}</tr>)}</tbody></table>
   :<div aria-hidden="true">{Array.from({length:5},(_,index)=><div className={`skeleton ${styles.line}`} key={index}/>)}</div>}
 </div>;
}
