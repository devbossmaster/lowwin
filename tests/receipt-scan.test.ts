import {afterEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {cleanReceipt,scanReceipt} from '../src/modules/payments/ocr';
afterEach(()=>vi.unstubAllEnvs());
it('preserves the width and text size of a tall phone screenshot',async()=>{
 const bytes=await sharp({create:{width:1080,height:4000,channels:3,background:'white'}}).png().toBuffer();
 const meta=await sharp(await cleanReceipt(bytes,'image/png')).metadata();expect(meta.width).toBe(1080);expect(meta.height).toBe(4000);
});
it.each(['telebirr','cbe'] as const)('extracts a %s code from a receipt layout using the real scanner',async bank=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');const reference=bank==='cbe'?'FT1234567893':'DEL889NG4S';
 const bytes=await sharp(Buffer.from(`<svg width="720" height="2400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="black"><text x="35" y="90" font-size="30">${bank}</text><text x="35" y="240" font-size="26">Payment completed</text><text x="35" y="520" font-size="24">Transaction reference:</text><text x="35" y="565" font-size="24">${reference}</text><text x="35" y="960" font-size="24">Amount</text><text x="510" y="960" font-size="24">100.00 ETB</text></g></svg>`)).png().toBuffer();
 const start=performance.now(),result=await scanReceipt(bytes,'image/png',bank);expect(result.reference).toBe(reference);expect(result.reviewRequired).toBe(true);console.info(`${bank} local receipt scan: ${Math.round(performance.now()-start)}ms`);
},30000);

it('requires manual fallback for a low contrast reference both passes misread',async()=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');
 const bytes=await sharp(Buffer.from('<svg width="720" height="1600"><rect width="100%" height="100%" fill="#eeeeee"/><g font-family="Arial" fill="#999999" font-size="24"><text x="35" y="140">Telebirr</text><text x="35" y="300">Reference: DIU89YSKT8</text></g></svg>')).png().toBuffer();
 await expect(scanReceipt(bytes,'image/png','telebirr')).rejects.toThrow();
},30000);
it('rejects an image containing multiple transaction references',async()=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');
 const bytes=await sharp(Buffer.from('<svg width="1000" height="400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="36"><text x="30" y="120">Reference: DEL889NG4S</text><text x="30" y="220">Reference: DEL889NG4T</text></g></svg>')).png().toBuffer();
 await expect(scanReceipt(bytes,'image/png','telebirr')).rejects.toThrow();
},30000);
