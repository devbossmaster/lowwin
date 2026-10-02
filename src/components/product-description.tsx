'use client';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './product-description.module.css';

// Plain text only: "Label: value" lines become specification rows.
export function ProductDescription({description,descriptionAm}:{description:string;descriptionAm?:string|null}){
  const {language}=useMiniLocale();
  const text=language==='am'?(descriptionAm?.trim()||description):description;
  if(!text.trim())return null;
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  return <section className={styles.section}><h2><MiniPhrase en="Product details" am="የዕቃው ዝርዝር"/></h2>{lines.map((line,index)=>{
    const match=line.match(/^(.{1,45}?)(?::|፦)\s+(.+)$/u);
    return match?<dl className={styles.specs} key={index}><div><dt>{match[1]}</dt><dd>{match[2]}</dd></div></dl>:<p className={styles.paragraph} key={index}>{line}</p>;
  })}</section>;
}
