'use client';
import type {readWalletBidPayment} from '@/modules/admin/wallet-bid-payment';
import {formatEtb} from '@/lib/money';
import {centsToEtb,eat,ErrorNotice,Status,useAdminRead} from './admin-ui';
import {LoadingSpinner} from './loading-spinner';

export function AdminWalletBidPayment({id}:{id:string}){
 const query=useAdminRead<Awaited<ReturnType<typeof readWalletBidPayment>>>('payments/wallet-bids/'+encodeURIComponent(id)),item=query.data?.item;
 return <div className="admin-direct-payments">
  <ErrorNotice error={query.error} retry={query.reload}/>
  {!item&&query.loading&&<LoadingSpinner label="Loading wallet payment details…"/>}
  {item&&<>
   <div className="master-payment-heading"><strong>{formatEtb(centsToEtb(item.amountCents))}</strong><Status value={item.status}/></div>
   <dl className="admin-facts">
    <div><dt>Player</dt><dd>{item.playerName}</dd></div>
    <div><dt>Type</dt><dd>Bid payment</dd></div>
    <div><dt>Method</dt><dd>Wallet</dd></div>
    <div><dt>Product</dt><dd>{item.title}</dd></div>
    <div><dt>Auction</dt><dd>{item.auctionCode}</dd></div>
    <div><dt>Accepted</dt><dd>{eat(item.createdAt)}</dd></div>
    <div><dt>Submission fee</dt><dd>{formatEtb(item.grossFee)}</dd></div>
    <div><dt>Coupon discount</dt><dd>{formatEtb(item.discountPoints)}</dd></div>
    <div><dt>Paid from wallet</dt><dd>{formatEtb(centsToEtb(item.amountCents))}</dd></div>
   </dl>
   {item.references&&<details className="admin-evidence"><summary>Payment references</summary><dl className="admin-facts"><div><dt>Bid ID</dt><dd>{item.references.bidId}</dd></div><div><dt>Fee journal</dt><dd>{item.references.journalId}</dd></div></dl></details>}
   <p className="admin-notice">The submission fee was deducted from the player's existing wallet balance when this bid was accepted.</p>
   <button type="button" className="secondary" onClick={query.reload} disabled={query.loading}>Refresh details</button>
  </>}
 </div>;
}
