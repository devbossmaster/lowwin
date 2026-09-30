import {afterEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {cleanReceipt,scanReceipt} from '../src/modules/payments/ocr';
afterEach(()=>vi.unstubAllEnvs());
it('preserves the width and text size of a tall phone screenshot',async()=>{
 const bytes=await sharp({create:{width:1080,height:4000,channels:3,background:'white'}}).png().toBuffer();
 const meta=await sharp(await cleanReceipt(bytes,'image/png')).metadata();expect(meta.width).toBe(1080);expect(meta.height).toBe(4000);
});
it.each([720,3000])('preserves all original pixels and colours at width %i',async width=>{
 const bytes=await sharp(Buffer.from(`<svg width="${width}" height="240"><rect width="100%" height="100%" fill="#12a65c"/><rect x="30" y="40" width="250" height="80" fill="#ee4367"/><text x="35" y="180" font-family="Arial" font-size="24" fill="#1245ac">Reference: DEL889NG4S</text></svg>`)).png().toBuffer();
 const original=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
 const cleaned=await sharp(await cleanReceipt(bytes,'image/png')).raw().toBuffer({resolveWithObject:true});
 expect(cleaned.info).toEqual(original.info);expect(cleaned.data.equals(original.data)).toBe(true);
});
it.each(['telebirr','cbe'] as const)('extracts a %s code at original resolution using the real scanner',async bank=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');const reference=bank==='cbe'?'FT1234567893':'DEL889NG4S';
 const bytes=await sharp(Buffer.from(`<svg width="720" height="2400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="black"><text x="35" y="90" font-size="30">${bank}</text><text x="35" y="240" font-size="26">Payment completed</text><text x="35" y="520" font-size="24">Transaction reference:</text><text x="35" y="565" font-size="36">${reference}</text><text x="35" y="960" font-size="24">Amount</text><text x="510" y="960" font-size="24">100.00 ETB</text></g></svg>`)).png().toBuffer();
 const start=performance.now(),result=await scanReceipt(bytes,'image/png',bank);expect(result.reference).toMatch(/^[A-Z0-9]{8,32}$/);expect(result.reviewRequired).toBe(true);console.info(`${bank} local receipt scan: ${Math.round(performance.now()-start)}ms`);
},30000);

it('keeps a small-text extraction editable without enlarging the image',async()=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');
 const bytes=await sharp(Buffer.from('<svg width="720" height="2400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="black"><text x="35" y="90" font-size="30">telebirr</text><text x="35" y="240" font-size="26">Payment completed</text><text x="35" y="520" font-size="24">Transaction reference:</text><text x="35" y="565" font-size="24">DEL889NG4S</text><text x="35" y="960" font-size="24">Amount</text><text x="510" y="960" font-size="24">100.00 ETB</text></g></svg>')).png().toBuffer();
 // Tesseract's exact reading and confidence vary by host. Its output remains editable.
 expect(await scanReceipt(bytes,'image/png','telebirr')).toMatchObject({reviewRequired:true});
},30000);
it('keeps low-contrast scans editable or falls back to manual entry',async()=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');
 const bytes=await sharp(Buffer.from('<svg width="720" height="1600"><rect width="100%" height="100%" fill="#eeeeee"/><g font-family="Arial" fill="#999999" font-size="24"><text x="35" y="140">Telebirr</text><text x="35" y="300">Reference: DIU89YSKT8</text></g></svg>')).png().toBuffer();
 try{expect(await scanReceipt(bytes,'image/png','telebirr')).toMatchObject({reviewRequired:true})}
 catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toMatch(/read|uncertain|manually/i)}
},30000);
it('rejects an image containing multiple transaction references',async()=>{
 vi.stubEnv('RECEIPT_OCR','tesseract');
 const bytes=await sharp(Buffer.from('<svg width="1000" height="400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="36"><text x="30" y="120">Reference: DEL889NG4S</text><text x="30" y="220">Reference: DEL889NG4T</text></g></svg>')).png().toBuffer();
 await expect(scanReceipt(bytes,'image/png','telebirr')).rejects.toThrow();
},30000);
