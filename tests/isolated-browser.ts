import {createHash} from 'node:crypto';
import {test as base} from '@playwright/test';

// Each synthetic browser account represents an independent client. Reusing
// loopback for every context exhausts the real sign-in rate limit across tests.
// Sessions still require the actual signed Telegram or staff credential flow.
export const test=base.extend({
 extraHTTPHeaders:async({extraHTTPHeaders},use,info)=>{
  const address=createHash('sha256').update(`${info.project.name}:${info.testId}:${info.retry}`).digest();
  await use({...extraHTTPHeaders,'x-forwarded-for':`198.18.${address[0]}.${address[1]}`});
 },
});
export * from '@playwright/test';
