import 'dotenv/config';
import {PrismaClient} from '@prisma/client';

type RoleRow={
  rolname:string;
  rolcanlogin:boolean;
  rolsuper:boolean;
  rolcreatedb:boolean;
  rolcreaterole:boolean;
  rolreplication:boolean;
  rolbypassrls:boolean;
};

const adminUrl=process.env.MIGRATION_DIRECT_URL?.trim();
const password=process.env.LOWWIN_APP_PASSWORD?.trim();
if(!adminUrl)throw new Error('MIGRATION_DIRECT_URL is required for this one-time command.');
if(!password||!/^[A-Za-z0-9_-]{43,128}$/.test(password)) {
  throw new Error('LOWWIN_APP_PASSWORD must be 43-128 URL-safe base64 characters.');
}
const parsed=new URL(adminUrl);
if(!['postgres:','postgresql:'].includes(parsed.protocol))throw new Error('MIGRATION_DIRECT_URL must be a PostgreSQL URL.');
if(parsed.port==='6543')throw new Error('Use the direct or session migration endpoint, not transaction port 6543.');

const db=new PrismaClient({datasourceUrl:adminUrl});
try {
  const groups=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_runtime',
  );
  const group=groups[0];
  if(!group||group.rolcanlogin||group.rolsuper||group.rolcreatedb||group.rolcreaterole||group.rolreplication||group.rolbypassrls) {
    throw new Error('lowwin_runtime is missing or unsafe; apply deploy/runtime-role.sql first.');
  }

  const existing=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_app',
  );
  if(existing[0]&&(existing[0].rolsuper||existing[0].rolcreatedb||existing[0].rolcreaterole||existing[0].rolreplication||existing[0].rolbypassrls)) {
    throw new Error('Existing lowwin_app has unsafe privileges; inspect it before changing credentials.');
  }

  // Role DDL does not accept a bind parameter for PASSWORD. The strict
  // base64url validation above excludes SQL delimiters before interpolation.
  const action=existing[0]?'ALTER ROLE':'CREATE ROLE';
  await db.$executeRawUnsafe(
    `${action} "lowwin_app" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await db.$executeRawUnsafe('GRANT "lowwin_runtime" TO "lowwin_app"');

  const verified=await db.$queryRawUnsafe<RoleRow[]>(
    'SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
    'lowwin_app',
  );
  const role=verified[0];
  if(!role||!role.rolcanlogin||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls) {
    throw new Error('lowwin_app verification failed.');
  }
  console.log(JSON.stringify({role:'lowwin_app',login:true,superuser:false,bypassRls:false,runtimeMembership:true}));
} finally {
  await db.$disconnect();
}
