/** Blue derivatives of the original Lowwin mark; supplied originals are preserved. */
export const LOWWIN_LOGO_SRC='/images/lowwin-blue-logo-20261113.webp';
export const LOWWIN_ICON_SRC='/images/lowwin-blue-icon-20261113.png';
export const LOWWIN_BRAND_NAME='LowWin';
export const LOWWIN_BANNER_SRC={en:'/images/lowwin-blue-banner-en-20261113-v2.webp',am:'/images/lowwin-blue-banner-am-20261113-v2.webp'} as const;

// Built-in campaign artwork follows the selected locale. Published uploads,
// consent-controlled winner media and product photographs keep their own URLs.
const legacyBanners=new Set([...Object.values(LOWWIN_BANNER_SRC),'/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/banner11.png','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-am-20261113.webp']);
export function lowwinBanner(language:'en'|'am',configured?:string|null){
 return !configured||legacyBanners.has(configured.split(/[?#]/,1)[0])?LOWWIN_BANNER_SRC[language]:configured;
}
