import {afterEach,describe,expect,it,vi} from 'vitest';
import {bidPurchaseNotificationCopy,depositNotificationCopy,fallbackAmharicNotificationCopy,winnerNotificationCopy} from '../src/modules/notifications/amharic-copy';
import {chapaReceiptKind,chapaReceiptContent,queueChapaReceipt} from '../src/modules/notifications/chapa-receipt';

afterEach(()=>vi.unstubAllEnvs());
describe('concise Amharic-only private notifications',()=>{
 it('never labels v5 chosen and winning numbers as charged money',()=>{
  const winner=winnerNotificationCopy({productTitle:'Item',chosenNumber:'3.60',ruleVersion:'lowest-unique-v5'});
  expect(winner?.body).toContain('ያሸነፈው ቁጥር: 3.60');expect(winner?.body).not.toContain('3.60 ብር');
  const receipt=bidPurchaseNotificationCopy({productTitle:'Item',numbers:['3.60'],paidFee:'10',ruleVersion:'lowest-unique-v5'});
  expect(receipt?.body).toContain('የመረጡት ቁጥር: 3.60');expect(receipt?.body).toContain('10.00 ብር');
 });
 it('shows the committed deposit without inventing a balance or a bonus',()=>{
  const copy=depositNotificationCopy({creditedAmount:'50',name:'ሀና'});
  expect(copy).toEqual({title:'✅ ገንዘብ ገብቷል',body:'ሰላም ሀና፣\n\n50.00 ብር ወደ ዋሌትዎ ገብቷል።',buttonLabel:'ዋሌቴን ልይ'});
  expect(copy?.body).not.toContain('ጉርሻ');
 });
 it('labels actual principal, bonus and total credit separately',()=>{
  const copy=depositNotificationCopy({depositAmount:'100',bonusAmount:'10',creditedAmount:'110'});
  expect(copy?.body).toBe('ያስገቡት: 100.00 ብር\nጉርሻ: 10.00 ብር\nበጠቅላላ የገባው: 110.00 ብር');
  expect(depositNotificationCopy({depositAmount:'100',bonusAmount:'10',creditedAmount:'100'})).toBeNull();
 });
 it.each(['0','-1','NaN','1.001'])('rejects invalid or unconfirmed zero deposit totals %s',creditedAmount=>{
  expect(depositNotificationCopy({creditedAmount})).toBeNull();
 });
 it('shows the purchased number and paid submission fee, never a uniqueness verdict',()=>{
  const copy=bidPurchaseNotificationCopy({productTitle:'JBL Live Beam 3',numbers:['222.22'],paidFee:'35',ruleVersion:'lowest-unique-v4',name:'ብሩክ'});
  expect(copy?.body).toContain('JBL Live Beam 3');expect(copy?.body).toContain('የመረጡት ቁጥር: 222.22');
  expect(copy?.body).toContain('የተከፈለ የመመዝገቢያ ክፍያ: 35.00 ብር');
  expect(copy?.body).not.toMatch(/unique|not unique|rank|reference|accepted|ETB 222|222.22 ብር/i);
  expect(copy?.buttonLabel).toBe('ጨረታዎቼን ልይ');
 });
 it('uses the committed fee total for a batch instead of adding selected numbers',()=>{
  const copy=bidPurchaseNotificationCopy({productTitle:'Power bank',numbers:['1','2','3'],paidFee:'100'});
  expect(copy?.body).toContain('1.00 · 2.00 · 3.00');expect(copy?.body).toContain('የቁጥሮች ብዛት: 3');expect(copy?.body).toContain('100.00 ብር');
  expect(copy?.body).not.toContain('6.00');
 });
 it('retains legitimate zero-fee coupon receipts without adding a payment claim',()=>{
  const copy=bidPurchaseNotificationCopy({productTitle:'Item',numbers:['1.05'],paidFee:'0'});
  expect(copy?.body).toContain('0.00 ብር');expect(copy?.body).not.toMatch(/confirmed|verified|Nothing was charged/i);
 });
 it('bounds large receipt text and sends the recipient to My Bids for the full list',()=>{
  const copy=bidPurchaseNotificationCopy({productTitle:'A'.repeat(400),numbers:Array.from({length:100},(_,i)=>String(i+1)),paidFee:'5000',name:'B'.repeat(300)});
  expect(copy?.body).toContain('የቁጥሮች ብዛት: 100');expect(copy?.body).toContain('ሁሉንም ቁጥሮች በጨረታዎቼ');
  expect(copy!.title.length+copy!.body.length).toBeLessThan(900);
 });
 it('rejects malformed numbers, duplicate canonical numbers and inconsistent facts',()=>{
  for(const numbers of [[],['1','1.00'],['1.001'],['0'],Array.from({length:101},(_,i)=>String(i+1))])expect(bidPurchaseNotificationCopy({productTitle:'Item',numbers,paidFee:'5'})).toBeNull();
  expect(winnerNotificationCopy({productTitle:'Item',chosenNumber:'NaN'})).toBeNull();
 });
 it('does not use phone/email-like names and strips controls, markup and injected lines',()=>{
  for(const name of ['+251911652904','account@example.test'])expect(depositNotificationCopy({creditedAmount:'10',name})?.body).not.toContain(name);
  const copy=winnerNotificationCopy({productTitle:'<b>JBL</b>\nLive\u202e Beam',chosenNumber:'1.97',name:'<script>ሀና</script>\n\u0000'});
  expect(copy?.body).toContain('ሰላም ሀና፣');expect(copy?.body).toContain('የJBL Live Beam ጨረታን');
  expect(copy?.body).not.toMatch(/<|>|script|\u202e|\u0000/);expect(copy?.body).not.toContain('1.97 ብር');
 });
 it('provides only the 13 configured automatic historical fallback types',()=>{
  const kinds=['DEPOSIT_CREDITED','AUCTION_ENDING_3_DAYS','AUCTION_ENDING_2_DAYS','AUCTION_ENDING','AUCTION_ENDING_12_HOURS','AUCTION_ENDING_1_HOUR','AUCTION_ENDED','AUCTION_PUBLISHED','AUCTION_UPCOMING_ADDED','AUCTION_UPCOMING','AUCTION_UPCOMING_1_HOUR','BID_ACCEPTED','WINNER_CONGRATULATIONS'];
  for(const kind of kinds){const copy=fallbackAmharicNotificationCopy(kind);expect(copy).not.toBeNull();expect(copy?.title).toMatch(/[\u1200-\u137f]/);expect(copy?.title+' '+copy?.body).not.toMatch(/[A-Za-z]/)}
  for(const retired of ['AUCTION_RESULT','FULFILLMENT_UPDATED','AUCTION_NO_WINNER',chapaReceiptKind,'BROADCAST','toString','constructor','UNRECOGNIZED'])expect(fallbackAmharicNotificationCopy(retired)).toBeNull();
 });
 it('never revives duplicate Chapa receipts or configured merchant alerts',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');
  const upsert=vi.fn(),findUnique=vi.fn(),tx={outbox:{upsert},chapaCheckout:{findUnique}};
  expect(await queueChapaReceipt(tx as never,{id:'8ae9f066-9f2c-4666-a61d-17a50cb07201',userId:'owner',purpose:'TOP_UP',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'journal',amountCents:1000n,currency:'ETB'} as never)).toBeNull();
  expect(await chapaReceiptContent(tx as never,{kind:chapaReceiptKind,payload:{checkoutId:'private-order',recipientUserId:'owner',merchantRecipientTelegramId:'900000002'}})).toBeNull();
  expect(upsert).not.toHaveBeenCalled();expect(findUnique).not.toHaveBeenCalled();
 });
});
