import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
const f=vi.hoisted(()=>({user:vi.fn(),accounts:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{ledgerAccount:{findMany:f.accounts}}}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.user}));
import {PrivateApiError} from '../src/modules/auth/private-api';
import {GET} from '../src/app/api/wallet/route';
import {readWalletBalance} from '../src/modules/wallet/balance';
import {centsToEtb,etbToCents} from '../src/lib/money';
const request=()=>new Request('https://lowwin.example/api/wallet');
beforeEach(()=>{vi.clearAllMocks();f.user.mockResolvedValue('signed-in-player');f.accounts.mockResolvedValue([{kind:'AVAILABLE',balance:new Prisma.Decimal('1234.50')},{kind:'HELD',balance:new Prisma.Decimal('0.25')}])});
afterEach(()=>vi.unstubAllEnvs());
describe('header wallet connection',()=>{
 it('returns only the authenticated account balance and keeps top-ups unavailable',async()=>{const r=await GET(request());expect(r.status).toBe(200);expect(await r.json()).toEqual({available:'1234.5',held:'0.25',currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}});expect(f.accounts).toHaveBeenCalledWith({where:{wallet:{userId:'signed-in-player'},kind:{in:['AVAILABLE','HELD']}},select:{kind:true,balance:true}});expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('vary')).toBe('Cookie')});
 it('never queries balances for a guest or an unverified session',async()=>{f.user.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));expect((await GET(request())).status).toBe(401);expect(f.accounts).not.toHaveBeenCalled()});
 it('returns a real zero for an account without financial records, without initializing a wallet',async()=>{f.accounts.mockResolvedValue([]);const db={ledgerAccount:{findMany:f.accounts},wallet:{upsert:vi.fn()},journal:{create:vi.fn()}};expect(await readWalletBalance(db as never,'new-player')).toMatchObject({available:'0',held:'0'});expect(db.wallet.upsert).not.toHaveBeenCalled();expect(db.journal.create).not.toHaveBeenCalled()});
 it('does not turn a missing projection or database failure into a zero balance',async()=>{f.accounts.mockResolvedValue([{kind:'HELD',balance:new Prisma.Decimal(3)}]);expect((await GET(request())).status).toBe(503);f.accounts.mockRejectedValue(Error('private database detail'));const r=await GET(request());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('private database detail')});
 it('keeps cent formatting exact without converting a monetary value to Number',()=>{for(const [input,expected]of [['0','0.00'],['1.9','1.90'],['9007199254740993.97','9007199254740993.97']])expect(centsToEtb(etbToCents(input))).toBe(expected)});
});
