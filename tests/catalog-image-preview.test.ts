import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CatalogImage,CatalogImagePreview} from '../src/components/catalog-image';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(enabled:boolean,src:string,language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(CatalogImagePreview,{enabled,children:createElement(CatalogImage,{src,alt:'Original product'})})}));
describe('read-only staging product image preview',()=>{
 it('retains original product images when preview is disabled',()=>{const html=render(false,'/catalog/phone.svg');expect(html).toContain('src="/catalog/phone.svg"');expect(html).not.toContain('lowwin-demo-headphones')});
 it('renders the shared generated photo before the first client paint',()=>{const html=render(true,'/catalog/chair.svg');expect(html).toContain('src="/images/lowwin-demo-headphones.webp"');expect(html).not.toContain('/catalog/chair.svg');expect(html).toContain('DEMO')});
 it('keeps uploaded product photos intact even inside the preview',()=>{expect(render(true,'/api/media/real-product-photo')).toContain('src="/api/media/real-product-photo"')});
 it('provides translated preview alt text',()=>{expect(render(true,'/catalog/phone.svg','am')).toContain('የማዳመጫ ምስል')});
});
