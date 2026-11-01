import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {etbToCents} from '@/lib/money';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';

export const walletBidPaymentSelection={
 id:true,userId:true,auctionId:true,amount:true,feePoints:true,acceptedAt:true,
 operation:{select:{result:true,journal:{select:{id:true,kind:true}}}},
 user:{select:{name:true}},
 auction:{select:{code:true,slug:true,presentation:true,product:{select:{title:true}},terms:{select:{ruleVersion:true}}}},
} satisfies Prisma.BidSelect;

/** The immutable bid receipt includes the net fee when a coupon was redeemed.
 * Referral discount journals restore the discount after the gross BID_FEE debit.
 * Read this snapshot even if issuing new referral rewards is disabled today. */
export function walletBidNetFee(gross:Prisma.Decimal,result:Prisma.JsonValue):string{
 const charge=result&&typeof result==='object'&&!Array.isArray(result)?result.charge:null;
 const value=charge&&typeof charge==='object'&&!Array.isArray(charge)?charge.netFeePoints:null;
 if(typeof value==='string'&&/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)){
  const net=new Prisma.Decimal(value);if(net.lte(gross))return net.toString();
 }
 return gross.toString();
}

/** A wallet fee is an accepted bid and committed fee journal, never a deposit. */
export async function readWalletBidPayment(client:PrismaClient,headers:Headers,id:string){
 const actor=await requireAdmin(client,headers);
 if(!['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'].includes(actor.role))throw new AdminError(403,'Your staff role cannot access payment records.');
 if(!await allowIdentityRequest(client,'admin-wallet-bid-payment-read',actor.id,60))throw new AdminError(429,'Wait a minute before loading more payments.');
 const row=await client.bid.findFirst({where:{id:z.uuid().parse(id),auction:{isDemo:false,testRunId:null},operation:{scope:'BID',journal:{is:{kind:'BID_FEE'}}},...(process.env.CHAPA_SCHEMA_READY==='true'?{chapaCheckout:{is:null}}:{})},select:walletBidPaymentSelection});
 if(!row)throw new AdminError(404,'Wallet bid payment not found.');
 const net=walletBidNetFee(row.feePoints,row.operation.result),presentation=row.auction.presentation as {title?:string}|null;
 const item={id:row.id,source:'wallet' as const,provider:'Wallet' as const,userId:row.userId,playerName:row.user.name,purpose:'BID' as const,auctionId:row.auctionId,auctionSlug:row.auction.slug,auctionCode:row.auction.code,title:presentation?.title??row.auction.product?.title??'Auction',ruleVersion:row.auction.terms?.ruleVersion??null,bidNumber:row.amount.toString(),grossFee:row.feePoints.toString(),discountPoints:row.feePoints.sub(net).toString(),amountCents:etbToCents(net).toString(),currency:'ETB' as const,status:'BID_ACCEPTED' as const,paymentMethod:'Wallet' as const,paid:true,bidAccepted:true,canCheck:false,createdAt:row.acceptedAt.toISOString(),...(actor.role==='SUPPORT'?{}:{references:{journalId:row.operation.journal!.id,bidId:row.id}})};
 await client.adminAudit.create({data:{actorId:actor.id,action:'WALLET_BID_PAYMENT_READ',target:row.id,details:{}}});
 return {item};
}
export type WalletBidPaymentDetail=Awaited<ReturnType<typeof readWalletBidPayment>>;
