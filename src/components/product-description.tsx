'use client';
import {useId,useState} from 'react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {Card} from './ui/card';
import styles from './product-description.module.css';

// Plain text only: "Label: value" lines become specification rows.
export function ProductDescription({description,descriptionAm,compact=false}:{description:string;descriptionAm?:string|null;compact?:boolean}){
  const {language}=useMiniLocale();
  const [expanded,setExpanded]=useState(false),contentId=useId();
  const text=language==='am'?(descriptionAm?.trim()||description):description;
  if(!text.trim())return null;
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const compactText=compact?lines.join(' ').replace(/\s+/gu,' '):'';
  const characters=Array.from(compactText);
  const shortened=characters.length>144;
  const firstLine=characters.slice(0,144).join('');
  const boundary=firstLine.lastIndexOf(' ');
  const excerpt=(boundary>=100?firstLine.slice(0,boundary):firstLine).trimEnd();
  const body=compact&&!expanded
    ?<p className={styles.paragraph}>{shortened?excerpt+'…':compactText}</p>
    :lines.map((line,index)=>{
    const match=line.match(/^(.{1,45}?)(?::|፦)\s+(.+)$/u);
    return match?<dl className={styles.specs} key={index}><div><dt>{match[1]}</dt><dd>{match[2]}</dd></div></dl>:<p className={styles.paragraph} key={index}>{line}</p>;
  });
  const Container=compact?Card:'section';
  return <Container className={compact?`${styles.section} ${styles.preview}`:styles.section} data-product-description={compact?'preview':undefined}>
    <h2><MiniPhrase en="Product details" am="የዕቃው ዝርዝር"/></h2>
    {compact?<div id={contentId}>{body}</div>:body}
    {shortened&&<button type="button" className={styles.expand} aria-controls={contentId} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
      <MiniPhrase en={expanded?'Read less':'Read more'} am={expanded?'በአጭሩ አሳይ':'ተጨማሪ አንብብ'}/>
    </button>}
  </Container>;
}
