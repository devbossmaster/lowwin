/** Current LowWin identity and approved campaign art; originals are preserved. */
export const LOWWIN_LOGO_SRC='/images/lowwin-ribbon-l-blue-20261114-v2.webp';
export const LOWWIN_ICON_SRC='/images/lowwin-ribbon-l-icon-20261114-v2.png';
export const LOWWIN_BRAND_NAME='LowWin';
export const LOWWIN_BODY_FONT_SRC='/fonts/dm-sans-latin-variable.woff2';
export const LOWWIN_DISPLAY_FONT_SRC='/fonts/outfit-latin-variable.woff2';
export const LOWWIN_ETHIOPIC_FONT_SRC='/fonts/noto-sans-ethiopic-variable.woff2';
export const LOWWIN_TIKTOK_URL='https://www.tiktok.com/@lowwin23';
export const LOWWIN_BANNER_SRC={en:'/images/lowwin-pearl-banner-en-20261116.webp',am:'/images/lowwin-pearl-banner-am-20261116.webp'} as const;
/** The Home banner follows its own reference proportions. */
const homeShowcase='/images/lowwin-electronics-showcase-20261128.webp';
export const LOWWIN_HOME_BANNER_SRC={en:homeShowcase,am:homeShowcase} as const;
/** The same landscape scene is used on phones and desktop. */
export const LOWWIN_HOME_MOBILE_BANNER_SRC=LOWWIN_HOME_BANNER_SRC;

// Built-in campaign artwork follows the selected locale. Published uploads,
// consent-controlled winner media and product photographs keep their own URLs.
const legacyBanners=new Set(['/images/lowwin-blue-prizes-hero-20261117.webp','/images/lowwin-gold-prizes-hero-20261117.webp','/images/lowwin-unique-refund-hero-20261117.webp','/images/lowwin-home-16x9-en-20261114-v3.webp','/images/lowwin-home-16x9-am-20261114-v3.webp','/images/lowwin-light-blue-banner-en-20261114-v3.webp','/images/lowwin-light-blue-banner-am-20261114-v3.webp','/images/lowwin-home-16x9-en-20261114-v2.webp','/images/lowwin-home-16x9-am-20261114-v2.webp','/images/lowwin-light-blue-banner-en-20261114-v2.webp','/images/lowwin-light-blue-banner-am-20261114-v2.webp','/images/lowwin-home-16x9-en-20261114.webp','/images/lowwin-home-16x9-am-20261114.webp','/images/lowwin-light-blue-banner-en-20261114.webp','/images/lowwin-light-blue-banner-am-20261114.webp',...Object.values(LOWWIN_BANNER_SRC),'/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/banner11.png','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-am-20261113.webp','/images/lowwin-blue-banner-en-20261113-v2.webp','/images/lowwin-blue-banner-am-20261113-v2.webp']);
export function lowwinBanner(language:'en'|'am',configured?:string|null){
 return !configured||legacyBanners.has(configured.split(/[?#]/,1)[0])?LOWWIN_BANNER_SRC[language]:configured;
}
export function lowwinHomeBanner(language:'en'|'am',configured?:string|null){
 const path=configured?.split(/[?#]/,1)[0];
 return !path||/^\/images\/lowwin-family-home-blue(?:-mobile)?-20261118\.webp$/.test(path)||/^\/images\/lowwin-blue-black-prizes-2026111[78]\.webp$/.test(path)||legacyBanners.has(path)||/^\/images\/lowwin-pearl-home-(?:en|am)-20261116\.webp$/.test(path)||Object.values(LOWWIN_HOME_BANNER_SRC).some(src=>src===path)?LOWWIN_HOME_BANNER_SRC[language]:configured!;
}

/** Preserve custom artwork URLs while sharing the landscape showcase. */
export function lowwinMobileHomeBanner(language:'en'|'am',configured?:string|null){
 return lowwinHomeBanner(language,configured);
}

/** Share the same landscape artwork on desktop. */
export function lowwinDesktopHomeBanner(language:'en'|'am',configured?:string|null){
 return lowwinHomeBanner(language,configured);
}
