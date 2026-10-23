import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {databaseErrorSummary} from '../src/lib/database-error';

type RoleRow={
  rolname:string;
  rolcanlogin:boolean;
  rolsuper:boolean;
  rolcreatedb:boolean;
  rolcreaterole:boolean;
  rolreplication:boolean;
  rolbypassrls:boolean;
};

type RuntimeLoginStage='group-read'|'login-read'|'create-or-rotate'|'grant-runtime'|'verify';
let stage:RuntimeLoginStage='group-read';
let db:PrismaClient|undefined;
let failed=false;
function reportFailure(error:unknown) {
  if(!failed)console.error(JSON.stringify({event:'runtime_login_failed',stage,...databaseErrorSummary(error)}));
  failed=true;
  process.exitCode=1;
}
try {
  const adminUrl=process.env.MIGRATION_DIRECT_URL?.trim();
  const password=process.env.LOWWIN_APP_PASSWORD?.trim();
  if(!adminUrl)throw new Error('MIGRATION_DIRECT_URL is required for this one-time command.');
  if(!password||!/^[A-Za-z0-9_-]{43,128}$/.test(password)) {
    throw new Error('LOWWIN_APP_PASSWORD must be 43-128 URL-safe base64 characters.');
  }
  const parsed=new URL(adminUrl);
  if(!['postgres:','postgresql:'].includes(parsed.protocol))throw new Error('MIGRATION_DIRECT_URL must be a PostgreSQL URL.');
  if(parsed.port==='6543')throw new Error('Use the direct or session migration endpoint, not transaction port 6543.');

  db=new PrismaClient({datasourceUrl:adminUrl});
  const groups=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname::text AS rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_runtime',
  );
  const group=groups[0];
  if(!group||group.rolcanlogin||group.rolsuper||group.rolcreatedb||group.rolcreaterole||group.rolreplication||group.rolbypassrls) {
    throw new Error('lowwin_runtime is missing or unsafe; apply deploy/runtime-role.sql first.');
  }

  stage='login-read';
  const existing=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname::text AS rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_app',
  );
  if(existing[0]&&(existing[0].rolsuper||existing[0].rolcreatedb||existing[0].rolcreaterole||existing[0].rolreplication||existing[0].rolbypassrls)) {
    throw new Error('Existing lowwin_app has unsafe privileges; inspect it before changing credentials.');
  }

  // Role DDL does not accept a bind parameter for PASSWORD. The strict
  // base64url validation above excludes SQL delimiters before interpolation.
  // The existing role's privilege flags were validated above. Credential
  // rotation changes only login, inheritance and password; first creation
  // retains every explicit privilege restriction.
  const statement=existing[0]
    ? `ALTER ROLE "lowwin_app" WITH LOGIN INHERIT PASSWORD '${password}'`
    : `CREATE ROLE "lowwin_app" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`;
  stage='create-or-rotate';
  await db.$executeRawUnsafe(statement);
  stage='grant-runtime';
  await db.$executeRawUnsafe('GRANT "lowwin_runtime" TO "lowwin_app"');

  stage='verify';
  const verified=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname::text AS rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_app',
  );
  const role=verified[0];
  if(!role||!role.rolcanlogin||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls) {
    throw new Error('lowwin_app verification failed.');
  }
  console.log(JSON.stringify({role:'lowwin_app',login:true,superuser:false,bypassRls:false,runtimeMembership:true}));
} catch(error) {
  reportFailure(error);
} finally {
  try {await db?.$disconnect();} catch(error) {reportFailure(error);}
}
