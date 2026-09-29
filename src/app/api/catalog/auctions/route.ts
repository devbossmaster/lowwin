import { catalogQuerySchema, listAuctions,listQuickLiveAuctions } from '@/modules/auctions/catalog';
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = catalogQuerySchema.safeParse(params);
  if (!parsed.success) return Response.json({error:'Invalid catalog query'}, {status:400});
  try {
    return Response.json(params.view==='quick'?await listQuickLiveAuctions(parsed.data.page):await listAuctions(parsed.data), {headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'Auctions are temporarily unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
  }
}
