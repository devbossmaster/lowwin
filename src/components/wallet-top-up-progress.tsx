'use client';
import PaymentProgress from './payment-progress';
import type {useChapaPayment} from './chapa-payment';

type Props={payment:ReturnType<typeof useChapaPayment>;amount:string|null;provider:string;phone:string;onRetry:()=>void;onChangePayment?:()=>void;onClose?:()=>void;footerPortal:boolean};

/** Deposits share the bid surface, not another payment controller or poller. */
export function WalletTopUpProgress({payment,amount,provider,phone,onRetry,onChangePayment,onClose,footerPortal}:Props){
 return <PaymentProgress purpose="TOP_UP" payment={payment} summary={{auctionTitle:'Wallet top-up',auctionTitleAm:'የዋሌት ገቢ',numbers:[],total:amount,provider,phone}} onRetry={onRetry} onChangePayment={onChangePayment} onClose={onClose} footerPortal={footerPortal}/>;
}
