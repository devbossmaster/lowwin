import {permissions} from '@/modules/admin/permissions';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {AdminShell} from '@/components/admin-shell';
import {createHash} from 'node:crypto';
export default async function SecureAdmin({children}:{children:React.ReactNode}){
  let actor;try{actor=await requireAdmin(db,new Headers(await headers()))}catch{redirect('/admin/login')}
  const cacheIdentity=createHash('sha256').update(JSON.stringify([actor.id,actor.sessionId,actor.role,permissions(actor.role)])).digest('hex');
  return <AdminShell access={{role:actor.role,permissions:permissions(actor.role),cacheIdentity,expiresAt:actor.expiresAt.toISOString()}}>{children}</AdminShell>;
}
