import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),decrypt:vi.fn()}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot',decryptPhone:f.decrypt}));
import {ownProfileContact} from '../src/modules/profile/account-contact';
import type {PrismaClient} from '@prisma/client';
const db={telegramOwnContact:{findUnique:f.read}} as unknown as PrismaClient;
const row={telegramId:'123',botId:'fixture-bot',revokedAt:null,lastFour:'0123',phoneCipher:'protected',user:{telegramId:'123'}};
beforeEach(()=>{vi.clearAllMocks();f.read.mockResolvedValue(row);f.decrypt.mockReturnValue('+251911000123')});
afterEach(()=>vi.restoreAllMocks());
describe('owner-only Profile contact',()=>{
 it('masks the verified phone and reads only the authenticated owner',async()=>{expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:true,phoneDisplay:'2519110***23'});expect(f.read.mock.calls[0][0].where).toEqual({userId:'owner'})});
 it('shows only the known suffix if the protected phone is unreadable',async()=>{f.decrypt.mockImplementation(()=>{throw Error('private key unavailable')});expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:true,phoneDisplay:'***23'})});
 it.each([null,{...row,revokedAt:new Date()},{...row,botId:'different-bot'},{...row,user:{telegramId:'other'}},{...row,user:null}])('never reveals a missing, revoked or differently bound contact',async value=>{f.read.mockResolvedValue(value);expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:false,phoneDisplay:null});expect(f.decrypt).not.toHaveBeenCalled()});
});
