/** Current LowWin identity and approved campaign art; originals are preserved. */
export const LOWWIN_LOGO_SRC='/images/lowwin-ribbon-l-blue-20261114-v2.webp';
export const LOWWIN_ICON_SRC='/images/lowwin-ribbon-l-icon-20261114-v2.png';
export const LOWWIN_BRAND_NAME='LowWin';
export const LOWWIN_BANNER_SRC={en:'/images/lowwin-pearl-banner-en-20261116.webp',am:'/images/lowwin-pearl-banner-am-20261116.webp'} as const;
/** The Home banner follows its own reference proportions. */
export const LOWWIN_HOME_BANNER_SRC={en:'/images/lowwin-pearl-home-en-20261116.webp',am:'/images/lowwin-pearl-home-am-20261116.webp'} as const;

// Built-in campaign artwork follows the selected locale. Published uploads,
// consent-controlled winner media and product photographs keep their own URLs.
const legacyBanners=new Set(['/images/lowwin-home-16x9-en-20261114-v3.webp','/images/lowwin-home-16x9-am-20261114-v3.webp','/images/lowwin-light-blue-banner-en-20261114-v3.webp','/images/lowwin-light-blue-banner-am-20261114-v3.webp','/images/lowwin-home-16x9-en-20261114-v2.webp','/images/lowwin-home-16x9-am-20261114-v2.webp','/images/lowwin-light-blue-banner-en-20261114-v2.webp','/images/lowwin-light-blue-banner-am-20261114-v2.webp','/images/lowwin-home-16x9-en-20261114.webp','/images/lowwin-home-16x9-am-20261114.webp','/images/lowwin-light-blue-banner-en-20261114.webp','/images/lowwin-light-blue-banner-am-20261114.webp',...Object.values(LOWWIN_BANNER_SRC),'/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/banner11.png','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-am-20261113.webp','/images/lowwin-blue-banner-en-20261113-v2.webp','/images/lowwin-blue-banner-am-20261113-v2.webp']);
export function lowwinBanner(language:'en'|'am',configured?:string|null){
 return !configured||legacyBanners.has(configured.split(/[?#]/,1)[0])?LOWWIN_BANNER_SRC[language]:configured;
}
export function lowwinHomeBanner(language:'en'|'am',configured?:string|null){
 const path=configured?.split(/[?#]/,1)[0];
 return !path||legacyBanners.has(path)||Object.values(LOWWIN_HOME_BANNER_SRC).some(src=>src===path)?LOWWIN_HOME_BANNER_SRC[language]:configured!;
}

/** Art direction keeps the complete family/prizes visible in a shallower desktop hero. */
export function lowwinDesktopHomeBanner(language:'en'|'am',configured?:string|null){
 return lowwinHomeBanner(language,configured)===LOWWIN_HOME_BANNER_SRC[language]?LOWWIN_BANNER_SRC[language]:configured!;
}
