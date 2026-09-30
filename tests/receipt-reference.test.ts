import {expect,it} from 'vitest';
import {combineExtractions,extractedReference,ReceiptScanError} from '../src/modules/payments/ocr';
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
  for(const secret of [text,'DEL889NG4S','DEL889NG4T','0912345678'])expect(JSON.stringify(diagnostics)).not.toContain(secret);
 }
});

it('extracts one unlabelled OCR code, flags uncertainty and refuses ambiguity',()=>{
 const words=[{text:'DEL889NG4S',confidence:94}];
 expect(extractedReference({text:'Telebirr ተከፍሏል DEL889NG4S ETB 30.00',confidence:40,words},'telebirr').reference).toBe('DEL889NG4S');
 expect(()=>extractedReference({text:'Telebirr DEL889NG4S DEL889NG4T',confidence:99,words},'telebirr')).toThrow();
 expect(extractedReference({text:'Telebirr DEL889NG4S',confidence:40,words:[{text:'DEL889NG4S',confidence:50}]},'telebirr')).toMatchObject({reference:'DEL889NG4S',uncertain:true});
 expect(()=>extractedReference({text:'Telebirr DEL889NG4S',confidence:99,words},'cbe')).toThrow();
});
