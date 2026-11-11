import {expect,test} from '@playwright/test';
import {openBid,v1Fixture} from './fixtures';

test('the bundled CBE Bank guide streams and plays inside the checkout without starting a payment',async({page},info)=>{
 test.skip(info.project.name!=='360','One actual media playback and range-delivery check.');
 const f=await v1Fixture(page),videoPath='/video/cbe-bank-payment.mp4',requests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname===videoPath)requests.push(request.headers().range??'')});
 try{
  await page.route('**/api/payments/chapa/v1/config',route=>route.fulfill({json:{enabled:true,configured:true,mode:'test',walletBidsEnabled:true,minTopup:'1.00',maxTopup:'43200.00',methods:[{slug:'telebirr',name:'telebirr'},{slug:'cbebirr',name:'CBE Birr'},{slug:'mpesa',name:'M-Pesa'},{slug:'ebirr',name:'eBirr'}],phone:'251911652904',cbeBankEnabled:true,cbeGuideUrl:videoPath}}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const dialog=await openBid(page,f.title);
  await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');
  await dialog.locator('[data-bid-continue]').click();
  await dialog.getByRole('radio',{name:'CBE Bank',exact:true}).click();
  const video=dialog.locator('[data-cbe-bank-guide] video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('src',videoPath);
  await expect(video).toHaveAttribute('preload','none');
  await expect(video).toHaveAttribute('controls','');
  await expect(video).toHaveJSProperty('autoplay',false);
  await expect(video).toHaveJSProperty('paused',true);
  expect(requests).toHaveLength(0);
  const mediaResponse=page.waitForResponse(response=>new URL(response.url()).pathname===videoPath&&response.status()===206);
  const metadata=await video.evaluate(async node=>{
   const media=node as HTMLVideoElement;media.muted=true;await media.play();
   return {duration:media.duration,width:media.videoWidth,height:media.videoHeight,error:media.error?.message??null};
  });
  const response=await mediaResponse;
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect(response.headers()['content-range']).toMatch(/^bytes \d+-\d+\/1445298$/);
  expect(requests.some(range=>/^bytes=\d*-\d*$/.test(range))).toBe(true);
  expect(metadata).toMatchObject({width:720,height:720,error:null});
  expect(metadata.duration).toBeCloseTo(29.652,1);
  await expect.poll(()=>video.evaluate(node=>(node as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await video.evaluate(node=>(node as HTMLVideoElement).pause());
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(f.commands).toHaveLength(0);expect(f.sdkCommands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
  await dialog.screenshot({path:info.outputPath('cbe-bank-guide-real-video.png')});
 }finally{
  await page.locator('[data-cbe-bank-guide] video').evaluateAll(nodes=>nodes.forEach(node=>(node as HTMLVideoElement).pause())).catch(()=>{});
  await f.cleanup();
 }
});
