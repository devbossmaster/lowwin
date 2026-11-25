export const notificationHistoryLabels: Record<string, string> = {
  BROADCAST: 'Manual broadcast',
  AUCTION_UPCOMING_ADDED: 'New upcoming auction',
  AUCTION_UPCOMING: 'Starts soon · 1 day',
  AUCTION_UPCOMING_1_HOUR: 'Starts soon · 1 hour',
  AUCTION_PUBLISHED: 'Auction started',
  AUCTION_ENDING_3_DAYS: 'Ends soon · 3 days',
  AUCTION_ENDING_2_DAYS: 'Ends soon · 2 days',
  AUCTION_ENDING: 'Ends soon · 1 day',
  AUCTION_ENDING_12_HOURS: 'Ends soon · 12 hours',
  AUCTION_ENDING_1_HOUR: 'Ends soon · 1 hour',
  AUCTION_ENDED: 'Auction result',
  WINNER_CONGRATULATIONS: 'Winner congratulations',
  BID_ACCEPTED: 'Bid accepted',
  DEPOSIT_CREDITED: 'Deposit credited',
  AUCTION_FEE_REFUNDED: 'Auction fee refunded',
  CHAPA_PAYMENT_CONFIRMED: 'Payment confirmed',
};

export function notificationHistoryLabel(kind: string) {
  return Object.hasOwn(notificationHistoryLabels, kind)
    ? notificationHistoryLabels[kind]
    : kind.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}
