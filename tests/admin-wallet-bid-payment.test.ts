import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
const guard=vi.hoisted(()=>({role:'OWNER',authenticated:true,rateAllowed:true}));
vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>{if(!guard.authenticated){const {AdminError}=await import('../src/modules/admin/errors');throw new AdminError(401,'Sign in.')}return {id:'staff',role:guard.role}})}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:vi.fn(async()=>guard.rateAllowed)}));
import {readWalletBidPayment,walletBidNetFee} from '../src/modules/admin/wallet-bid-payment';
import {allowIdentityRequest} from '../src/lib/rate-limit';
const id=randomUUID(),date=new Date('2026-11-01T12:00:00Z');
function fixture(){
 const row={id,userId:'player',auctionId:'auction',amount:new Prisma.Decimal('2.50'),feePoints:new Prisma.Decimal('50'),acceptedAt:date,operation:{result:{charge:{netFeePoints:'45',discountPoints:'5'},wallet:{available:'999'},privateField:'private-wallet-balance'},journal:{id:'private-journal',kind:'BID_FEE'}},user:{name:'Player'},auction:{code:'LW-5',slug:'power-bank',presentation:{title:'Power bank'},product:{title:'Original product'},terms:{ruleVersion:'lowest-unique-v4'}},phoneCipher:'private-cipher'};
 const mock={bid:{findFirst:vi.fn(async(_query:Prisma.BidFindFirstArgs)=>row)},adminAudit:{create:vi.fn()}};
 return {row,mock,db:mock as unknown as PrismaClient};
}
beforeEach(()=>{vi.clearAllMocks();Object.assign(guard,{role:'OWNER',authenticated:true,rateAllowed:true});vi.stubEnv('CHAPA_SCHEMA_READY','true')});
afterEach(()=>vi.unstubAllEnvs());
describe('read-only wallet bid payment details',()=>{
 it('shows the exact committed net fee and safe auction details without returning receipt balances',async()=>{
  const {db,mock}=fixture(),result=await readWalletBidPayment(db,new Headers(),id);
  expect(result.item).toMatchObject({id,source:'wallet',provider:'Wallet',playerName:'Player',title:'Power bank',bidNumber:'2.5',grossFee:'50',discountPoints:'5',amountCents:'4500',status:'BID_ACCEPTED',paid:true,bidAccepted:true,canCheck:false,references:{journalId:'private-journal',bidId:id}});
  expect(mock.bid.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id,auction:{isDemo:false,testRunId:null},operation:{scope:'BID',journal:{is:{kind:'BID_FEE'}}},chapaCheckout:{is:null}}}));
  expect(mock.adminAudit.create).toHaveBeenCalledWith({data:{actorId:'staff',action:'WALLET_BID_PAYMENT_READ',target:id,details:{}}});
  expect(JSON.stringify(result)).not.toMatch(/private-wallet-balance|available|private-cipher|phoneCipher|operation|receipt/);
 });
 it('hides references for Support and provides no provider verification or mutation action',async()=>{
  const {db}=fixture();guard.role='SUPPORT';const result=await readWalletBidPayment(db,new Headers(),id);
  expect(result.item).not.toHaveProperty('references');expect(result.item.canCheck).toBe(false);expect(JSON.stringify(result)).not.toContain('private-journal');
 });
 it.each(['CATALOG_MANAGER','FULFILLMENT'])('denies %s before loading a payment',async role=>{
  const {db,mock}=fixture();guard.role=role;await expect(readWalletBidPayment(db,new Headers(),id)).rejects.toMatchObject({status:403});expect(mock.bid.findFirst).not.toHaveBeenCalled();
 });
 it('requires authentication and rate limiting before loading financial data',async()=>{
  const {db,mock}=fixture();guard.authenticated=false;await expect(readWalletBidPayment(db,new Headers(),id)).rejects.toMatchObject({status:401});guard.authenticated=true;guard.rateAllowed=false;await expect(readWalletBidPayment(db,new Headers(),id)).rejects.toMatchObject({status:429});expect(mock.bid.findFirst).not.toHaveBeenCalled();expect(allowIdentityRequest).toHaveBeenCalledWith(db,'admin-wallet-bid-payment-read','staff',60);
 });
 it('does not query an unavailable Chapa table and rejects invalid/missing bid IDs',async()=>{
  const {db,mock}=fixture();vi.stubEnv('CHAPA_SCHEMA_READY','false');await readWalletBidPayment(db,new Headers(),id);expect(mock.bid.findFirst.mock.calls[0][0]?.where).not.toHaveProperty('chapaCheckout');
  await expect(readWalletBidPayment(db,new Headers(),'invalid')).rejects.toThrow();
  mock.bid.findFirst.mockResolvedValueOnce(null as never);await expect(readWalletBidPayment(db,new Headers(),randomUUID())).rejects.toMatchObject({status:404});
 });
 it.each([null,{},[],{charge:{netFeePoints:'invalid'}},{charge:{netFeePoints:'-1'}},{charge:{netFeePoints:'50.001'}},{charge:{netFeePoints:'51'}}])('falls back to the gross ledger fee for an invalid or absent receipt discount %j',result=>{
  expect(walletBidNetFee(new Prisma.Decimal('50'),result)).toBe('50');
 });
 it('keeps exact large amounts and a fully discounted fee without floating-point arithmetic',()=>{
  expect(walletBidNetFee(new Prisma.Decimal('9007199254740993.97'),{charge:{netFeePoints:'9007199254740993.96'}})).toBe('9007199254740993.96');
  expect(walletBidNetFee(new Prisma.Decimal('50'),{charge:{netFeePoints:'0'}})).toBe('0');
 });
});
