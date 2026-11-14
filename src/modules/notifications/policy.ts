/** Only the owner's finalized thirteen automatic messages may be delivered.
 * Control jobs are internal queue machinery, never user-facing messages. */
export const automaticNotificationKinds=[
 'DEPOSIT_CREDITED',
 'AUCTION_ENDING_3_DAYS','AUCTION_ENDING_2_DAYS','AUCTION_ENDING','AUCTION_ENDING_12_HOURS','AUCTION_ENDING_1_HOUR',
 'AUCTION_ENDED','AUCTION_PUBLISHED','AUCTION_UPCOMING_ADDED','AUCTION_UPCOMING','AUCTION_UPCOMING_1_HOUR',
 'BID_ACCEPTED','WINNER_CONGRATULATIONS',
] as const;
export const deliveryNotificationKinds=[...automaticNotificationKinds,'BROADCAST'] as const;
export const internalNotificationKinds=['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS','TELEGRAM_DELETE'] as const;
const permitted=new Set<string>([...deliveryNotificationKinds,...internalNotificationKinds]);
/** Retire delivery, never the financial records or historical outbox evidence. */
export const retiredNotificationKinds = [
 'CHAPA_PAYMENT_CONFIRMED','AUCTION_STARTING_SOON','AUCTION_NO_WINNER',
 'AUCTION_FALLBACK_WON','FULFILLMENT_UPDATED','AUCTION_CLOSED','AUCTION_WON',
 'AUCTION_CANCELLED','AUCTION_MINIMUM_CANCELLED','AUCTION_START','FAVORITE_ENDING',
 'AUCTION_RESULT','CONTACT_CONFIRMED','PAYMENT_CREDITED','PAYMENT_VERIFIED',
];
export const notificationRetired=(kind:string)=>!permitted.has(kind);

const hour=3_600_000;
/** Disjoint windows avoid sending catch-up reminders after a late start. */
export const endingReminders=[
 {kind:'AUCTION_ENDING_3_DAYS',key:'ending-3-days',minMs:48*hour,maxMs:72*hour,en:'3 days left',am:'3 ቀናት ቀርተዋል'},
 {kind:'AUCTION_ENDING_2_DAYS',key:'ending-2-days',minMs:24*hour,maxMs:48*hour,en:'2 days left',am:'2 ቀናት ቀርተዋል'},
 {kind:'AUCTION_ENDING',key:'ending',minMs:12*hour,maxMs:24*hour,en:'24 hours left',am:'24 ሰዓታት ቀርተዋል'},
 {kind:'AUCTION_ENDING_12_HOURS',key:'ending-12-hours',minMs:hour,maxMs:12*hour,en:'12 hours left',am:'12 ሰዓታት ቀርተዋል'},
 {kind:'AUCTION_ENDING_1_HOUR',key:'ending-1-hour',minMs:0,maxMs:hour,en:'1 hour left',am:'1 ሰዓት ቀርቷል'},
] as const;
export const endingReminder=(kind:string)=>endingReminders.find(item=>item.kind===kind);
export function endingReminderCurrent(kind:string,endsAt:Date,now:Date){
 const reminder=endingReminder(kind),remaining=endsAt.getTime()-now.getTime();
 return !!reminder&&remaining>reminder.minMs&&remaining<=reminder.maxMs;
}
/** Same disjoint rule for pre-start reminders; never send both on late resume. */
export const upcomingReminders=[
 {kind:'AUCTION_UPCOMING',key:'upcoming',minMs:hour,maxMs:24*hour,am:'ጨረታው በ24 ሰዓታት ውስጥ ይጀምራል'},
 {kind:'AUCTION_UPCOMING_1_HOUR',key:'upcoming-1-hour',minMs:0,maxMs:hour,am:'ጨረታው በ1 ሰዓት ውስጥ ይጀምራል'},
] as const;
export const upcomingReminder=(kind:string)=>upcomingReminders.find(item=>item.kind===kind);
export function upcomingReminderCurrent(kind:string,startsAt:Date,now:Date){
 const reminder=upcomingReminder(kind),remaining=startsAt.getTime()-now.getTime();
 return !!reminder&&remaining>reminder.minMs&&remaining<=reminder.maxMs;
}
