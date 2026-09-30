import {expect,it} from 'vitest';
import {combineExtractions,extractedReference,ReceiptScanError} from '../src/modules/payments/ocr';
import {candidate,canonical} from '../src/modules/payments/reference';

it('accepts documented CBE Receipt IDs without changing case or truncating tokens',()=>{
 for(const reference of ['fHCxyTVljBclm6Yk4C','Rcpt_1-AbCdEf','a'.repeat(127)+'9']){
  expect(canonical('cbe',reference)).toBe(reference);
  expect(candidate('cbe',reference)).toBe(reference);
  expect(candidate('cbe',`Receipt ID: ${reference}`)).toBe(reference);
  expect(candidate('cbe',`https://mbreciept.cbe.com.et/${reference}`)).toBe(reference);
 }
 expect(candidate('cbe','https://mbreciept.cbe.com.et/receipt/Rcpt_1-AbCdEf/')).toBe('Rcpt_1-AbCdEf');
 expect(canonical('cbe','ft25356ll011')).toBe('FT25356LL011');
 for(const reference of ['short12345','a'.repeat(128)+'9']){
  expect(()=>candidate('cbe',reference)).toThrow();
  expect(()=>candidate('cbe',`Receipt ID: ${reference}`)).toThrow();
 }
 expect(()=>candidate('telebirr',`Reference: ${'A'.repeat(32)}9`)).toThrow();
 expect(()=>candidate('cbe','Receipt ID: Rcpt_1-AbCdEf Receipt ID: Rcpt_2-AbCdEf')).toThrow();
});

it('extracts Telebirr official receipt links locally and rejects lookalike or cross-bank URLs',()=>{
 for(const host of ['transactioninfo.ethiotelecom.et','apps.ethiotelecom.et'])expect(candidate('telebirr',`https://${host}/receipt/DEL889NG4S`)).toBe('DEL889NG4S');
 for(const url of ['https://transactioninfo.ethiotelecom.et.evil.example/receipt/DEL889NG4S','https://evil.example/receipt/DEL889NG4S','http://transactioninfo.ethiotelecom.et/receipt/DEL889NG4S','https://transactioninfo.ethiotelecom.et/receipt/DEL889NG4S?next=other'])expect(()=>candidate('telebirr',url)).toThrow();
 expect(()=>candidate('cbe','https://transactioninfo.ethiotelecom.et/receipt/DEL889NG4S')).toThrow();
});
it('uses clear reference confidence even when the surrounding receipt is hard to read',()=>{
 expect(extractedReference({text:'Reference: DEL889NG4S',confidence:40,words:[{text:'DEL889NG4S',confidence:94}]},'telebirr').reference).toBe('DEL889NG4S');
 expect(extractedReference({text:'Reference: DEL889NG4S',confidence:99,words:[{text:'DEL889NG4S',confidence:40}]},'telebirr')).toMatchObject({reference:'DEL889NG4S',uncertain:true,reviewRequired:true});
 expect(()=>extractedReference({text:'Reference: DEL889NG4S Reference: DEL889NG4T',confidence:99},'telebirr')).toThrow('single clear');
 expect(()=>extractedReference({text:'',confidence:99},'telebirr')).toThrow();
});

it('reports missing versus ambiguous OCR candidates without receipt contents',()=>{
 for(const [text,candidateCount] of [['Private payer account 0912345678',0],['Reference: DEL889NG4S Reference: DEL889NG4T',2]] as const){
  let failure:unknown;
  try{combineExtractions([{text,confidence:93},{text,confidence:91}],'telebirr')}catch(error){failure=error}
  expect(failure).toBeInstanceOf(ReceiptScanError);
  const diagnostics=(failure as ReceiptScanError).diagnostics;
  expect(diagnostics).toEqual([{pass:1,characters:text.length,candidateCount,confidence:93},{pass:2,characters:text.length,candidateCount,confidence:91}]);
  expect((failure as ReceiptScanError).referencesAgree).toBe(false);
  for(const secret of [text,'DEL889NG4S','DEL889NG4T','0912345678'])expect(JSON.stringify(diagnostics)).not.toContain(secret);
 }
});

it('reports whether both OCR passes read the same reference',()=>{
 const agreed=combineExtractions([{text:'Reference: DEL889NG4S',confidence:96},{text:'Reference: DEL889NG4S',confidence:93}],'telebirr');
 expect(agreed).toMatchObject({reference:'DEL889NG4S',referencesAgree:true,uncertain:false,reviewRequired:true});
 const single=combineExtractions([{text:'Reference: DEL889NG4S',confidence:96},{text:'No readable transaction code',confidence:80}],'telebirr');
 expect(single).toMatchObject({reference:'DEL889NG4S',referencesAgree:false,uncertain:true,reviewRequired:true});
 expect(()=>combineExtractions([{text:'Reference: DEL889NG4S',confidence:96},{text:'Reference: DEL889NG4T',confidence:95}],'telebirr')).toThrow(ReceiptScanError);
 try{combineExtractions([{text:'Reference: DEL889NG4S',confidence:96},{text:'Reference: DEL889NG4T',confidence:95}],'telebirr')}catch(error){expect((error as ReceiptScanError).referencesAgree).toBe(false)}
});

it('extracts one unlabelled OCR code, flags uncertainty and refuses ambiguity',()=>{
 const words=[{text:'DEL889NG4S',confidence:94}];
 expect(extractedReference({text:'Telebirr ተከፍሏል DEL889NG4S ETB 30.00',confidence:40,words},'telebirr').reference).toBe('DEL889NG4S');
 expect(()=>extractedReference({text:'Telebirr DEL889NG4S DEL889NG4T',confidence:99,words},'telebirr')).toThrow();
 expect(extractedReference({text:'Telebirr DEL889NG4S',confidence:40,words:[{text:'DEL889NG4S',confidence:50}]},'telebirr')).toMatchObject({reference:'DEL889NG4S',uncertain:true});
 expect(()=>extractedReference({text:'Telebirr DEL889NG4S',confidence:99,words},'cbe')).toThrow();
});
