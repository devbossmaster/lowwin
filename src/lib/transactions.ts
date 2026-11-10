import type {PaymentSummaryState} from './payment-summary';

export type TransactionRow={
 id:string;source:'chapa'|'wallet';type:'TOP_UP'|'BID';title:string;titleAm:string|null;
 amount:string;direction:'incoming'|'outgoing'|'none';summary:PaymentSummaryState;
 paymentMethod:string|null;createdAt:string;mode?:'test'|'live';fundsPreserved?:boolean;
};
export type TransactionsPage={items:TransactionRow[];page:number;nextPage:number|null};
export type WalletTransactionDetail={item:TransactionRow&{
 auctionCode:string|null;auctionSlug:string|null;bidNumber:string;grossFee:string;discountPoints:string;
 currency:'ETB';status:'BID_ACCEPTED';references:{bidId:string;journalId:string};
}};
