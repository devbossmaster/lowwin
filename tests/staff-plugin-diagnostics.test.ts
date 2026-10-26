import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
const f=vi.hoisted(()=>({query:vi.fn(),user:vi.fn(),hash:vi.fn(),verify:vi.fn(),getSession:vi.fn()}));
vi.mock('better-auth/api',()=>({createAuthEndpoint:(_path:unknown,_options:unknown,handler:unknown)=>handler,getSessionFromCtx:f.getSession,APIError:class extends Error{constructor(readonly status:string,readonly body:{message:string}){super(body.message)}}}));
vi.mock('better-auth/cookies',()=>({setSessionCookie:vi.fn(),deleteSessionCookie:vi.fn()}));
vi.mock('better-auth/crypto',()=>({hashPassword:f.hash,verifyPassword:f.verify}));
import {staffPlugin} from '../src/modules/auth/staff-plugin';
const failure=(code:string)=>new Prisma.PrismaClientKnownRequestError('private SQL connection password token',{code,clientVersion:'6.19.3'});
function login(){const context={body:{email:'private-email@example.invalid',password:'private-password-value'},setCookie:vi.fn(),context:{internalAdapter:{findUserById:vi.fn().mockRejectedValue(failure('P1001'))}},json:vi.fn()};return (staffPlugin({$queryRaw:f.query,user:{findUnique:f.user}} as never).endpoints.staff_login as unknown as (ctx:typeof context)=>Promise<unknown>)(context)}
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'warn').mockImplementation(()=>{});f.query.mockReset().mockResolvedValue([{now:new Date()}]);f.user.mockReset().mockResolvedValue({id:'private-user',emailVerified:true,staffMember:{active:true,role:'OWNER',secret:'private-secret'},accounts:[{password:'private-hash'}]});f.hash.mockReset().mockResolvedValue('private-hash');f.verify.mockReset().mockResolvedValue(true)});
afterEach(()=>vi.restoreAllMocks());
function assertSafe(stage:string,code:string){expect(console.warn).toHaveBeenCalledWith('Staff credential operation unavailable',{action:'login',stage,code,kind:'PrismaClientKnownRequestError',elapsedMs:expect.any(Number)});expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private|postgresql|SELECT|password|example\.invalid/)}
describe('staff plugin failure classification before error wrapping',()=>{
 it('preserves the safe database code for a first clock read failure',async()=>{f.query.mockRejectedValue(failure('P2028'));await expect(login()).rejects.toMatchObject({status:'SERVICE_UNAVAILABLE',message:'Staff authentication is temporarily unavailable.'});assertSafe('clock-read','P2028')});
 it('identifies credential record queries independently of row locks',async()=>{f.user.mockResolvedValueOnce({id:'private-user'}).mockRejectedValueOnce(failure('P2022'));await expect(login()).rejects.toMatchObject({status:'SERVICE_UNAVAILABLE'});assertSafe('credential-read','P2022')});
 it('identifies session issue failures without exposing credentials or creating a success response',async()=>{await expect(login()).rejects.toMatchObject({status:'SERVICE_UNAVAILABLE'});assertSafe('session-issue','P1001')});
 it('does not report incorrect credentials as an infrastructure failure',async()=>{f.verify.mockResolvedValue(false);await expect(login()).rejects.toMatchObject({status:'UNAUTHORIZED'});expect(console.warn).not.toHaveBeenCalled()});
});
