import { catalogQuerySchema, getAuctionSummary, listAuctions,listQuickAuctions } from '@/modules/auctions/catalog';
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = catalogQuerySchema.safeParse(params);
  if (!parsed.success || (params.view==='quick' && params.status!==undefined && !['live','upcoming'].includes(params.status))) return Response.json({error:'Invalid catalog query'}, {status:400,headers:{'Cache-Control':'no-store'}});
  try {
    return Response.json(params.view==='summary'?await getAuctionSummary():params.view==='quick'?await listQuickAuctions(params.status==='upcoming'?'upcoming':'live',parsed.data.page):params.view==='home'?await listAuctions({...parsed.data,status:'live'},undefined,10):await listAuctions(parsed.data), {headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'Auctions are temporarily unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
  }
}
