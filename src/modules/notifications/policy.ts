/** Retire delivery, never the financial records or historical outbox evidence. */
export const retiredNotificationKinds = [
 'CHAPA_PAYMENT_CONFIRMED','AUCTION_STARTING_SOON','AUCTION_NO_WINNER',
 'AUCTION_FALLBACK_WON','FULFILLMENT_UPDATED','AUCTION_CLOSED','AUCTION_WON',
 'AUCTION_CANCELLED','AUCTION_MINIMUM_CANCELLED','AUCTION_START','FAVORITE_ENDING',
];
export const notificationRetired=(kind:string)=>retiredNotificationKinds.includes(kind);

const hour=3_600_000;
/** Disjoint windows avoid sending four catch-up reminders after a late start. */
export const endingReminders=[
 {kind:'AUCTION_ENDING_3_DAYS',key:'ending-3-days',minMs:48*hour,maxMs:72*hour,en:'3 days left',am:'3 ቀናት ቀርተዋል'},
 {kind:'AUCTION_ENDING_2_DAYS',key:'ending-2-days',minMs:24*hour,maxMs:48*hour,en:'2 days left',am:'2 ቀናት ቀርተዋል'},
 {kind:'AUCTION_ENDING',key:'ending',minMs:12*hour,maxMs:24*hour,en:'1 day left',am:'1 ቀን ቀርቷል'},
 {kind:'AUCTION_ENDING_12_HOURS',key:'ending-12-hours',minMs:0,maxMs:12*hour,en:'12 hours left',am:'12 ሰዓታት ቀርተዋል'},
] as const;
export const endingReminder=(kind:string)=>endingReminders.find(item=>item.kind===kind);
export function endingReminderCurrent(kind:string,endsAt:Date,now:Date){
 const reminder=endingReminder(kind),remaining=endsAt.getTime()-now.getTime();
 return !!reminder&&remaining>reminder.minMs&&remaining<=reminder.maxMs;
}
