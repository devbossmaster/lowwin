import 'dotenv/config';
import { db } from '../src/lib/db';
import { bootstrapOwner } from '../src/modules/admin/bootstrap';
try{const email=process.argv[process.argv.indexOf('--email')+1];if(!process.argv.includes('--email'))throw new Error('Use --email owner@example.com');await bootstrapOwner(db,email);console.log('Owner invitation delivered. Bootstrap is now permanently consumed. Disable ADMIN_BOOTSTRAP_ENABLED.')}catch(error){console.error(error instanceof Error?error.message:'Bootstrap failed');process.exitCode=1}finally{await db.$disconnect()}
