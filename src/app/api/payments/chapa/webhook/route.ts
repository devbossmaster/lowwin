import {chapaWebhookHandler} from '@/modules/payments/chapa-webhook';
export const runtime='nodejs';
// Historical v2 deliveries remain version-bound and cannot claim v1 attempts.
export const POST=chapaWebhookHandler(2);
