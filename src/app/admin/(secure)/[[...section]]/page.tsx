import {AdminCatalog} from '@/components/admin-catalog';
import {notFound,redirect} from 'next/navigation';
import {AdminAuctionList} from '@/components/admin-auction-list';
import {AdminOverview} from '@/components/admin-overview';
import {AdminArifPay} from '@/components/admin-arifpay';
import {AdminPayments} from '@/components/admin-payments';
import {AdminRecords,AdminSystem,AdminFinancials} from '@/components/admin-neutral-workspace';
import {AdminContent} from '@/components/admin-content';
import {AdminBalanceChecks} from '@/components/admin-reports';
import {headers} from 'next/headers';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {sectionPermission} from '@/modules/admin/ops';
import {AdminWorkspace} from '@/components/admin-workspace';
import {AdminOperations,AdminProof} from '@/components/admin-operations';
import type {Permission} from '@/modules/admin/permissions';
export default async function AdminPage({params}:{params:Promise<{section?:string[]}>}){
 const path=(await params).section??[],section=path[0];if(section==='support')notFound();
 const overrides:Record<string,Permission>={media:'catalog',content:'catalog',referrals:'wallets',refunds:'wallets'};
 const permission=overrides[section]??sectionPermission[section]??(section==='reconciliation'||path[2]==='proof'?'audit':section?'catalog':undefined);
 try{const actor=await requireAdmin(db,new Headers(await headers()),['top-ups','payments'].includes(section)?{}:{permission});if(['top-ups','payments'].includes(section)&&(!['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'].includes(actor.role)||path[1]==='statements'&&actor.role==='SUPPORT'))throw Error('Denied')}catch{return <section><h1>Access unavailable</h1><p>Your current staff role does not grant access to this page. Contact the Owner.</p></section>}
 if(section==='top-ups'&&path[1]==='statements')redirect('/admin/top-ups');
 if(section==='reconciliation')return <AdminBalanceChecks/>;
 if(section==='payments')return path[1]?<AdminArifPay id={path[1]}/>:<AdminRecords section="transactions"/>;
 if(section==='refunds'||section==='media'||section==='referrals')return <AdminRecords section={section}/>;
 if(section==='products'||section==='categories')return <AdminCatalog section={section}/>;
 if(section==='analytics')return <AdminFinancials/>;
 if(section==='content')return <AdminContent/>;
 if(section==='settings'&&!path[1])return <AdminSystem/>;
 if(!section)return <AdminOverview/>;
 if(section==='auctions'&&!path[1])return <AdminAuctionList/>;
 if(section==='top-ups'||section==='settings'&&path[1]==='payments')return <AdminPayments path={path}/>;
 if(section==='auctions'&&path[2]==='proof')return <AdminProof auctionId={path[1]}/>;
 return sectionPermission[section]?<AdminOperations path={path}/>:<AdminWorkspace path={path}/>;
}
