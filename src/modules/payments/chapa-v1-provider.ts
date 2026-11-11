import {createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {centsToEtb, etbToCents} from '@/lib/money';
import {ChapaError, ChapaProviderError, chapaHash, isChapaWebhookSecret, type ChapaCreate, type ChapaEvidence, type ChapaMode, type ChapaTransport} from './chapa-provider';

type Environment = Record<string, string | undefined>;
const origins = ['https://api.chapa.co', 'https://api.chapa.global'] as const;
const reference = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const decimal = z.union([z.string(), z.number().finite()]).transform(String)
  .refine(value => /^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value))
  .transform(value => etbToCents(value).toString());
const profiles = ['json_body', 'raw_body', 'custom_json_body', 'legacy_secret'] as const;
export type ChapaV1SignatureProfile = typeof profiles[number];

function apiOrigin(raw: Environment) { return raw.CHAPA_V1_BASE_URL ?? origins[0]; }
function secureOrigins(raw: Environment) {
  try {
    const app = new URL(raw.MINI_APP_URL ?? ''), auth = new URL(raw.BETTER_AUTH_URL ?? '');
    return app.protocol === 'https:' && app.origin === auth.origin && !app.username && !app.password && !auth.username && !auth.password;
  } catch { return false; }
}
function localDatabase(raw: Environment) {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw.DATABASE_URL ?? '').hostname); }
  catch { return false; }
}
export function chapaV1SignatureProfile(raw: Environment = process.env): ChapaV1SignatureProfile | null {
  const profile = raw.CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE ?? 'json_body';
  return profiles.includes(profile as ChapaV1SignatureProfile) ? profile as ChapaV1SignatureProfile : null;
}
export function chapaV1ConfigurationFingerprint(raw: Environment = process.env) {
  return raw.CHAPA_V1_SECRET_KEY ? chapaHash(JSON.stringify(['v1', apiOrigin(raw), raw.CHAPA_V1_SECRET_KEY])) : null;
}
export function chapaV1Availability(raw: Environment = process.env) {
  const mode: ChapaMode = raw.CHAPA_V1_MODE === 'live' ? 'live' : 'test';
  const key = raw.CHAPA_V1_SECRET_KEY ?? '';
  const validKey = (mode === 'test' ? /^CHASECK_TEST-[A-Za-z0-9_-]{16,240}$/ : /^CHASECK-[A-Za-z0-9_-]{16,240}$/).test(key)
    && !/REPLACE|CHANGE_ME|example|fixture/i.test(key);
  const testEnvironment = ['local', 'test', 'staging'].includes(raw.APP_ENV ?? '') && raw.VERCEL_ENV !== 'production'
    && (localDatabase(raw) || raw.APP_ENV === 'staging' && raw.CHAPA_V1_TEST_ENVIRONMENT_REVIEWED === 'true');
  const liveEnvironment = raw.APP_ENV === 'production' && raw.NODE_ENV === 'production'
    && !['preview', 'development'].includes(raw.VERCEL_ENV ?? '') && raw.CHAPA_V1_MERCHANT_REVIEWED === 'true'
    && !['DEV_IDENTITY_ENABLED', 'DEV_POINTS_ENABLED', 'STAGING_DEMO_ENABLED'].some(name => raw[name] === 'true');
  const configured = (!raw.CHAPA_V1_MODE || ['test', 'live'].includes(raw.CHAPA_V1_MODE))
    && raw.CHAPA_V1_SCHEMA_READY === 'true' && validKey && secureOrigins(raw)
    && origins.includes(apiOrigin(raw) as typeof origins[number]) && isChapaWebhookSecret(raw.CHAPA_V1_WEBHOOK_SECRET)
    && chapaV1SignatureProfile(raw) !== null && (mode === 'test' ? testEnvironment : liveEnvironment);
  const enabled = configured && raw.PAYMENT_GATEWAY === 'CHAPA' && raw.CHAPA_V1_ENABLED === 'true'
    && (mode === 'test' || raw.CHAPA_V1_LIVE_ENABLED === 'true');
  return {apiVersion: 1 as const, configured, enabled, recoveryEnabled: configured && (enabled || raw.CHAPA_V1_RECOVERY_ENABLED === 'true'), mode,
    currency: 'ETB' as const, credentialFingerprint: chapaV1ConfigurationFingerprint(raw),
    reason: enabled ? null : 'Chapa hosted checkout is unavailable. You can still check an existing payment.'};
}
export function requireChapaV1(operation: 'create' | 'recover' = 'create', raw: Environment = process.env) {
  const health = chapaV1Availability(raw);
  if (!(operation === 'create' ? health.enabled : health.recoveryEnabled)) throw new ChapaError(503, 'PAYMENT_UNAVAILABLE', health.reason!);
  return health;
}

