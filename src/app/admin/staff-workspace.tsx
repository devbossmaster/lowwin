import {createHash} from 'node:crypto';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {AdminShell} from '@/components/admin-shell';
import {StaffLogin} from '@/components/staff-login';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {permissions} from '@/modules/admin/permissions';

export async function StaffWorkspace({children,signIn=false}:{children:React.ReactNode;signIn?:boolean}){
  let actor;
  try {
    actor=await requireAdmin(db,new Headers(await headers()));
  } catch(error) {
    if(error instanceof AdminError&&error.code==='ADMIN_LOGIN_REQUIRED'){
      if(signIn)return <StaffLogin accessError={error.status===403?error.message:undefined}/>;
      redirect('/admin');
    }
    return <main id="main" className="admin-access master-admin-auth">
      <section className="admin-access-form">
        <h1>Admin workspace unavailable</h1>
        <p role="alert">The connection was interrupted. Try again in a moment.</p>
        <a className="admin-button secondary" href="/admin">Try again</a>
      </section>
    </main>;
  }
  const grants=permissions(actor.role);
  const cacheIdentity=createHash('sha256').update(JSON.stringify([actor.id,actor.sessionId,actor.role,grants])).digest('hex');
  return <AdminShell access={{role:actor.role,permissions:grants,cacheIdentity,expiresAt:actor.expiresAt.toISOString()}}>{children}</AdminShell>;
}
