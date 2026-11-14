'use client';
import Image from 'next/image';
import {useState} from 'react';
import {Play,RotateCcw,VideoOff} from 'lucide-react';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './tutorial.module.css';
import {lowwinHomeBanner} from '@/lib/brand';

/** No player or external video request is made until the visitor chooses Play. */
export function TutorialVideo({media}:{media:LearnMoreMedia|null}){
 const [playing,setPlaying]=useState(false),[failed,setFailed]=useState(false),[posterFailed,setPosterFailed]=useState(false);
 const {language}=useMiniLocale(),am=language==='am';
 const title=am?'LowWin እንዴት ይሠራል':'How LowWin works';
 const poster=lowwinHomeBanner(language,posterFailed?null:media?.poster);
 if(!media)return <div className={styles.emptyVideo} role="img" aria-label={am?'የመመሪያ ቪዲዮ በቅርቡ ይቀርባል':'Explainer video coming soon'} data-tutorial-video-empty><Play size={32} aria-hidden="true"/></div>;
 return <div className={styles.video} data-tutorial-video>{failed?<div className={styles.videoError} role="status"><VideoOff size={26} aria-hidden="true"/><p><MiniPhrase en="The video could not load." am="ቪዲዮው መጫን አልቻለም።"/></p><button type="button" onClick={()=>{setFailed(false);setPlaying(false)}}><RotateCcw size={16} aria-hidden="true"/><MiniPhrase en="Try again" am="እንደገና ይሞክሩ"/></button></div>:!playing?<><Image src={poster} alt="" fill sizes="(min-width:1280px) 1200px,(min-width:640px) 868px,(max-width:480px) calc(100vw - 32px),448px" quality={75} onError={()=>setPosterFailed(true)}/><button type="button" className={styles.play} aria-label={am?'እንዴት እንደሚሠራ ይመልከቱ':'Watch how it works'} onClick={()=>setPlaying(true)}><span><Play size={24} fill="currentColor" aria-hidden="true"/></span></button></>:media.kind==='youtube'?<iframe src={'https://www.youtube-nocookie.com/embed/'+media.id+'?autoplay=1'} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={()=>setFailed(true)}/>:<video src={media.src} poster={poster} aria-label={title} preload="none" controls playsInline autoPlay onError={()=>setFailed(true)}><MiniPhrase en="Your browser cannot play this video." am="አሳሽዎ ይህን ቪዲዮ ማጫወት አይችልም።"/></video>}</div>;
}
