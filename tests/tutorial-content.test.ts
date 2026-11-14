import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {TutorialContent} from '@/components/tutorial-content';
import {MiniLocaleProvider} from '@/components/mini-locale';
describe('public tutorial',()=>{
 it('keeps a stable video area without inventing a video or written fallback',()=>{
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(TutorialContent)}));
  expect(html).toContain('data-tutorial-video-empty');
  expect(html).not.toContain('Find an auction');
  expect(html).not.toContain('<ol');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('<video');
 });
 it('renders the managed poster without mounting a YouTube player or video source',()=>{
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(TutorialContent,{media:{kind:'youtube',id:'abcdefghijk',poster:'/images/lowin-family-hero.webp'},intro:{en:'Managed explanation',am:'መግለጫ'}})}));
  expect(html).not.toContain('Managed explanation');
  expect(html).toContain('Watch how it works');
  expect(html).not.toContain('youtube-nocookie.com');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('<video');
 });
 it('provides Amharic accessibility copy without the removed text guide',()=>{
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'am',children:createElement(TutorialContent)}));
  expect(html).toContain('የመመሪያ ቪዲዮ በቅርቡ ይቀርባል');
  expect(html).not.toContain('Find an auction');
 });
});
