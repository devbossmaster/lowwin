import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
const f=vi.hoisted(()=>({transaction:vi.fn(),createAuth:vi.fn(),handler:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{$transaction:f.transaction}}));
vi.mock('../src/lib/env',()=>({getEnv:()=>({BETTER_AUTH_URL:'http://localhost:3000'})}));
vi.mock('../src/modules/auth/server',()=>({createAuth:f.createAuth}));
import {handleAuth} from '../src/modules/auth/handler';
const request=(path='sign-in/email',origin='http://localhost:3000')=>new Request('http://localhost:3000/api/auth/'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'private@example.invalid',password:'private-password'})});
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'warn').mockImplementation(()=>{});f.handler.mockResolvedValue(Response.json({token:'private-session-token',user:{id:'staff'}}));f.createAuth.mockReturnValue({handler:f.handler})});
afterEach(()=>vi.restoreAllMocks());
describe('ordinary email auth transport',()=>{
 it('runs the library outside an interactive transaction and never returns its bearer session token',async()=>{const response=await handleAuth(request());expect(await response.json()).toEqual({ok:true,user:{id:'staff'}});expect(f.transaction).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store')});
 it('rejects wrong origins before the authentication library',async()=>{expect((await handleAuth(request('sign-in/email','https://untrusted.invalid'))).status).toBe(403);expect(f.handler).not.toHaveBeenCalled()});
 it.each(['lowin/staff/login','lowin/staff/mfa','lowin/staff/enroll','lowin/staff/accept-invite','two-factor/disable','admin/set-role'])('retires the old or privileged route %s',async path=>{expect((await handleAuth(request(path))).status).toBe(404);expect(f.handler).not.toHaveBeenCalled()});
 it('sanitizes provider-wrapped infrastructure responses and never forwards a success cookie',async()=>{f.handler.mockResolvedValue(Response.json({message:'private database details'},{status:500,headers:{'Set-Cookie':'private-issued-cookie'}}));const response=await handleAuth(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');expect(response.headers.has('set-cookie')).toBe(false)});
 it('logs only fixed infrastructure diagnostics',async()=>{f.handler.mockRejectedValue(new Prisma.PrismaClientInitializationError('private database credentials','6.19.3','P1001'));expect((await handleAuth(request())).status).toBe(503);expect(console.warn).toHaveBeenCalledWith('Admin authentication unavailable',expect.objectContaining({stage:'email-auth',code:'P1001',kind:'PrismaClientInitializationError'}));expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')});
 it('preserves ordinary credential rejections without infrastructure logs',async()=>{f.handler.mockResolvedValue(Response.json({message:'Invalid email or password'},{status:401}));expect((await handleAuth(request())).status).toBe(401);expect(console.warn).not.toHaveBeenCalled()});
});
