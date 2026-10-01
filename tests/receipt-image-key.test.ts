import {describe,expect,it} from 'vitest';
import {receiptImageKey} from '../src/components/receipt-image-key';

describe('receipt upload retry identity',()=>{
 it('reuses the key for retries and reselection of identical bytes',async()=>{
  const keys=new Map<string,string>(),image=new Blob(['original receipt'],{type:'image/png'});
  const first=await receiptImageKey(keys,'deposit-a',image);
  expect(await receiptImageKey(keys,'deposit-a',image)).toBe(first);
  expect(await receiptImageKey(keys,'deposit-a',new Blob(['original receipt'],{type:'image/png'}))).toBe(first);
 });
 it('changes the key for corrected bytes, different MIME or a different deposit',async()=>{
  const keys=new Map<string,string>(),image=new Blob(['original receipt'],{type:'image/png'});
  const first=await receiptImageKey(keys,'deposit-a',image);
  expect(await receiptImageKey(keys,'deposit-a',new Blob(['corrected receipt'],{type:'image/png'}))).not.toBe(first);
  expect(await receiptImageKey(keys,'deposit-a',new Blob(['original receipt'],{type:'image/jpeg'}))).not.toBe(first);
  expect(await receiptImageKey(keys,'deposit-b',image)).not.toBe(first);
  expect(await receiptImageKey(keys,'deposit-a',image)).toBe(first);
 });
});