const verification = z.object({status: z.enum(['success', 'pending', 'failed']), data: z.object({
  tx_ref: reference, reference: reference.nullish(), amount: decimal, currency: z.literal('ETB'),
  status: z.enum(['success', 'pending', 'failed', 'cancelled', 'failed/cancelled', 'refunded', 'reversed']),
  mode: z.enum(['test', 'live']), charge: decimal.nullish(), method: z.string().max(80).nullish(),
  payment_method: z.string().max(80).nullish(), meta: z.record(z.string().max(80), z.unknown()).nullish(),
})});
/** V1 wire amounts are ETB, not cents. Only authenticated verification reaches this parser. */
export function parseChapaV1Evidence(raw: unknown): ChapaEvidence | null {
  const parsed = verification.safeParse(raw); if (!parsed.success) return null;
  const {data, status: envelope} = parsed.data;
  if (data.status === 'success' && (envelope !== 'success' || !data.reference)) return null;
  const status = data.status === 'success' ? 'SUCCESS' : data.status === 'pending' ? 'PENDING' : data.status === 'cancelled' ? 'CANCELLED' : 'FAILED';
  return {merchantReference: data.tx_ref, chapaReference: data.reference ?? null, amountCents: data.amount,
    currency: data.currency, status, mode: data.mode, paymentMethod: data.payment_method ?? data.method ?? undefined,
    serviceFeeCents: data.charge ?? undefined, meta: data.meta ?? undefined, hash: chapaHash(JSON.stringify(raw))};
}
export function safeChapaV1CheckoutUrl(value: string, raw: Environment = process.env) {
  try {
    if (/[\u0000-\u0020\\]/.test(value)) return null;
    const url = new URL(value), expected = apiOrigin(raw) === origins[1] ? 'checkout.chapa.global' : 'checkout.chapa.co';
    if (url.protocol !== 'https:' || url.hostname !== expected || url.port || url.username || url.password || url.hash || url.pathname.length < 2) return null;
    return {checkoutUrl: value, chapaReference: null, checkoutReference: url.pathname.split('/').filter(Boolean).at(-1)!};
  } catch { return null; }
}
export function createdChapaV1Session(raw: unknown, env: Environment = process.env) {
  const parsed = z.object({status: z.literal('success'), data: z.object({checkout_url: z.string().max(2048)})}).safeParse(raw);
  const session = parsed.success ? safeChapaV1CheckoutUrl(parsed.data.data.checkout_url, env) : null;
  return session ? {...session, createdAt: undefined as Date | undefined, expiresAt: undefined as Date | undefined} : null;
}

const eventSchema = z.object({event: z.string().max(80), status: z.string().max(40), tx_ref: reference,
  reference: reference.nullish(), currency: z.literal('ETB'), amount: decimal, charge: decimal.nullish(),
  mode: z.enum(['test', 'live']), meta: z.record(z.string().max(80), z.unknown()).nullish()});
export function parseChapaV1Webhook(raw: unknown) {
  const parsed = eventSchema.safeParse(raw); if (!parsed.success) return null;
  const d = parsed.data;
  const states: Record<string, string> = {'charge.success': 'success', 'charge.pending': 'pending', 'charge.failed': 'failed',
    'charge.cancelled': 'cancelled', 'charge.failed/cancelled': 'failed/cancelled', 'charge.refunded': 'refunded', 'charge.refunding': 'refunding', 'charge.reversed': 'reversed'};
  if (states[d.event] !== d.status) return null;
  return {type: ['refunded', 'refunding', 'reversed'].includes(d.status) ? 'refund' as const : 'payment' as const,
    event: d.event, status: d.status, mode: d.mode, merchantReference: d.tx_ref, chapaReference: d.reference ?? undefined,
    amountCents: d.amount, serviceFeeCents: d.charge ?? undefined, currency: d.currency, meta: d.meta ?? undefined};
}
export function chapaV1WebhookConfigurationFingerprint(raw: Environment = process.env) {
  return chapaHash(JSON.stringify(['v1', chapaV1SignatureProfile(raw), raw.CHAPA_V1_WEBHOOK_SECRET]));
}
/** Select one documented signature profile; never try a series of algorithms until one passes. */
export function authenticateChapaV1Webhook(bytes: Uint8Array, headers: Headers, raw: Environment = process.env): ChapaV1SignatureProfile | null {
  const profile = chapaV1SignatureProfile(raw), secret = raw.CHAPA_V1_WEBHOOK_SECRET;
  if (!profile || !isChapaWebhookSecret(secret)) return null;
  const signature = headers.get(profile === 'legacy_secret' || profile === 'custom_json_body' ? 'chapa-signature' : 'x-chapa-signature');
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  let message: string | Uint8Array = bytes;
  if (profile === 'legacy_secret') message = secret;
  else if (profile !== 'raw_body') {
    try { message = JSON.stringify(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))); }
    catch { return null; }
  }
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? profile : null;
}

