# Auction cards and sorting controls

The existing product assets now sit in wide rounded image frames with truthful status badges and a small Win tab for live/upcoming listings. Titles, fee/countdown pills and the dark gold-text fee action are centered. Fee disclosure and the actual schedule/auction ID appear beneath the action. Paid entries display their exact submission fee; free entries retain Bid now. The existing BidSheet and financial behavior are unchanged.

All five Home sorting chips fit one mobile row, with neutral inactive pills, a gold selected state and a small Default sorting icon. English and Amharic labels retain accessible tap targets and fit without horizontal overflow. Recent winners remains after the live list; the smaller category-to-heading gap is retained.

Typechecks and a fresh optimized webpack build pass. Both focused browser flows pass at 360px and 430px, checking English/Amharic chip geometry, text bounds, 44px controls, the image ratio, a 46px fee action and opening the existing BidSheet. The staging-result/catalog safety checks separately pass 36/36 cases.

Screenshots use explicitly labeled loopback QA inventory, not customer winners: [English 430px](screenshots/auction-cards/auction-card-430-en.png), [Amharic 430px](screenshots/auction-cards/auction-card-430-am.png), [English 360px](screenshots/auction-cards/auction-card-360-en.png), [Amharic 360px](screenshots/auction-cards/auction-card-360-am.png).

The owner's [staging preview data](ui-preview-seed.md) is populated separately. No production deployment or real payment provider was enabled. Physical Telegram device review remains separate from these Chromium checks.
