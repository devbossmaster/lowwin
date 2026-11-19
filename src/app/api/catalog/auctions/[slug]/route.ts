import { getAuction } from '@/modules/auctions/catalog';
import {catalogProductPreview} from '@/lib/catalog-preview';
import {requireUser,privateError,privateHeaders} from '@/modules/auth/private-api';
export async function GET(request: Request, {params}:{params:Promise<{slug:string}>}) {
 try{await requireUser(request)}catch(error){return privateError(error)}
 try{
  const {slug}=await params;
  const auction=await getAuction(slug);
  return auction?Response.json(catalogProductPreview(auction),{headers:privateHeaders}):Response.json({error:'Auction not found'},{status:404,headers:privateHeaders});
 }catch{return Response.json({error:'This auction is temporarily unavailable.'},{status:503,headers:{...privateHeaders,'Retry-After':'5'}})}
}
