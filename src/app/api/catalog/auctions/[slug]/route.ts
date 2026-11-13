import { getAuction } from '@/modules/auctions/catalog';
import {catalogProductPreview} from '@/lib/catalog-preview';
export async function GET(request: Request, {params}:{params:Promise<{slug:string}>}) {
 try{
  const {slug}=await params;
  const auction=await getAuction(slug);
  return auction?Response.json(catalogProductPreview(auction),{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Auction not found'},{status:404,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'This auction is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}})}
}
