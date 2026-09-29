import {describe,it,expect} from 'vitest';
import {createsFourConsecutiveAmounts,parseBidCents} from '../src/modules/auctions/consecutive-bids';

describe('future cent-level bid rule',()=>{
  it('parses exact birr and cent amounts without floating-point rounding',()=>{
    expect(['1','1.0','1.00','1.01','1.05'].map(parseBidCents)).toEqual([100n,100n,100n,101n,105n]);
    for(const bad of ['0','0.00','1.001','1e2','01.05','-1','1,05',''])expect(()=>parseBidCents(bad)).toThrow();
  });
  it('requires a gap after three adjacent cent bids',()=>{
    expect(createsFourConsecutiveAmounts([101n,102n,103n],104n)).toBe(true);
    expect(createsFourConsecutiveAmounts([101n,102n,103n],105n)).toBe(false);
  });
  it('does not allow the fourth amount to fill a gap later',()=>{
    expect(createsFourConsecutiveAmounts([101n,102n,104n],103n)).toBe(true);
    expect(createsFourConsecutiveAmounts([101n,103n,104n],102n)).toBe(true);
    expect(createsFourConsecutiveAmounts([101n,102n,103n,105n],104n)).toBe(true);
  });
  it('allows separate runs of up to three and treats duplicates separately',()=>{
    expect(createsFourConsecutiveAmounts([101n,102n,103n,105n,106n],107n)).toBe(false);
    expect(createsFourConsecutiveAmounts([101n,102n,103n],103n)).toBe(false);
  });
});
