import { catalogQuerySchema, listAuctions } from '@/modules/auctions/catalog';
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = catalogQuerySchema.safeParse(params);
  if (!parsed.success) return Response.json({error:'Invalid catalog query'}, {status:400});
  return Response.json(await listAuctions(parsed.data), {headers:{'Cache-Control':'no-store'}});
}
