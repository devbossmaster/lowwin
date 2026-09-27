import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {reissueInitialOwner} from '../src/modules/admin/bootstrap';
const db=new PrismaClient();
try{await reissueInitialOwner(db,process.argv.slice(2).join(' '));console.log('Replacement invitation delivered. The old token is revoked.')}catch{console.error('Recovery unavailable. Check bootstrap eligibility and email configuration.');process.exitCode=1}finally{await db.$disconnect()}
