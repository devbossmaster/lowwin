import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {AdminShell} from '@/components/admin-shell';
export default async function SecureAdmin({children}:{children:React.ReactNode}){
  try{await requireAdmin(db,new Headers(await headers()))}catch{redirect('/admin/login')}
  return <AdminShell>{children}</AdminShell>;
}
