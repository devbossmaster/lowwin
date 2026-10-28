import {notFound} from 'next/navigation';
import {AdminWorkspace} from '@/components/admin-workspace';
import {AdminProof} from '@/components/admin-operations';
// The shared secure layout authorizes every page. Each data/command endpoint
// rechecks the live database role; this selector performs no duplicate lookup.
export default async function Page({params}:{params:Promise<{section:string[]}>}){
 const path=(await params).section;
 if(path[0]!=='auctions'||!path[1]||path.length>3)notFound();
 if(path.length===3){if(path[2]!=='proof')notFound();return <AdminProof auctionId={path[1]}/>}
 return <AdminWorkspace path={path}/>;
}
