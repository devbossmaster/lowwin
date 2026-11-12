import type {PrismaClient} from '@prisma/client';
import {referralSchemaReady} from './service';

export type OwnCouponCount={configured:boolean;available:number|null};

/** Lightweight account projection. Redemption still checks expiry and ownership
 * in the financial transaction; this count never authorizes a discount. */
export async function getOwnCouponCount(client:Pick<PrismaClient,'$queryRaw'>,userId:string,raw:Record<string,string|undefined>=process.env):Promise<OwnCouponCount>{
 if(!referralSchemaReady(raw))return {configured:false,available:null};
 const rows=await client.$queryRaw<Array<{count:number}>>`
  SELECT count(c.id)::int AS count FROM "ReferralPolicy" p
  LEFT JOIN "ReferralCoupon" c ON c."ownerUserId"=${userId}
   AND c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
   AND NOT EXISTS(SELECT 1 FROM "ReferralRedemption" r WHERE r."couponId"=c.id)
  WHERE p.id='default' GROUP BY p.id`;
 return {configured:rows.length>0,available:rows[0]?.count??null};
}
