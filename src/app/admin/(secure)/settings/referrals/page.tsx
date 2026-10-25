import {headers} from 'next/headers';
import {db} from '@/lib/db';
import {requireAdmin} from '@/modules/admin/boundary';
import {AdminError} from '@/modules/admin/errors';
import {AdminReferralPolicy} from '@/components/admin-referral-policy';

export default async function ReferralSettings(){
 try{await requireAdmin(db,new Headers(await headers()),{permission:'settings'})}
 catch(error){if(!(error instanceof AdminError))throw error;return <section><h1>Access unavailable</h1><p>Your current staff role does not grant access to referral settings. Contact the Owner.</p></section>}
 return <AdminReferralPolicy/>;
}