const inputSchema = z.object({amountCents: z.string().regex(/^[1-9]\d{0,14}$/), merchantReference: reference,
  idempotencyKey: z.string().min(16).max(128), returnUrl: z.url().max(2048).optional(), callbackUrl: z.url().max(2048).optional(),
  returnUrlVersion: z.literal(1).optional(), customer: z.object({first_name: z.string().max(120).optional(), last_name: z.string().max(120).optional(),
    email: z.email().max(254).optional(), phone_number: z.string().regex(/^0[79]\d{8}$/).optional()}).strict().optional(),
  meta: z.record(z.string().max(80), z.string().max(256)).optional(), description: z.string().max(200).optional(),
}).strict();
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new ChapaError(502, 'PROVIDER_UNAVAILABLE', 'Check this original payment again.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 65536) { await reader.cancel(); throw Error('Response bound'); } chunks.push(part.value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
    if (!response.ok) {
      const duplicate = !!body && typeof body === 'object' && /(?:reference|tx_ref).*(?:used|exist)|duplicate/i.test(String((body as {message?: unknown}).message ?? ''));
      // 404 from verify may mean unpaid. It is never a final unsuccessful payment.
      const code = duplicate ? 'INVALID_STATE' : response.status === 404 ? 'NOT_FOUND' : response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'INVALID_VALUE' : 'HTTP_ERROR';
      throw new ChapaProviderError(duplicate ? 409 : response.status, code);
    }
    if (body === null) throw Error('Invalid JSON'); return body;
  } finally { reader.releaseLock(); }
}
export function createChapaV1Transport(options: {env?: Environment; fetcher?: typeof fetch} = {}): ChapaTransport {
  const raw = options.env ?? process.env;
  const request = async (path: string, operation: 'create' | 'recover', body?: unknown) => {
    requireChapaV1(operation, raw);
    try {
      return await readJson(await (options.fetcher ?? fetch)(apiOrigin(raw) + path, {method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: `Bearer ${raw.CHAPA_V1_SECRET_KEY!}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
    } catch (error) {
      if (error instanceof ChapaProviderError) throw error;
      throw new ChapaError(502, 'PROVIDER_UNAVAILABLE', 'Payment status is pending. Check this same payment; do not pay again.');
    }
  };
  return {
    create: async (input: ChapaCreate) => {
      requireChapaV1('create', raw);
      const parsed = inputSchema.safeParse(input); if (!parsed.success) throw new ChapaError(422, 'INVALID_PAYMENT', 'Check the payment details.');
      const p = parsed.data;
      for (const value of [p.returnUrl, p.callbackUrl]) if (value) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.origin !== new URL(raw.MINI_APP_URL!).origin || url.username || url.password) throw new ChapaError(422, 'INVALID_PAYMENT', 'Use the configured payment return URL.');
      }
      return request('/v1/transaction/initialize', 'create', {amount: centsToEtb(BigInt(p.amountCents)), currency: 'ETB', tx_ref: p.merchantReference,
        ...(p.customer ?? {}), ...(p.returnUrl ? {return_url: p.returnUrl} : {}), ...(p.callbackUrl ? {callback_url: p.callbackUrl} : {}), ...(p.meta ? {meta: p.meta} : {})});
    },
    lookup: async txRef => { if (!reference.safeParse(txRef).success) throw new ChapaError(422, 'INVALID_PAYMENT', 'Invalid payment reference.'); return request(`/v1/transaction/verify/${encodeURIComponent(txRef)}`, 'recover'); },
    methods: async () => { throw new ChapaError(410, 'HOSTED_CHECKOUT_REQUIRED', 'Select your payment method on Chapa hosted checkout.'); },
  };
}
export const chapaV1Transport = createChapaV1Transport();
