export const DEPOSIT_CHANNELS=['telebirr','cbe','mpesa'] as const;
export function paymentChannelName(channel:string){return channel==='manual'?'Admin credit':channel==='mpesa'?'M-Pesa':channel==='cbe'?'CBE':channel==='telebirr'?'Telebirr':channel}
