import {expect,it} from 'vitest';
import {extractedReference} from '../src/modules/payments/ocr';
it('uses clear reference confidence even when the surrounding receipt is hard to read',()=>{
 expect(extractedReference({text:'Reference: DEL889NG4S',confidence:40,words:[{text:'DEL889NG4S',confidence:94}]},'telebirr').reference).toBe('DEL889NG4S');
 expect(()=>extractedReference({text:'Reference: DEL889NG4S',confidence:50,words:[{text:'DEL889NG4S',confidence:40}]},'telebirr')).toThrow('uncertain');
 expect(()=>extractedReference({text:'Reference: DEL889NG4S Reference: DEL889NG4T',confidence:99},'telebirr')).toThrow('single clear');
 expect(()=>extractedReference({text:'',confidence:99},'telebirr')).toThrow();
});
