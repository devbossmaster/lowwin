import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {Bot} from 'grammy';
import {scheduleAlerts,dispatchOne} from '../src/modules/notifications/service';
const db=new PrismaClient(),bot=new Bot(process.env.TELEGRAM_BOT_TOKEN!,{client:{timeoutSeconds:15}});
let running=true;process.on('SIGINT',()=>running=false);process.on('SIGTERM',()=>running=false);
try{while(running){try{await scheduleAlerts(db);await db.fulfillmentCase.updateMany({where:{contactDeleteAt:{lte:new Date()},contactCipher:{not:null}},data:{contactCipher:null}});if(!await dispatchOne(db,bot))await new Promise(r=>setTimeout(r,1000))}catch{console.error('Notification worker retry; inspect the private jobs queue.');await new Promise(r=>setTimeout(r,5000))}}}finally{await db.$disconnect()}
