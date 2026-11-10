import {z} from 'zod';

export const notificationSettingsSchema=z.object({
 NOTIFICATION_SEND_CONCURRENCY:z.coerce.number().int().min(2).max(8).default(4),
 NOTIFICATION_EXPANSION_BATCHES:z.coerce.number().int().min(1).max(10).default(3),
 TELEGRAM_SENDS_PER_SECOND:z.coerce.number().int().min(2).max(29).default(20),
 TELEGRAM_BULK_SENDS_PER_SECOND:z.coerce.number().int().min(1).max(28).default(16),
 TELEGRAM_PRIVATE_CHAT_INTERVAL_MS:z.coerce.number().int().min(1000).max(60000).default(1000),
 TELEGRAM_GROUP_CHAT_INTERVAL_MS:z.coerce.number().int().min(3000).max(60000).default(3000),
 TELEGRAM_RATE_MAX_WAIT_MS:z.coerce.number().int().min(100).max(10000).default(10000),
}).refine(value=>value.TELEGRAM_BULK_SENDS_PER_SECOND<value.TELEGRAM_SENDS_PER_SECOND,{message:'Bulk rate must leave capacity for personal messages',path:['TELEGRAM_BULK_SENDS_PER_SECOND']});

export type NotificationSettings=z.infer<typeof notificationSettingsSchema>;
export function notificationSettings(raw:Record<string,string|undefined>=process.env){
 const parsed=notificationSettingsSchema.safeParse(raw);
 if(!parsed.success)throw Error(`Invalid notification configuration: ${parsed.error.issues.map(issue=>issue.path.join('.')).join(', ')}`);
 return parsed.data;
}
