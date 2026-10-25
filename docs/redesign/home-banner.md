# Home banner — 24 October 2026

The existing family photo is unchanged. The configured English/Amharic headline now sits inside the banner at the left, with a gold final word, a dark photographic gradient and self-hosted Sora / Noto Serif Ethiopic typography. The former introduction below the image is removed.

Following the latest owner instruction, the only supporting line is **The lowest unique bid wins.** / **ዝቅተኛው ልዩ ቁጥር ያሸንፋል።** The longer explanation remains available through Learn more. Its lazy-loaded sheet, configured-video guard, keyboard close and explicit trigger focus restoration remain connected. Recent winners retains its existing scroll/focus action and reduced-motion behavior.

The size follow-up keeps the banner at full viewport width, reduces its mobile height to approximately 230px, and places the actions 12px below the copy rather than pushing them to the bottom. Image, text, fonts and action behavior remain unchanged.

Focused validation: `npm.cmd run typecheck` passed. Both Playwright mobile scenarios passed, covering English and Amharic at 360px and 430px, unchanged loaded image, local fonts, exact copy, absence of duplicate explanations, banner bounds, 44px actions, Learn more/Escape/focus restoration and recent-winner scrolling. Chromium loopback checks used an isolated disposable database. Physical Telegram WebViews were not retested for this banner-only change. The dev server logged an aborted request during test teardown after both scenarios passed.

No dependencies, payment behavior, authentication, database schema or other Home styles changed. No production deployment occurred.

| Width | English | Amharic |
| --- | --- | --- |
| 360px | [Screenshot](screenshots/banner/banner-360-en.png) | [Screenshot](screenshots/banner/banner-360-am.png) |
| 430px | [Screenshot](screenshots/banner/banner-430-en.png) | [Screenshot](screenshots/banner/banner-430-am.png) |
