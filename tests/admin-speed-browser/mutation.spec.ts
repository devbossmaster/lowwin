import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';

test('isolated suspension updates its row without reloading unrelated admin areas',async({page})=>{
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database);
 if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable database required');
 const db=new PrismaClient({datasourceUrl:database}),id=randomUUID(),playerId=randomUUID(),email=`mutation-${id}@lowwin.test`,password='Isolated-mutation-password-12345';
 await db.user.create({data:{id,email,name:'Synthetic mutation reviewer',emailVerified:true,role:'admin'}});
 await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(password)}});
 await db.user.create({data:{id:playerId,name:`Synthetic mutation ${playerId}`,email:`player-${playerId}@lowwin.test`,telegramId:String(BigInt('880000000000')+BigInt('0x'+playerId.replaceAll('-','').slice(0,8)))}});
 const reads:string[]=[],writes:string[]=[];
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/admin/'))(r.method()==='GET'?reads:writes).push(u.pathname+u.search)});
 await page.route(/^https:\/\/(?:api\.telegram\.org|api\.chapa\.global|api\.resend\.com)\//,r=>r.abort());
 try{
  await page.goto('/admin/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await page.goto('/admin/users?q='+playerId);const table=page.getByRole('region',{name:'Players and wallets'});await expect(table).toContainText(playerId);await table.getByRole('button',{name:'Details',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'Player details',exact:true});await drawer.getByLabel('Reason').fill('Isolated speed regression fixture');
  const before=reads.length,start=performance.now();await drawer.getByRole('button',{name:'Suspend bidding',exact:true}).click();await expect(drawer).not.toBeVisible();await expect(table).toContainText('Suspended');const mutationMs=performance.now()-start;
  await expect(table).not.toContainText('Loading players');expect(writes).toHaveLength(1);expect(reads.slice(before).every(path=>path.startsWith('/api/admin/workspace/players')||path.startsWith('/api/admin/users/'))).toBe(true);
  mkdirSync('test-results/admin-speed',{recursive:true});writeFileSync('test-results/admin-speed/mutation.json',JSON.stringify({fixture:'disposable loopback suspension; no money or Telegram sends',mutationMs,posts:writes.length,refreshReads:reads.slice(before),tableStayedVisible:true},null,2));
 }finally{await db.$disconnect()}
});
