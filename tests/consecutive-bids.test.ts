import {describe,it,expect} from 'vitest';
import {parseBidCents} from '../src/modules/auctions/consecutive-bids';

describe('exact bid number parsing',()=>{
  it('parses exact birr and cent amounts without floating-point rounding',()=>{
    expect(['1','1.0','1.00','1.01','1.05'].map(parseBidCents)).toEqual([100n,100n,100n,101n,105n]);
    for(const bad of ['0','0.00','1.001','1e2','01.05','-1','1,05',''])expect(()=>parseBidCents(bad)).toThrow();
  });
  it('parses long contiguous cent ranges without a pattern restriction',()=>{
    expect(Array.from({length:100},(_,i)=>parseBidCents((1+i/100).toFixed(2)))).toEqual(Array.from({length:100},(_,i)=>100n+BigInt(i)));
  });
});
