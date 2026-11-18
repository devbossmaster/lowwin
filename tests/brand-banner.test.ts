import {describe,expect,it} from 'vitest';
import {LOWWIN_BANNER_SRC,LOWWIN_HOME_BANNER_SRC,LOWWIN_HOME_MOBILE_BANNER_SRC,LOWWIN_BRAND_NAME,lowwinBanner,lowwinHomeBanner,lowwinMobileHomeBanner,lowwinDesktopHomeBanner} from '../src/lib/brand';
import {resolveLearnMoreMedia} from '../src/lib/learn-more-media';

describe('one current LowWin campaign banner',()=>{
 it('uses the blue product banner and consistent display name',()=>{expect(LOWWIN_BRAND_NAME).toBe('LowWin');for(const language of ['en','am'] as const)expect(lowwinBanner(language)).toBe(LOWWIN_BANNER_SRC[language])});
 it.each(['/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-en-20261113-v2.webp','/images/lowwin-blue-banner-am-20261113-v2.webp'])('replaces only the known old default %s',path=>{for(const language of ['en','am'] as const)expect(lowwinBanner(language,path+'?v=old')).toBe(LOWWIN_BANNER_SRC[language])});
 it('preserves published uploads and unrelated private/product paths exactly',()=>{for(const path of ['/api/media/11111111-1111-4111-a111-111111111111','/images/custom-campaign.webp','/images/lowwin-home-banner-en.webp/private','/images/private-winner.webp'])expect(lowwinBanner('am',path)).toBe(path)});
 it('refreshes former built-in Home artwork to the approved identity while preserving custom uploads',()=>{
  for(const language of ['en','am'] as const){
   for(const old of ['/images/lowwin-blue-black-prizes-20261117.webp','/images/lowwin-blue-black-prizes-20261118.webp','/images/lowwin-home-16x9-en-20261114.webp','/images/lowwin-home-16x9-am-20261114.webp','/images/lowwin-light-blue-banner-en-20261114.webp']){expect(lowwinHomeBanner(language,old+'?v=old')).toBe(LOWWIN_HOME_BANNER_SRC[language]);expect(lowwinMobileHomeBanner(language,old+'?v=old')).toBe(LOWWIN_HOME_MOBILE_BANNER_SRC[language]);}
   const custom='/api/media/11111111-1111-4111-a111-111111111111';expect(lowwinHomeBanner(language,custom)).toBe(custom);expect(lowwinMobileHomeBanner(language,custom)).toBe(custom);
  }
 });
 it('uses the wide desktop composition only for built-in Home artwork',()=>{
  for(const language of ['en','am'] as const){
   expect(lowwinDesktopHomeBanner(language)).toBe(LOWWIN_HOME_BANNER_SRC[language]);
   expect(lowwinMobileHomeBanner(language)).toBe(LOWWIN_HOME_MOBILE_BANNER_SRC[language]);
   expect(lowwinDesktopHomeBanner(language,LOWWIN_HOME_BANNER_SRC[language])).toBe(LOWWIN_HOME_BANNER_SRC[language]);
   expect(lowwinMobileHomeBanner(language,LOWWIN_HOME_BANNER_SRC[language])).toBe(LOWWIN_HOME_MOBILE_BANNER_SRC[language]);
   expect(lowwinDesktopHomeBanner(language,'/images/lowwin-home-16x9-en-20261114-v2.webp')).toBe(LOWWIN_HOME_BANNER_SRC[language]);
   for(const path of ['/images/lowwin-pearl-home-en-20261116.webp','/images/lowwin-pearl-home-am-20261116.webp'])expect(lowwinHomeBanner(language,path)).toBe(LOWWIN_HOME_BANNER_SRC[language]);
   for(const custom of ['/api/media/private-upload','/images/custom-campaign.webp']){expect(lowwinDesktopHomeBanner(language,custom)).toBe(custom);expect(lowwinMobileHomeBanner(language,custom)).toBe(custom);}
  }
 });
 it('localizes built-in tutorial posters while keeping configured media intact',()=>{const old=resolveLearnMoreMedia({local:'/videos/guide.mp4',poster:'/images/lowin-family-hero.webp'});expect(old).toEqual({kind:'local',src:'/videos/guide.mp4',poster:LOWWIN_BANNER_SRC.am});expect(lowwinBanner('en',old!.poster)).toBe(LOWWIN_BANNER_SRC.en);expect(resolveLearnMoreMedia({local:'/videos/guide.mp4',poster:'/api/media/11111111-1111-4111-a111-111111111111'})).toMatchObject({poster:'/api/media/11111111-1111-4111-a111-111111111111'})});
});
