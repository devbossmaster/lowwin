import {chapaWebhookHandler} from '@/modules/payments/chapa-webhook';
export const runtime='nodejs';
export const POST=chapaWebhookHandler(1);
