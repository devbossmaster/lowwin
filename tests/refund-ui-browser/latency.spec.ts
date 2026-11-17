import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';
import {bidAuction} from '../bid-fixtures';
import {verifiedReferralUser} from '../referral-fixtures';
import {creditDevelopmentPoints} from '../../src/modules/wallet/ledger';
import {submitBid} from '../../src/modules/auctions/bids';
import {closeAuction} from '../../src/modules/auctions/settlement';
import {processAuctionRefund} from '../../src/modules/wallet/auction-refunds';

test('committed cancellation/refund reaches the owned production UI without manual refresh',async({page},info)=>{
 const target=new URL(process.env.TEST_DATABASE_URL??'');if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database only');
 // Only this fixture process can issue synthetic development funding. The
 // separately running optimized server retains its disabled funding flags.
 Object.assign(process.env,{NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',WALLET_BIDS_ENABLED:'true'});
 const samples:Array<{sample:number;decisionCommitToPendingUiMs:number;refundCommitToCompletedUiMs:number}>=[];
 const count=process.env.REFUND_UI_SMOKE==='1'?1:3;
 for(let sample=0;sample<count;sample++){
  const f=await fixture(page,false,undefined,'lowest-unique-v5');
  try{
   await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
   const second=await verifiedReferralUser(f.db,'Refund timing fixture');
   await creditDevelopmentPoints(f.db,second.id,'100','refund-ui-second-'+randomUUID());
   await creditDevelopmentPoints(f.db,f.user.id,'100','refund-ui-'+randomUUID());
   const auction=await bidAuction(f.db,{ruleVersion:'lowest-unique-v5',fee:10,isDemo:false,endDelayMs:2500});
   for(const userId of [f.user.id,second.id])await submitBid(f.db,{userId,auctionSlug:auction.slug!,amount:'1.50',feeVersion:1,key:randomUUID()});
   const [{now}]=await f.db.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-now.getTime()+20)));
   const settlement=await closeAuction(f.db,auction.id),decisionCommitted=performance.now();expect(settlement.decision).toBe('NO_UNIQUE_BID');
   await page.goto('/my-bids?view=finished');const row=page.locator(`[data-bid-auction="${auction.publicCode}"]`);
   await expect(row.locator('[data-auction-refund="pending"]')).toBeVisible();const pendingPaint=performance.now();
   expect(await row.textContent()).not.toContain('Refund completed');
   for(let n=0;n<4;n++)if((await processAuctionRefund(f.db,auction.id)).status==='idle')break;
   const refundCommitted=performance.now();await expect(row.locator('[data-auction-refund="completed"]')).toBeVisible({timeout:12000});
   await expect(row).toContainText('Cash returned: ETB 10.00');
   samples.push({sample:sample+1,decisionCommitToPendingUiMs:Math.round(pendingPaint-decisionCommitted),refundCommitToCompletedUiMs:Math.round(performance.now()-refundCommitted)});
   if(sample===count-1)await row.screenshot({path:info.outputPath('committed-refund-430-en.png')});
  }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
 }
 const quantile=(key:keyof Omit<(typeof samples)[number],'sample'>,q:number)=>[...samples].map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(q*samples.length)-1];
 mkdirSync('docs/measurements',{recursive:true});writeFileSync(count===1?'.local/refund-ui-smoke-20261117.json':'docs/measurements/refund-ui-2026-11-17.json',JSON.stringify({scope:'Optimized local HTTPS server; real database cancellation/refund commits and real signed Telegram session, owned private HTTP reads and browser rendering. Cancellation/refund/My Bids responses are not intercepted.',n:samples.length,samples,p50RefundCommitToUiMs:quantile('refundCommitToCompletedUiMs',.5),p95RefundCommitToUiMs:quantile('refundCommitToCompletedUiMs',.95),limitations:[`${count} local samples; not production/network/device p95.`,'Decision-to-pending UI includes initial navigation/authentication. Refund completion uses the shipped 3-second pending-only poll.','The common fixture stubs wallet summary and provider availability; neither establishes a refund outcome.']},null,2)+'\n');
});
