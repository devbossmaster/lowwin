import type {ChapaCheckout,Outbox,Prisma} from '@prisma/client';
import {chapaReturnPath} from '@/lib/chapa-return-link';
import {centsToEtb} from '@/lib/money';

export const chapaReceiptKind='CHAPA_PAYMENT_CONFIRMED';
type ReceiptOrder=Pick<ChapaCheckout,'id'|'userId'|'purpose'|'status'|'providerStatus'|'verificationState'|'creditJournalId'|'bidId'|'receipt'|'currency'|'amountCents'|'mode'|'phoneBotId'>;

/** A private chat ID is pinned in protected runtime configuration, never a username. */
export function chapaPaymentAlertRecipient(){
 const id=process.env.CHAPA_PAYMENT_ALERT_TELEGRAM_ID??'';
 return /^[1-9]\d{0,15}$/.test(id)&&BigInt(id)<=4503599627370495n?id:null;
}

function receiptOutcome(order:ReceiptOrder){
 if(!order.creditJournalId||order.verificationState!=='VERIFIED'||order.providerStatus!=='SUCCESS'||order.currency!=='ETB'||order.amountCents<=0n)return null;
 if(order.purpose==='TOP_UP'&&order.status==='CREDITED')return 'wallet';
 if(order.purpose==='BID'&&order.status==='BID_ACCEPTED'&&order.bidId&&order.receipt)return 'bid';
 if(order.purpose==='BID'&&order.status==='NEEDS_REVIEW'&&!order.bidId)return 'preserved';
 return null;
}

/** Enqueue in the receipt transaction; only a committed outbox row is dispatched.
 * The unique key deduplicates confirmation events, not Telegram's external send:
 * the existing worker can repeat a message after a send/commit crash ambiguity. */
export async function queueChapaReceipt(tx:Prisma.TransactionClient,order:ReceiptOrder){
 if(!receiptOutcome(order)||!chapaReturnPath(order.id))return null;
 const key=`chapa:${order.id}:telegram-confirmed`;
 const receipt=await tx.outbox.upsert({where:{key},create:{key,kind:chapaReceiptKind,payload:{checkoutId:order.id,recipientUserId:order.userId}},update:{}});
 const recipient=chapaPaymentAlertRecipient();
 if(recipient){
  const merchantKey=`chapa:${order.id}:merchant-confirmed:${recipient}`;
  await tx.outbox.upsert({where:{key:merchantKey},create:{key:merchantKey,kind:chapaReceiptKind,payload:{checkoutId:order.id,recipientUserId:order.userId,merchantRecipientTelegramId:recipient}},update:{}});
 }
 return receipt;
}

/** Re-read proof and recipient ownership instead of trusting an outbox snapshot. */
export async function chapaReceiptContent(tx:Prisma.TransactionClient,row:Pick<Outbox,'kind'|'payload'>){
 if(row.kind!==chapaReceiptKind)return null;
 if(!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload))return null;
 const payload=row.payload as {checkoutId?:unknown;recipientUserId?:unknown;merchantRecipientTelegramId?:unknown};
 if(typeof payload.checkoutId!=='string'||typeof payload.recipientUserId!=='string'||!chapaReturnPath(payload.checkoutId))return null;
 const order=await tx.chapaCheckout.findUnique({where:{id:payload.checkoutId},select:{id:true,userId:true,purpose:true,status:true,providerStatus:true,verificationState:true,creditJournalId:true,bidId:true,receipt:true,currency:true,amountCents:true,mode:true,phoneBotId:true,merchantReference:true,chapaReference:true,user:{select:{telegramId:true,ownContact:{select:{telegramId:true,botId:true,revokedAt:true}}}}}});
 if(!order||order.userId!==payload.recipientUserId)return null;
 const outcome=receiptOutcome(order),botId=process.env.TELEGRAM_BOT_TOKEN?.split(':')[0],contact=order.user.ownContact;
 if(!outcome||!botId||order.phoneBotId!==botId||order.mode!==(process.env.CHAPA_MODE??'test'))return null;
 const amount=centsToEtb(order.amountCents),prefix=order.mode==='test'?'TEST · ':'';
 if('merchantRecipientTelegramId' in payload){
  const recipient=chapaPaymentAlertRecipient();
  if(!recipient||payload.merchantRecipientTelegramId!==recipient||!order.chapaReference)return null;
  const purpose=outcome==='wallet'?'Wallet deposit':outcome==='bid'?'Bid payment · bid accepted':'Bid payment · funds kept in wallet';
  return {userId:order.userId,kind:chapaReceiptKind,title:'Payment received',body:`✅ ${prefix}Payment received: ${amount} ETB\n${purpose}\nMerchant reference: ${order.merchantReference}\nChapa reference: ${order.chapaReference}`,href:'/admin/payments',buttonLabel:'View payments',recipientTelegramId:recipient,merchantAlert:true as const};
 }
 if(!order.user.telegramId||!contact||contact.revokedAt||contact.botId!==botId||contact.telegramId!==order.user.telegramId)return null;
 const body=outcome==='wallet'?`✅ ${prefix}${amount} ETB credited to your wallet.\n${amount} ብር ወደ ዋሌትዎ ገብቷል።`:outcome==='bid'?`✅ ${prefix}${amount} ETB payment confirmed. Bid accepted.\nየ${amount} ብር ክፍያ ተረጋግጧል። ጨረታዎ ተቀብሏል።`:`✅ ${prefix}${amount} ETB credited to your wallet. This bid was not accepted.\n${amount} ብር ወደ ዋሌትዎ ገብቷል። ጨረታው አልተቀበለም።`;
 return {userId:order.userId,kind:chapaReceiptKind,title:'Payment confirmed',body,href:chapaReturnPath(order.id)!,buttonLabel:'🎯 Open Lowwin · Lowwinን ይክፈቱ'};
}
