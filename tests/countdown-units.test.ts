import {describe,expect,it} from 'vitest';
import {countdownUnits} from '@/lib/countdown-units';
import {dismissIntroduction,INTRODUCTION_DISMISSAL_KEY,introductionDismissed} from '@/lib/introduction';
describe('auction countdown visual units',()=>{
 it('crosses day/hour/minute boundaries without wrapping days',()=>{
  expect(countdownUnits(100*86400000+3600000+60000+9000)).toEqual(['100','01','01','09']);
  expect(countdownUnits(86400000)).toEqual(['01','00','00','00']);
  expect(countdownUnits(86399999)).toEqual(['00','23','59','59']);
  expect(countdownUnits(60000)).toEqual(['00','00','01','00']);
  expect(countdownUnits(59999)).toEqual(['00','00','00','59']);
 });
 it('never shows negative or invalid deadlines',()=>{
  expect(countdownUnits(-1)).toEqual(['00','00','00','00']);
  expect(countdownUnits(Number.NaN)).toEqual(['00','00','00','00']);
  expect(countdownUnits(Infinity)).toEqual(['00','00','00','00']);
 });
});
describe('first visit dismissal',()=>{
 it('stores only a versioned non-sensitive dismissal marker',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}};
  expect(introductionDismissed(storage)).toBe(false);
  dismissIntroduction(storage);
  expect([...values]).toEqual([[INTRODUCTION_DISMISSAL_KEY,'dismissed']]);
  expect(introductionDismissed(storage)).toBe(true);
 });
 it('does not prevent browsing if browser storage is blocked',()=>{
  expect(introductionDismissed({getItem:()=>{throw Error('blocked')}})).toBe(false);
  expect(()=>dismissIntroduction({setItem:()=>{throw Error('blocked')}})).not.toThrow();
 });
});
