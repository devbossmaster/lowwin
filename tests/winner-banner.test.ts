import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {CatalogAuction} from '../src/modules/auctions/catalog';
import {MiniLocaleProvider} from '../src/components/mini-locale';
import {WinnerBanner,winnerBannerData} from '../src/components/winner-banner';

const photo='/api/media/6eef552c-6db2-4bc8-8dd4-c9c93bbab301';
function auction(change:Record<string,unknown>={}):CatalogAuction{return {
 code:'42',status:'closed',isDemo:false,
 product:{title:'Rugass 20,000 mAh power bank',titleAm:'ሩጋስ 20,000 mAh ፓወር ባንክ',images:[{path:'/images/lowwin-demo-headphones.webp'}]},
 terms:{ruleVersion:'lowest-unique-v4'},
 result:{source:'SETTLED',outcome:'WINNER',winningPoints:'0.54',winnerPhoneMasked:'***5294',winnerDisplay:null},
 ...change,
} as unknown as CatalogAuction}
const render=(item:CatalogAuction,language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(WinnerBanner,{auction:item})}));

describe('authoritative winner announcement banner',()=>{
 it('announces a real settled V4 winning number without presenting it as a currency charge',()=>{
  const html=render(auction());expect(html).toContain('Winning number');expect(html).toContain('0.54');expect(html).not.toContain('ETB');expect(html).toContain('Rugass');expect(html).toContain('***5294');expect(html).toContain('data-photo="product"');
 });
 it('retains monetary labels for the auction’s frozen legacy rule',()=>{
  const item=auction({terms:{ruleVersion:'lowest-unique-v3'}}),html=render(item);
  expect(html).toContain('Winning amount');expect(html).toContain('ETB 0.54');expect(html).not.toContain('Winning number');
 });
 it('does not announce pending, cancelled, non-winning or illustrative outcomes',()=>{
  const item=auction();
  for(const change of [{status:'live'},{status:'closing'},{result:null},{result:{...item.result,outcome:'NO_WINNER'}},{result:{...item.result,source:'ILLUSTRATIVE'}},{isDemo:true}])expect(render(auction(change))).toBe('');
 });
 it('does not invent a winning value when the saved result is absent or malformed',()=>{
  for(const winningPoints of [null,'0.00','-1.00','not a number'])expect(winnerBannerData(auction({result:{...auction().result,winningPoints}}))).toBeNull();
 });
 it('replaces only the image with the server-approved photograph and retains the recorded result',()=>{
  const item=auction({result:{...auction().result,winnerPhotoPath:photo}}),before=structuredClone(item),html=render(item);
  expect(html).toContain(`src="${photo}"`);expect(html).toContain('data-photo="winner"');expect(html).toContain('Winner photograph for Rugass');expect(html).toContain('0.54');expect(item).toEqual(before);
 });
 it('falls back to the product when photo metadata is missing, removed or an unsafe URL',()=>{
  for(const winnerPhotoPath of [null,undefined,'https://other.example/person.jpg','/api/media/../../private','/images/unapproved-person.png']){
   const data=winnerBannerData(auction({result:{...auction().result,winnerPhotoPath}}));
   expect(data?.photo).toBeNull();expect(data?.image).toBe('/images/lowwin-demo-headphones.webp');
  }
 });
 it('uses localized product and result wording while preserving the same winning value',()=>{
  const html=render(auction(),'am');expect(html).toContain('አሸናፊ');expect(html).toContain('ሩጋስ');expect(html).toContain('ያሸነፈው ቁጥር');expect(html).toContain('0.54');
  expect(winnerBannerData(auction({product:{...auction().product,titleAm:'  '}}),true)?.title).toBe('Rugass 20,000 mAh power bank');
 });
 it('does not infer or expose a personal name or identifier from additional result fields',()=>{
  const html=render(auction({result:{...auction().result,winnerDisplay:'Private legal name',winnerUserId:'private-user-id',winnerPhoneMasked:null}}));
  expect(html).not.toContain('Private legal name');expect(html).not.toContain('private-user-id');expect(html).toContain('#42');
 });
});
