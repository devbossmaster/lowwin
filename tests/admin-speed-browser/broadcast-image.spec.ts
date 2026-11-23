import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';

test('broadcast previews a portrait and requires removal or replacement of rejected images',async({page})=>{
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database);
 if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable database required');
 const db=new PrismaClient({datasourceUrl:database}),id=randomUUID();
 const email=`broadcast-photo-${id}@lowwin.test`,password='Isolated-broadcast-photo-password-12345';
 const writes:string[]=[];
 await page.route(/^https:\/\/(?:api\.telegram\.org|api\.chapa\.global|api\.resend\.com)\//,route=>route.abort());
 await page.route('**/api/admin/command',route=>{writes.push(route.request().method());return route.abort()});
 try{
  await db.user.create({data:{id,email,name:'Synthetic broadcast editor',emailVerified:true,role:'admin'}});
  await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(password)}});
  await page.goto('/admin/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('navigation',{name:'Business areas'}).getByRole('link',{name:'Broadcast',exact:true}).click();
  const composer=page.getByRole('region',{name:'Compose broadcast'});
  const review=composer.getByRole('button',{name:'Review & send'});
  await composer.getByRole('textbox',{name:/^Message/}).fill('Synthetic broadcast');
  await composer.getByText('Image & button',{exact:true}).click();
  const attachment=composer.locator('input[type="file"]');
  const portrait=await sharp({create:{width:540,height:900,channels:3,background:'#00179e'}}).png().toBuffer();
  await attachment.setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:portrait});
  const preview=page.getByRole('img',{name:'Broadcast product preview'});
  await expect.poll(()=>preview.evaluate(img=>[(img as HTMLImageElement).naturalWidth,(img as HTMLImageElement).naturalHeight])).toEqual([540,900]);
  await expect(review).toBeEnabled();

  await attachment.setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
  await expect(composer.getByRole('alert')).toContainText('Choose a JPEG, PNG or WebP image');
  await expect(review).toBeDisabled();
  await expect(preview).toHaveCount(0);
  await composer.getByRole('button',{name:'Remove image'}).click();
  await expect(composer.getByRole('alert')).toHaveCount(0);
  await expect(review).toBeEnabled();
  await review.click();
  await expect(composer.getByRole('button',{name:'Send to players'})).toBeVisible();
  expect(writes).toEqual([]);
 }finally{await db.$disconnect()}
});
