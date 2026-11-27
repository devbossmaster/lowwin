export const retiredPreStartReminderKinds=['AUCTION_UPCOMING_ADDED','AUCTION_UPCOMING_1_HOUR'] as const;

const activeAutomaticNotificationKinds=[
 'DEPOSIT_CREDITED',
 'AUCTION_ENDING_3_DAYS','AUCTION_ENDING_2_DAYS','AUCTION_ENDING','AUCTION_ENDING_12_HOURS','AUCTION_ENDING_1_HOUR',
 'AUCTION_ENDED','AUCTION_PUBLISHED','AUCTION_UPCOMING',
 'BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED',
] as const;
/** Automatic kinds visible in the inbox, including previously sent reminders. */
export const automaticNotificationKinds=[...activeAutomaticNotificationKinds,...retiredPreStartReminderKinds] as const;
export const deliveryNotificationKinds=[...activeAutomaticNotificationKinds,'BROADCAST'] as const;
export const internalNotificationKinds=['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS','BROADCAST_DELETE','TELEGRAM_DELETE'] as const;
const permitted=new Set<string>([...deliveryNotificationKinds,...internalNotificationKinds]);
/** Retire delivery, never the financial records or historical outbox evidence. */
export const retiredNotificationKinds = [
 'CHAPA_PAYMENT_CONFIRMED','AUCTION_STARTING_SOON','AUCTION_NO_WINNER',
 'AUCTION_FALLBACK_WON','FULFILLMENT_UPDATED','AUCTION_CLOSED','AUCTION_WON',
 'AUCTION_CANCELLED','AUCTION_MINIMUM_CANCELLED','AUCTION_START','FAVORITE_ENDING',
 'AUCTION_RESULT','CONTACT_CONFIRMED','PAYMENT_CREDITED','PAYMENT_VERIFIED',
 ...retiredPreStartReminderKinds,
];
export const notificationRetired=(kind:string)=>!permitted.has(kind);

const hour=3_600_000;
export const auctionOpeningScanGraceMs=5*60_000;
export const upcomingReminder={kind:'AUCTION_UPCOMING',keyPrefix:'global:starts-24-hours:',leadMs:24*hour,scanGraceMs:5*60_000,deliveryGraceMs:30*60_000} as const;
export function upcomingReminderCurrent(startsAt:Date|null,publishedAt:Date|null,scheduledStartAt:string|undefined,now:Date){
 if(!startsAt||!publishedAt||!scheduledStartAt||!Number.isFinite(startsAt.getTime())||startsAt.toISOString()!==scheduledStartAt)return false;
 const dueAt=startsAt.getTime()-upcomingReminder.leadMs,lateBy=now.getTime()-dueAt;
 return publishedAt.getTime()<=dueAt&&lateBy>=0&&lateBy<upcomingReminder.deliveryGraceMs;
}

/** Disjoint windows avoid sending catch-up reminders after a late start. */
export const endingReminders=[
 {kind:'AUCTION_ENDING_3_DAYS',key:'ending-3-days',minMs:48*hour,maxMs:72*hour},
 {kind:'AUCTION_ENDING_2_DAYS',key:'ending-2-days',minMs:24*hour,maxMs:48*hour},
 {kind:'AUCTION_ENDING',key:'ending',minMs:12*hour,maxMs:24*hour},
 {kind:'AUCTION_ENDING_12_HOURS',key:'ending-12-hours',minMs:hour,maxMs:12*hour},
 {kind:'AUCTION_ENDING_1_HOUR',key:'ending-1-hour',minMs:0,maxMs:hour},
] as const;
export const endingReminder=(kind:string)=>endingReminders.find(item=>item.kind===kind);
export function endingReminderCurrent(kind:string,endsAt:Date,now:Date){
 const reminder=endingReminder(kind),remaining=endsAt.getTime()-now.getTime();
 return !!reminder&&remaining>reminder.minMs&&remaining<=reminder.maxMs;
}
