import {describe,it,expect} from 'vitest';
import {readRequestText} from '../src/lib/request-body';
const streamed=(values:string[])=>new Request('https://lowwin.test/api',{method:'POST',body:new ReadableStream({start(controller){for(const value of values)controller.enqueue(new TextEncoder().encode(value));controller.close()}}),duplex:'half'} as RequestInit);
describe('bounded request streams',()=>{
 it('rejects chunked and multibyte overflow without Content-Length',async()=>{
  await expect(readRequestText(streamed(['ab','cd','ef']),5)).rejects.toMatchObject({status:413});
  await expect(readRequestText(streamed(['ሀሀ']),5)).rejects.toMatchObject({status:413});
 });
 it('retains exact UTF-8 text at the limit',async()=>{expect(await readRequestText(streamed(['ሀ','a']),4)).toBe('ሀa')});
 it('rejects oversized declared bodies before reading and compressed bodies',async()=>{
  await expect(readRequestText(new Request('https://lowwin.test',{method:'POST',headers:{'content-length':'100'},body:'x'}),10)).rejects.toMatchObject({status:413});
  await expect(readRequestText(new Request('https://lowwin.test',{method:'POST',headers:{'content-encoding':'gzip'},body:'x'}),10)).rejects.toMatchObject({status:415});
 });
});
