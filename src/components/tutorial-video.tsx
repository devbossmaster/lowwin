'use client';
import Image from 'next/image';
import {useState} from 'react';
import {Play} from 'lucide-react';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './tutorial.module.css';
import {lowwinBanner} from '@/lib/brand';

/** No player, iframe, or video source is mounted until the visitor taps Play. */
export function TutorialVideo({media}:{media:LearnMoreMedia|null}){
 const [playing,setPlaying]=useState(false),[failed,setFailed]=useState(false),[posterFailed,setPosterFailed]=useState(false);
 const {language}=useMiniLocale(),am=language==='am';
 const poster=lowwinBanner(language,posterFailed?null:media?.poster);
 if(!media)return null;
 if(failed)return <p className={styles.videoError} role="status"><MiniPhrase en="The video is unavailable. You can still follow the steps below." am="ቪዲዮው አይገኝም። ከታች ያሉትን ደረጃዎች መከተል ይችላሉ።"/></p>;
 return <div className={styles.video} data-tutorial-video>{!playing?<><Image src={poster} alt="" fill sizes="(max-width:480px) 100vw,480px" quality={75} onError={()=>setPosterFailed(true)}/><button type="button" className={styles.play} onClick={()=>setPlaying(true)}><span><Play size={21} fill="currentColor" aria-hidden="true"/></span><MiniPhrase en="Watch how it works" am="እንዴት እንደሚሠራ ይመልከቱ"/></button></>:media.kind==='youtube'?<iframe src={`https://www.youtube-nocookie.com/embed/${media.id}?autoplay=1`} title={am?'LowWin እንዴት ይሠራል':'How LowWin works'} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={()=>setFailed(true)}/>:<video src={media.src} poster={poster} preload="none" controls playsInline autoPlay onError={()=>setFailed(true)}><MiniPhrase en="Your browser cannot play this video. Read the steps below." am="አሳሽዎ ይህን ቪዲዮ ማጫወት አይችልም። ከታች ያሉትን ደረጃዎች ያንብቡ።"/></video>}</div>;
}
