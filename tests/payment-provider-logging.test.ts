import {afterEach,describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {validateReceiptImage} from '../src/modules/payments/ocr';
import {submitVerify,submitVerifyImage,type VerificationInput} from '../src/modules/payments/provider';
const requestId='550e8400-e29b-41d4-a716-446655440000';
const input:VerificationInput={bank:'telebirr',reference:'SECRETREF123',account:'0912345678',expectedCents:null,minCents:100n,maxCents:2000n,createdAt:new Date(Date.now()-60000),expiresAt:new Date(Date.now()+60000),attemptKey:'stable-attempt'};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('Verify.et JSON transport',()=>{
 it.each(['png','jpeg','webp'] as const)('preserves the full tall %s screenshot through validation and multipart upload',async format=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},{status:202}));
  vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  const image=await sharp({create:{width:1080,height:3200,channels:3,background:'white'}}).toFormat(format).toBuffer();
  const original=Buffer.from(image),mime=`image/${format}` as const;
  await validateReceiptImage(image,mime);
  await submitVerifyImage({...input,image,mime});
  const form=fetcher.mock.calls[0][1].body as FormData;
  const uploaded=form.get('image') as Blob;
  expect(uploaded.type).toBe(mime);
  const bytes=Buffer.from(await uploaded.arrayBuffer());
  expect(bytes).toEqual(original);expect(image).toEqual(original);
  expect(await sharp(bytes).metadata()).toMatchObject({width:1080,height:3200,format});
 });
 it.each(['qr','ocr'] as const)('reads safe %s image metadata from a queued response without data',async method=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,imageProcessing:{attemptId:'private-image-attempt',method,chargedCredits:1,receipt:'private-receipt'},verification:{processingStatus:'queued',status:'pending',verified:false}},{status:202})));
  vi.spyOn(console,'warn').mockImplementation(()=>{});const info=vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerifyImage({...input,image:Buffer.from('fixture'),mime:'image/png'})).toMatchObject({verification:{code:'PROCESSING',requestId},imageProcessing:{method,chargedCredits:1}});
  const line=info.mock.calls[0][0];expect(JSON.parse(line)).toMatchObject({event:'payment_image_processing',method,chargedCredits:1});
  for(const secret of ['private-image-attempt','private-receipt','private-key',input.reference,input.account])expect(line).not.toContain(secret);
 });
 it('sends the original receipt as multipart without forcing a content type',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  const image=Buffer.from([0x89,0x50,0x4e,0x47]);
  expect(await submitVerifyImage({...input,image,mime:'image/png'})).toMatchObject({verification:{code:'PROCESSING',matched:false}});
  const [url,options]=fetcher.mock.calls[0],headers=options.headers as Record<string,string>,form=options.body as FormData;
  expect(url).toBe('https://verify.et/api/verify?waitMs=5000');expect(headers).toMatchObject({'x-api-key':'private-key','Idempotency-Key':'stable-attempt'});expect(headers).not.toHaveProperty('Content-Type');
  expect(form).toBeInstanceOf(FormData);expect(form.get('bank')).toBe('telebirr');expect(form.get('settlementAccount')).toBe(input.account);
  const uploaded=form.get('image');expect(uploaded).toBeInstanceOf(Blob);expect((uploaded as Blob).type).toBe('image/png');expect(Buffer.from(await (uploaded as Blob).arrayBuffer())).toEqual(image);
 });
 it('accepts a completed CBE image result that contains both receipt and legacy references',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  const receipt='fHCxyExampleRcpt1',legacy='FT26EXAMPLE1',account='1000303997441';
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'cbe',status:'success',verified:true,amount:10,referenceNumber:legacy,receiptNumber:receipt,receiverAccount:account,timestamp:new Date().toISOString()}]})));
  vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerifyImage({...input,bank:'cbe',account,image:Buffer.from('fixture'),mime:'image/png'})).toMatchObject({reference:receipt,verification:{code:'VERIFIED',matched:true,evidence:{aliases:expect.arrayContaining([receipt,legacy])}}});
 });
 it('sends only JSON, bank fields, frozen receiver and stable key',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'PROCESSING',matched:false});
  const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://verify.et/api/verify?waitMs=5000');expect(options.headers).toMatchObject({'x-api-key':'private-key','Idempotency-Key':'stable-attempt','Content-Type':'application/json'});expect(JSON.parse(options.body)).toEqual({bank:'telebirr',transactionNumber:input.reference,settlementAccount:input.account});expect(options.body).not.toContain('image');
 });
 it('sends current CBE Receipt ID without suffix and legacy FT with suffix',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued'},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  await submitVerify({...input,bank:'cbe',reference:'fHCxyExampleRcpt1',account:'1000303997441'});expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({bank:'cbe',reference:'fHCxyExampleRcpt1',settlementAccount:'1000303997441'});
  await submitVerify({...input,bank:'cbe',reference:'FT26EXAMPLE1',account:'1000303997441'});expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({bank:'cbe',reference:'FT26EXAMPLE1',suffix:'03997441',settlementAccount:'1000303997441'});
 });
 it.each([[401,'PROVIDER_AUTH'],[402,'PROVIDER_QUOTA'],[429,'PROVIDER_RATE_LIMIT'],[503,'PROVIDER_OUTAGE']] as const)('keeps HTTP %s diagnostics private',async(status,code)=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-provider-body',{status})));const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code,matched:false});const line=log.mock.calls[0][0];expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:status,code});for(const secret of [input.reference,input.account,'private-key','private-provider-body'])expect(line).not.toContain(secret);
 });
 it('accepts omitted currency under the ETB channel policy and logs its source without private data',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,referenceNumber:input.reference,receiverAccount:input.account,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'VERIFIED',matched:true,evidence:{currency:'ETB',currencySource:'channel_policy'}});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'VERIFIED',currencySource:'channel_policy'});
  expect(JSON.parse(line)).not.toHaveProperty('invalidFields');
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it.each([[null],[1],[true],[['ETB']],[{value:'ETB'}],['USD']] as const)('ignores provider currency %j and records only the application unit',async currency=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,currency,referenceNumber:input.reference,receiverAccount:input.account,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'VERIFIED',matched:true,evidence:{currency:'ETB',currencySource:'channel_policy'}});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'VERIFIED',currencySource:'channel_policy'});
  expect(JSON.parse(line)).not.toHaveProperty('invalidFields');
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it('still rejects malformed receiving-account evidence and logs only its safe type',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,referenceNumber:input.reference,receiverAccount:null,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'INCOMPLETE_EVIDENCE',invalidFields:[{field:'data.0.receiverAccount',issue:'invalid_type',received:'null'}]});
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it('does not log exception contents on timeout',async()=>{vi.stubEnv('VERIFY_ET_API_KEY','private-key');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('sensitive-url','TimeoutError')));const log=vi.spyOn(console,'warn').mockImplementation(()=>{});expect(await submitVerify(input)).toMatchObject({code:'PROVIDER_OUTAGE',matched:false});expect(log.mock.calls[0][0]).not.toContain('sensitive-url')});
});
