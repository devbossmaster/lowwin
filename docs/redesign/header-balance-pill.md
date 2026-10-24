# Compact gold balance pill

The header balance now follows the supplied capsule reference: a 32px-high gold shape, white wallet icon and bold amount/currency, with a lighter 20px circular plus. The zero-balance pill is 114px wide. Both links retain 44px tap targets; real larger balances can expand within the existing header space. Formatting, unavailable state, balance refresh, Wallet and top-up destinations are unchanged. Other header controls and the logo are unchanged.

Both checkout typechecks, five focused wallet tests and the two existing account-header browser scenarios pass at 360px/430px, including English/Amharic, long names, 1234.50 ETB without amount truncation, live balance refresh, failure recovery, Telegram avatar, notification count, navigation and loopback reconciliation. No dependencies, payment activation or production data changed; a full build was not rerun for this CSS refinement.

[360px zero](screenshots/header-gold-balance/header-360-zero.png), [430px zero](screenshots/header-gold-balance/header-430-zero.png), [360px balance](screenshots/header-gold-balance/header-360-en.png), [430px Amharic](screenshots/header-gold-balance/header-430-am.png).
