import {AdminCatalog} from '@/components/admin-catalog';
import {redirect} from 'next/navigation';
import {AdminBusinessSummary} from '@/components/admin-reports';
import {AdminAuctionList} from '@/components/admin-auction-list';
import {AdminOverview} from '@/components/admin-overview';
import {AdminPayments} from '@/components/admin-payments';
import {headers} from 'next/headers';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {sectionPermission} from '@/modules/admin/ops';
import {AdminWorkspace} from '@/components/admin-workspace';
import {AdminOperations,AdminProof} from '@/components/admin-operations';
export default async function AdminPage({params}:{params:Promise<{section?:string[]}>}){const path=(await params).section??[],permission=sectionPermission[path[0]]??(path[0]==='reconciliation'||path[2]==='proof'?'audit':path[0]?'catalog':undefined);try{const actor=await requireAdmin(db,new Headers(await headers()),path[0]==='top-ups'?{}:{permission});if(path[0]==='top-ups'&&(!['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'].includes(actor.role)||path[1]==='statements'&&actor.role==='SUPPORT'))throw Error('Denied')}catch{return <section><h1>Access unavailable</h1><p>Your current staff role does not grant access to this page. Contact the Owner.</p></section>}if(path[0]==='content')redirect('/admin/auctions');if(path[0]==='wallets'||path[0]==='reconciliation'||path[0]==='top-ups'&&path[1]==='statements')redirect('/admin/top-ups');return path[0]==='products'||path[0]==='categories'?<AdminCatalog section={path[0]}/>:path[0]==='analytics'?<AdminBusinessSummary/>:!path[0]?<AdminOverview/>:path[0]==='auctions'&&!path[1]?<AdminAuctionList/>:path[0]==='top-ups'||path[0]==='settings'&&path[1]==='payments'?<AdminPayments path={path}/>:path[0]==='auctions'&&path[2]==='proof'?<AdminProof auctionId={path[1]}/>:sectionPermission[path[0]]?<AdminOperations path={path}/>:<AdminWorkspace path={path}/>}
