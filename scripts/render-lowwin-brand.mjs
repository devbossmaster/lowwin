// Generate locale-specific 1840x800 campaign artwork from the approved image
// and editable, self-hosted type. No network requests or image-model calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const root=resolve(import.meta.dirname,'..'),imageName='lowwin-family-blue-20261114.webp';
const source=await readFile(resolve(root,'docs/design',imageName));
const mark=await readFile(resolve(root,'public/images/lowwin-flat-mark-20261114.svg'));
const inter=await readFile(resolve(root,'public/fonts/inter-latin-variable.woff2'));
const ethiopic=await readFile(resolve(root,'public/fonts/noto-sans-ethiopic-variable.woff2'));
const data=(bytes,mime)=>`data:${mime};base64,${bytes.toString('base64')}`;
const output=resolve(root,'public/images');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),records=[];
try{
 for(const language of ['en','am']){
  const am=language==='am';
  const page=await browser.newPage({viewport:{width:1840,height:800},deviceScaleFactor:1});
  await page.setContent(`<!doctype html><html lang="${language}"><meta charset="utf-8"><style>
   @font-face{font-family:Inter;src:url('${data(inter,'font/woff2')}')}@font-face{font-family:Ethiopic;src:url('${data(ethiopic,'font/woff2')}')}
   *{box-sizing:border-box}body{margin:0}.banner{width:1840px;height:800px;position:relative;overflow:hidden;background:#bdd5f0;color:#142b4d;font-family:Inter,sans-serif}.scene{position:absolute;width:100%;height:100%;object-fit:cover}.copy{position:absolute;left:64px;top:64px;width:555px}.brand{display:flex;align-items:center;gap:20px;font-size:58px;font-weight:750;letter-spacing:-2px}.brand img{width:84px;height:84px}h1{font-size:${am?88:96}px;line-height:${am?1.32:1.07};font-weight:750;letter-spacing:${am?'0':'-4px'};margin:76px 0 28px}h1 span{color:#174cbb}p{margin:0;font-size:38px;font-weight:550;line-height:1.4;max-width:470px}.am h1,.am p{font-family:Ethiopic,Inter,sans-serif}.am p{font-size:36px;line-height:1.5}
   </style><main class="banner ${am?'am':''}"><img class="scene" src="${data(source,'image/webp')}" alt=""><div class="copy"><div class="brand"><img src="${data(mark,'image/svg+xml')}" alt="">LowWin</div><h1>${am?'ትንሽ ዋጋ።<br><span>ትልቅ ደስታ።</span>':'Small price.<br><span>Big joy.</span>'}</h1><p>${am?'ዝቅተኛ ያልተደገመ<br>ዋጋ ያሸንፋል።':'The lowest unique<br>bid wins.'}</p></div></main>`);
  await page.evaluate(()=>document.fonts.ready);await page.locator('.scene').evaluate(img=>img.decode());
  const bytes=await page.screenshot({type:'png'}),name=`lowwin-light-blue-banner-${language}-20261114.webp`;
  await sharp(bytes).webp({quality:86,effort:5}).toFile(resolve(output,name));
  const result=await readFile(resolve(output,name));records.push({file:`public/images/${name}`,width:1840,height:800,bytes:result.length,sha256:createHash('sha256').update(result).digest('hex')});await page.close();
 }
 await sharp(mark).resize(192,192).png().toFile(resolve(output,'lowwin-flat-icon-20261114.png'));
 await writeFile(resolve(output,'lowwin-light-blue-brand-20261114.provenance.json'),JSON.stringify({date:'2026-11-14',tool:'built-in image_gen + HTML/CSS typography rendered by Chromium',source:`docs/design/${imageName}`,prompt:'Preserve the Ethiopian family, bicycle, iPhone 18 Pro Max retail box, PlayStation 5 Slim box and red suitcase. Use a clean matte light-mid blue background slightly deeper than pale sky blue, with understated rounded backdrop shapes. Keep the left area free for native bilingual typography. No satin or dark background.',logo:'Native flat blue-and-white LW vector mark; LowWin wordmark',illustrative:true,records},null,2)+'\n');
 console.log(JSON.stringify(records));
}finally{await browser.close()}
