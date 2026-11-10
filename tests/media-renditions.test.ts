import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {createMediaRendition} from '../src/modules/media/renditions';
import {mediaRenditions} from '../src/lib/media-renditions';

const source=()=>sharp({create:{width:1840,height:800,channels:4,background:'#cc0000'}}).composite([{input:Buffer.from('<svg width="1840" height="800"><rect x="920" width="920" height="800" fill="#0000cc"/></svg>')}]).png().toBuffer();
describe('managed image renditions',()=>{
 it('encodes truthful width candidates while retaining the original banner composition and bytes',async()=>{
  const original=await source(),before=Buffer.from(original);
  for(const [variant,spec] of Object.entries(mediaRenditions)){
   const bytes=await createMediaRendition(original,variant as keyof typeof mediaRenditions),metadata=await sharp(bytes).metadata();
   expect(metadata).toMatchObject({format:'webp',width:spec.width,height:spec.square?spec.width:Math.round(spec.width*800/1840)});
   expect(bytes.length).toBeLessThan(original.length);
  }
  expect(original).toEqual(before);
 });
 it('contains the complete banner in a transparent square instead of cropping either edge',async()=>{
  const bytes=await createMediaRendition(await source(),'thumb-192'),{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
  expect(pixel(96,0)[3]).toBe(0);expect(pixel(2,96)[0]).toBeGreaterThan(180);expect(pixel(189,96)[2]).toBeGreaterThan(180);
 });
});
