/** Current flat LowWin mark and approved campaign art; originals are preserved. */
export const LOWWIN_LOGO_SRC='/images/lowwin-flat-mark-20261114.svg';
export const LOWWIN_ICON_SRC='/images/lowwin-flat-icon-20261114.png';
export const LOWWIN_BRAND_NAME='LowWin';
export const LOWWIN_BANNER_SRC={en:'/images/lowwin-light-blue-banner-en-20261114.webp',am:'/images/lowwin-light-blue-banner-am-20261114.webp'} as const;

// Built-in campaign artwork follows the selected locale. Published uploads,
// consent-controlled winner media and product photographs keep their own URLs.
const legacyBanners=new Set([...Object.values(LOWWIN_BANNER_SRC),'/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/banner11.png','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-am-20261113.webp','/images/lowwin-blue-banner-en-20261113-v2.webp','/images/lowwin-blue-banner-am-20261113-v2.webp']);
export function lowwinBanner(language:'en'|'am',configured?:string|null){
 return !configured||legacyBanners.has(configured.split(/[?#]/,1)[0])?LOWWIN_BANNER_SRC[language]:configured;
}
