import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const miniAppBody = z.object({ initData: z.string().min(1).max(16384) }).strict();
const userSchema = z.object({ id: z.number().int().positive().safe(), first_name: z.string().min(1).max(256) });
export function validateTelegramInitData(raw: string, botToken: string, now = Math.floor(Date.now() / 1000)) {
  if (!raw || raw.length > 16384) throw new Error('Missing launch data');
  const params = new URLSearchParams(raw);
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new Error('Duplicate launch fields');
  const hash = params.get('hash');
  const date = params.get('auth_date');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !date || !/^\d+$/.test(date)) throw new Error('Invalid launch data');
  const timestamp = Number(date);
  if (!Number.isSafeInteger(timestamp) || timestamp > now + 30 || now - timestamp > 300) throw new Error('Launch expired');
  params.delete('hash');
  const check = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', key).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('Invalid launch signature');
  return userSchema.parse(JSON.parse(params.get('user') ?? 'null'));
}
