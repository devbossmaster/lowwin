import {describe,it,expect} from 'vitest';
import {AuctionClockAnchors} from '../src/lib/auction-clock';
const now='2026-10-25T10:00:00Z',end='2026-10-25T10:01:00Z';
describe('local countdown receipt anchors',()=>{
 it('paints the cached age before effects run',()=>{const c=new AuctionClockAnchors();expect(c.initial(end,now,1000,21000)).toBe(40000);c.observe(now,1000,21000);expect(c.initial(end,now,undefined,23000)).toBe(38000)});
 it('keeps elapsed time when a cached sheet remounts',()=>{const c=new AuctionClockAnchors(),a=c.observe(now,undefined,1000);expect(c.remaining(end,now,a,1000)).toBe(60000);const reopened=c.observe(now,undefined,9000);expect(c.remaining(end,now,reopened,9000)).toBe(52000)});
 it('uses a cached query receipt timestamp even on first mount',()=>{const c=new AuctionClockAnchors(),a=c.observe(now,1000,9000);expect(c.remaining(end,now,a,9000)).toBe(52000);expect(c.observe(now,7000,11000)).toBe(1000)});
 it('uses a fresh server sample without double subtracting cache age',()=>{const c=new AuctionClockAnchors(),later='2026-10-25T10:00:10Z',a=c.observe(later,11000,11000);expect(c.remaining(end,later,a,14000)).toBe(47000)});
 it('bounds anchors and never reports negative remaining time',()=>{const c=new AuctionClockAnchors(2);for(const key of ['a','b','c'])c.observe(key,undefined,1000);expect(c.size).toBe(2);expect(c.remaining(end,now,1000,70000)).toBe(0);expect(c.remaining('invalid',now,1000,2000)).toBe(0)});
});
