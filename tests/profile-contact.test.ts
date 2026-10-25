import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),decrypt:vi.fn()}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot',decryptPhone:f.decrypt,normalizePhone:(value:string)=>value}));
import {ownProfileContact} from '../src/modules/profile/account-contact';
import type {PrismaClient} from '@prisma/client';
const db={telegramOwnContact:{findUnique:f.read}} as unknown as PrismaClient;
const row={telegramId:'123',botId:'fixture-bot',revokedAt:null,lastFour:'0123',phoneCipher:'protected',user:{telegramId:'123'}};
beforeEach(()=>{vi.clearAllMocks();f.read.mockResolvedValue(row);f.decrypt.mockReturnValue('+251911000123')});
afterEach(()=>vi.restoreAllMocks());
describe('owner-only Profile contact',()=>{
 it('reads only the authenticated owner and permits their own verified phone display',async()=>{expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:true,phoneDisplay:'+251911000123'});expect(f.read.mock.calls[0][0].where).toEqual({userId:'owner'})});
 it('keeps an unreadable verified contact masked without breaking Profile',async()=>{f.decrypt.mockImplementation(()=>{throw Error('private key unavailable')});expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:true,phoneDisplay:'•••• 0123'})});
 it.each([null,{...row,revokedAt:new Date()},{...row,botId:'different-bot'},{...row,user:{telegramId:'other'}},{...row,user:null}])('never reveals a missing, revoked or differently bound contact',async value=>{f.read.mockResolvedValue(value);expect(await ownProfileContact(db,'owner')).toEqual({contactVerified:false,phoneDisplay:null});expect(f.decrypt).not.toHaveBeenCalled()});
});
