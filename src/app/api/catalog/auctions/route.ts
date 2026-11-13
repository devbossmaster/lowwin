import { catalogQuerySchema, getAuctionSummary, listAuctions,listQuickAuctions } from '@/modules/auctions/catalog';
import {catalogProductPreview} from '@/lib/catalog-preview';
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = catalogQuerySchema.safeParse({...params,...(params.view==='home'&&params.sort===undefined?{sort:'featured'}:{})});
  if (!parsed.success || (params.view==='quick' && params.status!==undefined && !['live','upcoming'].includes(params.status))) return Response.json({error:'Invalid catalog query'}, {status:400,headers:{'Cache-Control':'no-store'}});
  try {
    if(params.view==='summary')return Response.json(await getAuctionSummary(),{headers:{'Cache-Control':'no-store'}});
    if(params.view==='quick')return Response.json(await listQuickAuctions(params.status==='upcoming'?'upcoming':'live',parsed.data.page),{headers:{'Cache-Control':'no-store'}});
    const data=params.view==='home'?await listAuctions({...parsed.data,status:'live'},undefined,10):params.view==='browse'?await listAuctions(parsed.data,undefined,10):await listAuctions(parsed.data);
    return Response.json({...data,items:data.items.map(catalogProductPreview)},{headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'Auctions are temporarily unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
  }
}
