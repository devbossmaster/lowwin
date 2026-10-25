import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CatalogImage,CatalogImagePreview} from '../src/components/catalog-image';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(enabled:boolean,src:string,language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(CatalogImagePreview,{enabled,children:createElement(CatalogImage,{src,alt:'Original product'})})}));
describe('read-only staging product image preview',()=>{
 it('retains original product images when preview is disabled',()=>{const html=render(false,'/catalog/phone.svg');expect(html).toContain('src="/catalog/phone.svg"');expect(html).not.toContain('lowwin-demo-headphones')});
 it('renders a dimensioned responsive preview before the first client paint',()=>{const html=render(true,'/catalog/chair.svg');expect(html).toContain('url=%2Fimages%2Flowwin-demo-headphones.webp');expect(html).toContain('srcSet=');expect(html).toContain('width="1840" height="800"');expect(html).toContain('loading="lazy"');expect(html).not.toContain('/catalog/chair.svg');expect(html).toContain('DEMO')});
 it('keeps uploaded product photos cookie-bound even inside the preview',()=>{const html=render(true,'/api/media/real-product-photo');expect(html).toContain('src="/api/media/real-product-photo"');expect(html).not.toContain('/_next/image')});
 it('prioritizes only an explicitly visible product',()=>{const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(CatalogImage,{src:'/images/lowwin-demo-headphones.webp',alt:'First product',priority:true})}));expect(html).toContain('loading="eager"');expect(html).toContain('fetchPriority="high"')});
 it('provides translated preview alt text',()=>{expect(render(true,'/catalog/phone.svg','am')).toContain('የማዳመጫ ምስል')});
});
