import {AdminReferralPolicy} from '@/components/admin-referral-policy';

// SecureAdmin supplies the verified staff session; every policy read/write also
// requires current settings authorization at /api/admin/referrals.
export default function Page(){return <AdminReferralPolicy/>}
