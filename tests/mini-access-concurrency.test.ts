import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
const mocks=vi.hoisted(()=>({getSession:vi.fn(),findUnique:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{session:{findUnique:mocks.findUnique}}}));
vi.mock('../src/modules/auth/server',()=>({createAuth:()=>({api:{getSession:mocks.getSession}})}));
vi.mock('../src/modules/auth/local-identity',()=>({assertLocalIdentitySurface:()=>{throw Error('No preview')}}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> '123'}));
import {getLaunchSession,getMiniSession} from '../src/modules/auth/mini-access';

const current={session:{id:'session-a'},user:{id:'user-a'}};
const bound=()=>({telegramLaunchId:'456',user:{telegramId:'456',staffMember:null,ownContact:{telegramId:'456',botId:'123',revokedAt:null as Date|null}}});
const headers=(token='a')=>new Headers({cookie:`better-auth.session_token=${token}`});
beforeEach(()=>{vi.clearAllMocks();mocks.getSession.mockReset().mockResolvedValue(current);mocks.findUnique.mockReset().mockImplementation(async()=>bound())});

describe('concurrent Mini App session checks',()=>{
  it('shares one unfinished verification for a burst of same-session requests',async()=>{
    let release!:(value:typeof current)=>void;
    mocks.getSession.mockImplementation(()=>new Promise(resolve=>{release=resolve}));
    const requests=Array.from({length:12},()=>getMiniSession(headers()));
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    release(current);
    const results=await Promise.all(requests);
    expect(results.every(result=>result?.user.id==='user-a')).toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
  it('does not share verification between different session cookies',async()=>{
    await Promise.all([getMiniSession(headers('a')),getMiniSession(headers('b'))]);
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });
  it('rechecks contact revocation on the next request instead of caching success',async()=>{
    expect(await getMiniSession(headers())).not.toBeNull();
    mocks.findUnique.mockResolvedValue({...bound(),user:{...bound().user,ownContact:{...bound().user.ownContact,revokedAt:new Date()}}});
    expect(await getMiniSession(headers())).toBeNull();
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });
  it('removes failed lookups so retry can recover',async()=>{
    mocks.getSession.mockRejectedValueOnce({code:'P2024'});
    const failed=await Promise.allSettled([getMiniSession(headers()),getMiniSession(headers())]);
    expect(failed.every(result=>result.status==='rejected')).toBe(true);
    expect(await getMiniSession(headers())).not.toBeNull();
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });
  it('does not share launch-only checks with fully enrolled session checks',async()=>{
    mocks.findUnique.mockResolvedValue({...bound(),user:{...bound().user,ownContact:null}});
    const [launch,mini]=await Promise.all([getLaunchSession(headers()),getMiniSession(headers())]);
    expect(launch).not.toBeNull();expect(mini).toBeNull();
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });
  it('keeps transaction-scoped authorization independent',async()=>{
    const tx={session:{findUnique:vi.fn(async()=>bound())}} as unknown as Prisma.TransactionClient;
    await Promise.all([getMiniSession(headers()),getMiniSession(headers(),tx)]);
    expect(mocks.getSession).toHaveBeenCalledTimes(2);expect(tx.session.findUnique).toHaveBeenCalledOnce();
  });
  it.each(['unbound','mismatch','staff','wrong-contact','wrong-bot'])('denies a %s session',async(kind)=>{
    const row=bound();
    if(kind==='unbound')row.telegramLaunchId='';
    if(kind==='mismatch')row.telegramLaunchId='other';
    if(kind==='wrong-contact')row.user.ownContact.telegramId='other';
    if(kind==='wrong-bot')row.user.ownContact.botId='other';
    mocks.findUnique.mockResolvedValue(kind==='staff'?{...row,user:{...row.user,staffMember:{userId:'user-a'}}}:row);
    expect(await getMiniSession(headers())).toBeNull();
  });
});
