'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Check,Languages} from 'lucide-react';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

const languages=[['en','English'],['am','አማርኛ']] as const;

/* Flag artwork adapted from flag-icons. Copyright (c) 2013 Panayiotis Lipiridis.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
function LanguageFlag({language}:{language:MiniLanguage}){
 return <svg className={styles.languageFlag} data-language-flag={language} viewBox="0 0 640 480" aria-hidden="true" focusable="false">
  {language==='en'?<>
   <path fill="#012169" d="M0 0h640v480H0z"/>
   <path fill="#fff" d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0z"/>
   <path fill="#c8102e" d="m424 281 216 159v40L369 281zm-184 20 6 35L54 480H0zM640 0v3L391 191l2-44L590 0zM0 0l239 176h-60L0 42z"/>
   <path fill="#fff" d="M241 0v480h160V0zM0 160v160h640V160z"/>
   <path fill="#c8102e" d="M0 193v96h640v-96zM273 0v480h96V0z"/>
  </>:<>
   <path fill="#298c08" d="M0 0h640v160H0z"/><path fill="#ffc621" d="M0 160h640v160H0z"/><path fill="#ef2118" d="M0 320h640v160H0z"/>
   <g transform="matrix(.94 0 0 .94 74 -8.5)" fillRule="evenodd">
    <circle cx="534.2" cy="353" r="199.7" fill="#006bc6" transform="matrix(.54 0 0 .54 -25.8 74)"/>
    <path fill="#ffc621" d="m214.3 188.2-6.5 4.5 23.5 33 6.3-4zm29.4 78-9.7-6.8 4-12.7-48.1.7-14-10.7 65.7-.7 12.2-36.9 6.6 15zm76.5-70.7-6.3-4.8-24.3 32.4 5.6 4.7zM254.8 247l3.5-11.2h13.3L256.4 190l6-16.5 20.5 62.4 38.8.5-12.2 10.7zm90.6 51.2 2.7-7.4-38.3-13.3-2.8 7zm-69.1-46.4 11.7-.1 4.1 12.6 38.8-28.5 17.6.6-53.1 38.7 11.5 37.2-14-8.4zm-19.8 102 7.9.2.3-40.5-7.4-.5zm22-80.3 3.8 11.1-10.7 8 39.4 27.7 5 16.8-53.6-38-31.5 22.7 3.5-16 44-32.3zm-103.3 13 2.3 7.5 38.7-12.2-2-7.2zm83.2-4-9.4 7.1-10.8-7.7-14.2 46-14.4 10 19.5-62.7-31.4-23 16.3-1.6z"/>
   </g>
  </>}
 </svg>;
}

export function MiniLanguageMenu(){
 const {language,setLanguage,t}=useMiniLocale(),[open,setOpen]=useState(false);
 const container=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[open]);
 function moveFocus(event:ReactKeyboardEvent<HTMLDivElement>){
  const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]),index=options.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();
  }else if(event.key==='Tab'){setOpen(false);button.current?.focus()}
 }
 return <div className={styles.language} ref={container}>
  <button ref={button} type="button" className={styles.languageButton} aria-label={`${t('language')}: ${language==='en'?'English':'አማርኛ'}`} aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true)}}}>
   <Languages size={16} strokeWidth={1.75} aria-hidden="true"/><LanguageFlag language={language}/>
  </button>
  {open&&<div ref={menu} id={id} className={styles.languageMenu} role="menu" aria-label={t('language')} onKeyDown={moveFocus}>
   {languages.map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} lang={value} onClick={()=>{setLanguage(value);setOpen(false);button.current?.focus()}}>
    <LanguageFlag language={value}/><span>{label}</span>{language===value&&<Check className={styles.languageCheck} size={15} strokeWidth={1.75} aria-hidden="true"/>}
   </button>)}
  </div>}
 </div>;
}
