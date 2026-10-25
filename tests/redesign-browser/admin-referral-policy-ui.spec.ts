import {test,expect,type BrowserContext} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {digest,token,totp} from '../../src/modules/admin/crypto';
import {reconcile} from '../../src/modules/wallet/ledger';
import {referralBrowserFixture} from '../referral-browser-fixtures';

test('Owner referral policy uses fresh MFA, bounded values and explicit enablement',async({page,browser},info)=>{
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database),origin=process.env.BETTER_AUTH_URL??'';
 if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test')||process.env.REFERRAL_REWARDS_SCHEMA_READY!=='true'||new URL(origin).hostname!=='localhost')throw Error('Pinned migrated loopback referral _test database required');
 const db=new PrismaClient({datasourceUrl:database}),root=process.env.ADMIN_REFERRAL_REPORT_DIR??'test-results/profile-referrals';mkdirSync(root,{recursive:true});
 const email=`referral-policy-${randomUUID()}@lowwin.test`,password='Isolated-referral-policy-browser-fixture-12345',invitation=token(),errors:string[]=[],financialPosts:string[]=[],policyPosts:Array<{key:string;enabled:boolean;discountPercent:number;expiryDays:number}>=[];
 await referralBrowserFixture(db);
 // Keep a separate active Owner so testing the authenticated actor's Auditor
 // permissions does not violate the database's last-active-Owner safeguard.
 await db.user.create({data:{id:randomUUID(),name:'Isolated ownership guard fixture',staffMember:{create:{role:'OWNER',recoveryHashes:[]}}}});
 const initial=await db.referralPolicy.findUniqueOrThrow({where:{id:'default'}}),couponsBefore=await db.referralCoupon.findMany({orderBy:{id:'asc'},select:{id:true,percent:true,expiresAt:true,policyVersion:true}}),redemptionsBefore=await db.referralRedemption.count();
 expect(couponsBefore.length).toBeGreaterThan(0);
 let ownerId:string|null=null,policyChanged=false;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(path))financialPosts.push(path);if(request.method()==='POST'&&path==='/api/admin/referrals')policyPosts.push(request.postDataJSON().input)});
 const post=async(context:BrowserContext,path:string,body:unknown)=>context.request.post(path,{headers:{origin},data:body});
 const save=async(percent:number,days:number,enabled:boolean,reason:string)=>{
  await page.locator('input[name="discountPercent"]').fill(String(percent));await page.locator('input[name="expiryDays"]').fill(String(days));await page.getByRole('checkbox',{name:/Allow new referral rewards/}).setChecked(enabled);await page.getByRole('textbox',{name:'Reason for change',exact:true}).fill(reason);
  const response=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/admin/referrals'&&result.request().method()==='POST');await page.getByRole('button',{name:'Save reward settings',exact:true}).click();const result=await response;expect(result.status()).toBe(200);expect(result.headers()['cache-control']).toContain('private, no-store');const receipt=await result.json();expect(receipt).toMatchObject({discountPercent:percent,expiryDays:days,enabled});await expect(page.getByText(`Saved: ${percent}% discount, valid for ${days} days. New rewards are ${enabled?'enabled':'paused'}.`,{exact:true})).toBeVisible();await expect(page.getByText(new RegExp(`^Version ${receipt.version} · Updated `))).toBeVisible();policyChanged=true;return receipt;
 };
 try{
  // Fixture provisioning is local-only. Actual credential/MFA endpoints issue
  // the staff cookie; no test-only browser headers or email transport are used.
  const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  await db.staffToken.create({data:{tokenHash:digest(invitation),kind:'INVITE',email,role:'OWNER',expiresAt:new Date(now.getTime()+3600000)}});
  const accepted=await post(page.context(),'/api/auth/lowin/staff/accept-invite',{token:invitation,password});expect(accepted.status()).toBe(200);expect(await accepted.json()).toMatchObject({mode:'enroll'});ownerId=(await db.user.findUniqueOrThrow({where:{email}})).id;
  const enrollment=await post(page.context(),'/api/auth/lowin/staff/enroll',{});expect(enrollment.status()).toBe(200);const {secret}=await enrollment.json();expect(typeof secret).toBe('string');
  const [{now:mfaNow}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const verified=await post(page.context(),'/api/auth/lowin/staff/mfa',{code:totp(secret,BigInt(Math.floor(mfaNow.getTime()/30000)))});expect(verified.status()).toBe(200);expect(await verified.json()).toMatchObject({mode:'authenticated'});
  await page.goto('/admin/settings/referrals');await expect(page.getByRole('heading',{name:'Referral rewards',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Reward settings',exact:true})).toBeVisible();
  const percent=page.locator('input[name="discountPercent"]'),days=page.locator('input[name="expiryDays"]'),enabled=page.getByRole('checkbox',{name:/Allow new referral rewards/});
  await expect(percent).toHaveAttribute('min','5');await expect(percent).toHaveAttribute('max','15');await expect(days).toHaveAttribute('min','15');await expect(days).toHaveAttribute('max','30');
  const beforeResponse=await page.request.get('/api/admin/settings');expect(beforeResponse.status()).toBe(200);const settingsBefore=await beforeResponse.json();expect(typeof settingsBefore.payments).toBe('string');
  await percent.fill('4');expect(await percent.evaluate((input:HTMLInputElement)=>input.checkValidity())).toBe(false);await days.fill('31');expect(await days.evaluate((input:HTMLInputElement)=>input.checkValidity())).toBe(false);
  const invalid=await post(page.context(),'/api/admin/referrals',{action:'save-policy',input:{key:randomUUID(),version:initial.version,discountPercent:16,expiryDays:31,enabled:true,reason:'Invalid range must not be saved'}});expect(invalid.status()).toBe(422);
  await percent.fill('5');await days.fill('15');await enabled.uncheck();await page.getByRole('textbox',{name:'Reason for change',exact:true}).fill('Browser proof of paused lower policy bounds');
  const grant=await db.staffSession.findFirstOrThrow({where:{session:{userId:ownerId}},orderBy:{expiresAt:'desc'}});await db.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:new Date(now.getTime()-46*60000),mfaAt:new Date(now.getTime()-45*60000)}});
  const denied=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/referrals'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save reward settings',exact:true}).click();expect((await denied).status()).toBe(403);await expect(page.getByRole('alert').filter({hasText:'Fresh MFA is required.'})).toBeVisible();const failedKey=policyPosts.at(-1)!.key;
  const member=await db.staffMember.findUniqueOrThrow({where:{userId:ownerId}}),[{now:stepNow}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`,counter=BigInt(Math.floor(stepNow.getTime()/30000)),next=member.lastCounter>=counter?member.lastCounter+1n:counter;
  const mfa=page.getByRole('region',{name:'Authenticator verification',exact:true});await mfa.getByRole('textbox',{name:'Fresh authenticator code',exact:true}).fill(totp(secret,next));await mfa.getByRole('button',{name:'Confirm code',exact:true}).click();await expect(mfa.getByRole('status')).toContainText('Verified');
  const retry=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/referrals'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save reward settings',exact:true}).click();const retried=await retry;expect(retried.status()).toBe(200);const first=await retried.json();policyChanged=true;expect(policyPosts.at(-1)!.key).toBe(failedKey);expect(first).toMatchObject({discountPercent:5,expiryDays:15,enabled:false});await expect(page.getByText(new RegExp(`^Version ${first.version} · Updated `))).toBeVisible();
  await save(10,20,false,'Browser proof that value edits stay paused');await expect(enabled).not.toBeChecked();
  await save(15,30,true,'Browser proof of explicit referral enablement');await expect(enabled).toBeChecked();await expect(page.getByText('New rewards enabled',{exact:true})).toBeVisible();
  expect(await db.referralPolicy.findUniqueOrThrow({where:{id:'default'}})).toMatchObject({discountPercent:15,expiryDays:30,enabled:true,updatedBy:ownerId});expect(await db.adminAudit.count({where:{actorId:ownerId,action:'REFERRAL_POLICY_UPDATED'}})).toBe(3);
  expect(await db.referralCoupon.findMany({orderBy:{id:'asc'},select:{id:true,percent:true,expiresAt:true,policyVersion:true}})).toEqual(couponsBefore);expect(await db.referralRedemption.count()).toBe(redemptionsBefore);expect(await reconcile(db)).toEqual([]);const afterResponse=await page.request.get('/api/admin/settings');expect(afterResponse.status()).toBe(200);expect((await afterResponse.json()).payments).toBe(settingsBefore.payments);
  await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'})});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${root}/admin-referral-policy-${info.project.name}.png`,fullPage:true});
  const anonymous=await browser.newContext({baseURL:origin});expect((await anonymous.request.get('/api/admin/referrals')).status()).toBe(401);await anonymous.close();
  await db.staffMember.update({where:{userId:ownerId},data:{role:'AUDITOR'}});expect((await page.request.get('/api/admin/referrals')).status()).toBe(403);await page.reload();await expect(page.getByRole('heading',{name:'Access unavailable',exact:true})).toBeVisible();
  expect(financialPosts).toEqual([]);expect(errors).toEqual([]);writeFileSync(`${root}/admin-referral-policy-${info.project.name}.json`,JSON.stringify({viewport:info.project.use.viewport,fixture:'isolated credential-and-MFA Owner',freshMfaDenied:true,realStepUp:true,sameRetryKey:true,invalidBoundsRejected:true,updates:[{percent:5,days:15,enabled:false},{percent:10,days:20,enabled:false},{percent:15,days:30,enabled:true}],policyAudits:3,existingCouponsUnchanged:true,reconciliationDiscrepancies:0,paymentConfigurationUnchanged:true,anonymousStatus:401,auditorStatus:403,noHorizontalOverflow:true,financialPosts:0,errors},null,2)+'\n');
 }finally{try{
  if(ownerId){await db.staffMember.update({where:{userId:ownerId},data:{role:'OWNER'}});if(policyChanged){const response=await page.request.get('/api/admin/referrals');if(response.ok()){const data=await response.json();const restored=await post(page.context(),'/api/admin/referrals',{action:'save-policy',input:{key:randomUUID(),version:data.policy.version,discountPercent:initial.discountPercent,expiryDays:initial.expiryDays,enabled:initial.enabled,reason:'Restore isolated browser fixture reward policy'}});expect(restored.status()).toBe(200)}}await post(page.context(),'/api/auth/lowin/staff/logout',{})}
 }finally{await db.$disconnect()}
 }
});
