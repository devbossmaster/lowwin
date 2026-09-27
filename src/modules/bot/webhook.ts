import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import {contactBotId,protectContactPayload} from '../auth/own-contact';
export function validWebhookSecret(received: string | null, expected: string) {
  if (!received) return false;
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
export async function receiveUpdate(request: Request, client: PrismaClient, secret: string) {
  if (!validWebhookSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), secret)) return new Response(null, { status: 403 });
  const text = await request.text();
  if (text.length > 262144) return new Response(null, { status: 413 });
  let payload;
  try { payload = z.object({ update_id: z.number().int().nonnegative().safe() }).passthrough().parse(JSON.parse(text)); }
  catch { return new Response(null, { status: 400 }); }
  const botId=contactBotId();
  const protectedPayload=protectContactPayload(payload,botId);
  await client.botUpdate.createMany({ data: [{ updateId: BigInt(payload.update_id),botId, payload: protectedPayload as Prisma.InputJsonValue }], skipDuplicates: true });
  return Response.json({ ok: true });
}
