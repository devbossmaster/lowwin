import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {chapaPaymentAlertRecipient} from '../src/modules/notifications/chapa-receipt';

const username=process.argv[process.argv.indexOf('--username')+1]?.replace(/^@/,'');
if(!process.argv.includes('--username')||!username||!/^\w{5,32}$/.test(username))throw Error('Usage: npx --no-install tsx scripts/check-chapa-payment-alert.ts --username <Telegram username>');
const db=new PrismaClient();
try{
 const users=await db.user.findMany({where:{telegramUsername:{equals:username,mode:'insensitive'}},take:2,select:{telegramId:true,telegramUsername:true}});
 if(users.length!==1||!users[0].telegramId)console.log(JSON.stringify({ready:false,reason:'UNIQUE_TELEGRAM_ACCOUNT_NOT_FOUND'}));
 else{
  const user=users[0],chat=await db.botChat.findUnique({where:{telegramId:user.telegramId!},select:{chatId:true,blocked:true}});
  console.log(JSON.stringify({username:user.telegramUsername,telegramId:user.telegramId,startedBot:!!chat,blocked:chat?.blocked??false,privateChat:chat?.chatId===user.telegramId,configured:chapaPaymentAlertRecipient()===user.telegramId},null,2));
 }
}catch{console.log(JSON.stringify({ready:false,reason:'DATABASE_LOOKUP_UNAVAILABLE'}));process.exitCode=1}
finally{await db.$disconnect()}
