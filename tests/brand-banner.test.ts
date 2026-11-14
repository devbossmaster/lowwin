import {describe,expect,it} from 'vitest';
import {LOWWIN_BANNER_SRC,LOWWIN_BRAND_NAME,lowwinBanner} from '../src/lib/brand';
import {resolveLearnMoreMedia} from '../src/lib/learn-more-media';

describe('one current LowWin campaign banner',()=>{
 it('uses the blue product banner and consistent display name',()=>{expect(LOWWIN_BRAND_NAME).toBe('LowWin');for(const language of ['en','am'] as const)expect(lowwinBanner(language)).toBe(LOWWIN_BANNER_SRC[language])});
 it.each(['/images/lowwin-home-banner-en.webp','/images/lowwin-home-banner-am.webp','/images/lowin-family-hero.webp','/images/lowwin-violet-hero-20261113.webp','/images/lowwin-blue-banner-en-20261113.webp','/images/lowwin-blue-banner-en-20261113-v2.webp','/images/lowwin-blue-banner-am-20261113-v2.webp'])('replaces only the known old default %s',path=>{for(const language of ['en','am'] as const)expect(lowwinBanner(language,path+'?v=old')).toBe(LOWWIN_BANNER_SRC[language])});
 it('preserves published uploads and unrelated private/product paths exactly',()=>{for(const path of ['/api/media/11111111-1111-4111-a111-111111111111','/images/custom-campaign.webp','/images/lowwin-home-banner-en.webp/private','/images/private-winner.webp'])expect(lowwinBanner('am',path)).toBe(path)});
 it('localizes built-in tutorial posters while keeping configured media intact',()=>{const old=resolveLearnMoreMedia({local:'/videos/guide.mp4',poster:'/images/lowin-family-hero.webp'});expect(old).toEqual({kind:'local',src:'/videos/guide.mp4',poster:LOWWIN_BANNER_SRC.am});expect(lowwinBanner('en',old!.poster)).toBe(LOWWIN_BANNER_SRC.en);expect(resolveLearnMoreMedia({local:'/videos/guide.mp4',poster:'/api/media/11111111-1111-4111-a111-111111111111'})).toMatchObject({poster:'/api/media/11111111-1111-4111-a111-111111111111'})});
});
