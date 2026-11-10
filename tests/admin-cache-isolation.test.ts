import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {AdminQueryProvider,adminRequest,clearAdminCache} from '../src/components/admin-query';
const mount=(identity:string)=>renderToString(createElement(AdminQueryProvider,{identity,children:null}));
describe('admin late-response isolation',()=>{
 const replace=vi.fn();
 beforeEach(()=>{replace.mockClear();vi.stubGlobal('window',{location:{replace}})});
 afterEach(()=>{clearAdminCache();vi.unstubAllGlobals()});
 it('rejects old mutation receipts after account or permission identity changes',async()=>{let release!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>release=resolve)));mount('first-session');const request=adminRequest('command',{action:'suspend',input:{userId:'player',suspended:true}});mount('new-session');release(Response.json({userId:'player',suspended:true}));await expect(request).rejects.toThrow('session changed');expect(replace).not.toHaveBeenCalled()});
 it('never clears the new staff cache because an older request returned forbidden',async()=>{let release!:(response:Response)=>void;const fetch=vi.fn(()=>new Promise<Response>(resolve=>release=resolve));vi.stubGlobal('fetch',fetch);mount('old-session');const old=adminRequest('command',{action:'suspend'});mount('new-session');release(Response.json({error:'Forbidden'},{status:403}));await expect(old).rejects.toThrow('session changed');expect(replace).not.toHaveBeenCalled();fetch.mockImplementation(async()=>Response.json({items:[{id:'new-private-row'}]}));expect(await adminRequest('workspace/players')).toEqual({items:[{id:'new-private-row'}]})});
 it('clears current private data on a real permission rejection',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Forbidden'},{status:403})));mount('current');await expect(adminRequest('workspace/players')).rejects.toThrow();expect(replace).toHaveBeenCalledWith('/admin');await expect(adminRequest('workspace/players')).rejects.toThrow('not initialized')});
});
