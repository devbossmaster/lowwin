import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {cleanReceipt,combineExtractions,extractedReference} from '../src/modules/payments/ocr';
import {candidate} from '../src/modules/payments/provider';

describe('local receipt extraction only',()=>{
 it('preserves a current CBE Receipt ID for customer correction',()=>{
  const result=extractedReference({text:'CBE Receipt ID: fHCxyExampleRcpt1',confidence:92},'cbe');
  expect(result).toMatchObject({reference:'fHCxyExampleRcpt1',reviewRequired:true});
  expect(candidate('cbe','fHCxyExampleRcpt2')).toBe('fHCxyExampleRcpt2');
 });
 it('rejects conflicting OCR passes instead of guessing characters',()=>{
  expect(()=>combineExtractions([{text:'Receipt ID: fHCxyExampleRcpt1',confidence:90},{text:'Receipt ID: fHCxyExampleRcpt2',confidence:90}],'cbe')).toThrow();
 });
 it('keeps hyphens, underscores, case and long CBE references intact through OCR',()=>{
  for(const reference of ['Rcpt_1-AbCdEf','a'.repeat(127)+'9']){
   const pass={text:`Receipt ID: ${reference}`,confidence:45,words:[{text:reference,confidence:96}]};
   expect(combineExtractions([pass,pass],'cbe')).toMatchObject({reference,reviewRequired:true,referencesAgree:true,uncertain:false});
   expect(extractedReference({text:`CBE ${reference}`,confidence:96},'cbe').reference).toBe(reference);
  }
  expect(()=>extractedReference({text:`CBE ${'a'.repeat(128)}9`,confidence:96},'cbe')).toThrow();
  expect(()=>extractedReference({text:'CBE Rcpt_1-AbCdEf Rcpt_2-AbCdEf',confidence:96},'cbe')).toThrow();
 });
 it('decodes a static image locally and rejects mismatched type',async()=>{
  const image=await sharp({create:{width:100,height:80,channels:3,background:'white'}}).png().toBuffer();
  const clean=await cleanReceipt(Buffer.from(image),'image/png');expect(clean.subarray(0,8).equals(image.subarray(0,8))).toBe(true);
  await expect(cleanReceipt(Buffer.from(image),'image/jpeg')).rejects.toThrow();
 });
});
