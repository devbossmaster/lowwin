import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {reissueInitialOwner} from '../src/modules/admin/bootstrap';
const db=new PrismaClient();
try{
  const args=process.argv.slice(2),emailIndex=args.indexOf('--email');
  const email=emailIndex>=0?args[emailIndex+1]:undefined;
  if(emailIndex>=0&&!email)throw new Error('Use --email owner@example.com');
  const reason=(emailIndex>=0?args.filter((_value,index)=>index!==emailIndex&&index!==emailIndex+1):args).join(' ');
  await reissueInitialOwner(db,reason,email);
  console.log('Replacement invitation delivered. The old token is revoked.');
}catch(error){
  // Recovery errors contain no invitation token or secret. Showing the precise
  // reason prevents operators from guessing between eligibility and email setup.
  console.error(error instanceof Error?error.message:'Recovery unavailable.');
  process.exitCode=1;
}finally{await db.$disconnect()}
