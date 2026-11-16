// Rebuild the bilingual campaign artwork from the preserved text-free source.
// Run from the repository root: node docs/design/render-home-banner.mjs
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const art='docs/design/lowwin-family-pearl-blue-20261116.webp';
const data=(path,type)=>`data:${type};base64,${readFileSync(path).toString('base64')}`;
const background=data(art,'image/webp');
const inter=data('public/fonts/inter-latin-variable.woff2','font/woff2');
const ethiopic=data('public/fonts/noto-sans-ethiopic-variable.woff2','font/woff2');
const copy={en:{lines:['Small price.','Big joy.'],lead:'The lowest unique<br>bid wins.'},am:{lines:['ትንሽ ዋጋ።','ትልቅ ደስታ።'],lead:'ዝቅተኛና ያልተደገመ<br>ዋጋ ያሸንፋል።'}};
const browser=await chromium.launch({headless:true,channel:'chrome'});
const records=[];
try{
 for(const [kind,width,height] of [['banner',1840,800],['home',1600,900]])for(const language of ['en','am']){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const item=copy[language],mobile=kind==='home';
  await page.setContent(`<!doctype html><html lang="${language}"><meta charset="utf-8"><style>
   @font-face{font-family:Inter;src:url('${inter}');font-weight:100 900}
   @font-face{font-family:Ethiopic;src:url('${ethiopic}');font-weight:100 900}
   *{box-sizing:border-box}body{margin:0;background:#f4ece8}
   main{position:relative;width:${width}px;height:${height}px;overflow:hidden}
   img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}
   section{position:absolute;left:${mobile?54:66}px;top:${mobile?200:152}px;width:${mobile?500:590}px;font-family:Inter,Ethiopic,sans-serif;color:#162c47}
   h1{margin:0;font-size:${language==='am'?(mobile?75:88):(mobile?84:98)}px;font-weight:750;line-height:${language==='am'?1.3:1.08};letter-spacing:${language==='am'?0:'-.045em'}}
   h1 span{display:block;white-space:nowrap}h1 span+span{margin-top:${language==='am'?8:12}px;color:#1d4ed8}
   p{margin:${mobile?36:30}px 0 0;font-size:${language==='am'?(mobile?37:39):(mobile?37:40)}px;font-weight:500;line-height:${language==='am'?1.6:1.35};letter-spacing:${language==='am'?0:'-.02em'};color:#314860}
  </style><main><img src="${background}" alt=""><section><h1><span>${item.lines[0]}</span><span>${item.lines[1]}</span></h1><p>${item.lead}</p></section></main></html>`);
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('img').evaluate(image=>image.decode());
  const fits=await page.locator('h1 span').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth));
  if(!fits)throw new Error(`Headline exceeds its artwork column: ${kind}/${language}`);
  const png=await page.screenshot();
  const file=`public/images/lowwin-pearl-${kind}-${language}-20261116.webp`;
  await sharp(png).webp({quality:84,effort:6}).toFile(file);
  const bytes=readFileSync(file);records.push({file,width,height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  await page.close();
 }
 writeFileSync('public/images/lowwin-pearl-20261116.provenance.json',JSON.stringify({date:'2026-11-16',source:art,tool:'Built-in image_gen background; Chromium native Inter and Noto Sans Ethiopic typography; Sharp WebP encoding',illustrative:true,records},null,2)+'\n');
 console.log(JSON.stringify({rendered:records.length,records}));
}finally{await browser.close()}
