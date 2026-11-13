import {describe,expect,it} from 'vitest';
import {auctionPresentationRefreshVersion as revision} from '../src/lib/auction-presentation-refresh';

describe('open auction correction refresh',()=>{
 it('refreshes only a newer published revision, including an older cached DTO without its version',()=>{
  expect(revision(2,3,0)).toBe(3);
  expect(revision(undefined,1,0)).toBe(1);
  expect(revision(3,3,0)).toBeNull();
  expect(revision(3,2,0)).toBeNull();
 });
 it('does not repeat a failed or in-flight refresh for the same revision on each activity tick',()=>{
  let requested=0,calls=0;
  for(const observed of [4,4,4,5,5,4]){
   const next=revision(3,observed,requested);
   if(next!==null){requested=next;calls++}
  }
  expect(calls).toBe(2);expect(requested).toBe(5);
 });
 it('ignores absent, invalid and unversioned activity while leaving ordinary refresh available',()=>{
  for(const observed of [undefined,0,-1,NaN,Infinity,1.5])expect(revision(0,observed,0)).toBeNull();
 });
});
