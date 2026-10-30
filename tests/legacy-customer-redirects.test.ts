import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({
 redirect:vi.fn((destination:string)=>{throw Object.assign(new Error('redirect'),{destination})}),
 headers:vi.fn(async()=>new Headers({cookie:'fixture-cookie'})),session:vi.fn(),checkout:vi.fn(),
}));
vi.mock('next/navigation',()=>({redirect:f.redirect}));
vi.mock('next/headers',()=>({headers:f.headers}));
vi.mock('../src/lib/db',()=>({db:{arifPayCheckout:{findFirst:f.checkout}}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session}));
vi.mock('../src/components/chapa-payment-history',()=>({ChapaPaymentHistory:vi.fn(()=>null)}));
import {ChapaPaymentHistory} from '../src/components/chapa-payment-history';
import WinningBids from '../src/app/(mini)/winning-bids/page';
import Wins from '../src/app/(mini)/profile/wins/page';
import Favorites from '../src/app/(mini)/profile/favorites/page';
import Wallet from '../src/app/(mini)/wallet/page';
import Deposit from '../src/app/(mini)/wallet/deposit/page';
import Alerts from '../src/app/(mini)/profile/alerts/page';
import FAQ from '../src/app/(mini)/faq/page';
import Payments from '../src/app/(mini)/payments/page';

const id='11111111-2222-4333-a444-555555555555',input=(value:Record<string,string|string[]|undefined>={})=>({searchParams:Promise.resolve(value)});
async function expectHistory(query:Record<string,string|string[]|undefined>={}){
 const rendered=await Payments(input(query));expect(rendered).toMatchObject({type:ChapaPaymentHistory,props:{fullPage:true}});expect(f.redirect).not.toHaveBeenCalled();
}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('ARIFPAY_SCHEMA_READY','true');f.session.mockResolvedValue({user:{id:'verified-owner'}});f.checkout.mockResolvedValue(null)});
afterEach(()=>vi.unstubAllEnvs());
describe('retired customer UI compatibility redirects',()=>{
 it.each([
  [WinningBids,'/my-bids?view=history'],[Wins,'/my-bids?view=history'],[Favorites,'/auctions/all'],[Wallet,'/profile#wallet'],[Deposit,'/profile?topup=1'],[Alerts,'/?notifications=1'],[FAQ,'/#how-lowwin-works'],
 ] as const)('keeps the old route meaningful at %s',async(render,destination)=>{
  await expect(Promise.resolve().then(()=>render())).rejects.toMatchObject({destination});expect(f.checkout).not.toHaveBeenCalled();expect(f.session).not.toHaveBeenCalled();
 });
 it('renders the current Transactions history without a legacy private lookup',async()=>{
  await expectHistory();expect(f.session).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
 });
 it.each(['checkout','checkoutId','id'])('preserves an owned %s link on its actual auction',async field=>{
  f.checkout.mockResolvedValue({id,auction:{publicCode:1234}});await expect(Payments(input({[field]:id}))).rejects.toMatchObject({destination:`/auctions/1234?checkout=${id}`});
  expect(f.session).toHaveBeenCalledTimes(1);expect(f.checkout).toHaveBeenCalledWith({where:{id,userId:'verified-owner'},select:{id:true,auction:{select:{publicCode:true}}}});
 });
 it('does not reveal another user’s checkout or query without a valid Mini App session',async()=>{
  await expectHistory({checkout:id});expect(f.checkout).toHaveBeenCalledWith({where:{id,userId:'verified-owner'},select:{id:true,auction:{select:{publicCode:true}}}});
  vi.clearAllMocks();f.session.mockResolvedValue(null);await expectHistory({checkout:id});expect(f.checkout).not.toHaveBeenCalled();
 });
 it.each([{checkout:'https://outside.example'},{checkout:['x',id]},{checkout:id,id},{checkout:'not-an-id'}])('rejects a malformed or ambiguous legacy payment reference',async query=>{
  await expectHistory(query);expect(f.session).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
 });
 it('keeps old database schemas independent of the retired payment list',async()=>{
  vi.stubEnv('ARIFPAY_SCHEMA_READY','false');await expectHistory({checkout:id});expect(f.session).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
 });
 it('retains retryable checkout identity on a database failure rather than hiding the failure',async()=>{
  f.checkout.mockRejectedValue(new Error('fixture database unavailable'));await expect(Payments(input({checkout:id}))).rejects.toThrow('fixture database unavailable');expect(f.redirect).not.toHaveBeenCalled();
 });
});
