import { getAuction } from '@/modules/auctions/catalog';
export async function GET(_request: Request, {params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const auction=await getAuction(slug);
  return auction?Response.json(auction,{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Auction not found'},{status:404});
}
