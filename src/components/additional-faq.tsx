'use client';
import {useMiniLocale} from './mini-locale';
/** Old English-only owner content remains stored; never substitute it for Amharic. */
export function AdditionalFaq({items}:{items:{question:string;answer:string;questionAm?:string;answerAm?:string}[]}){
 const {language}=useMiniLocale(),am=language==='am';
 return <>{items.filter(item=>!am||item.questionAm&&item.answerAm).map((item,index)=><details key={`${index}-${item.question}`}><summary>{am?item.questionAm:item.question}</summary><p>{am?item.answerAm:item.answer}</p></details>)}</>;
}
