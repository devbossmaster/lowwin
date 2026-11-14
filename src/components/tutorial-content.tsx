'use client';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import {TutorialVideo} from './tutorial-video';
import styles from './tutorial.module.css';
export type TutorialProps={media?:LearnMoreMedia|null;intro?:{en:string;am:string}};
export function TutorialContent({media}:TutorialProps){
 return <div className={styles.content}><TutorialVideo media={media??null}/></div>;
}
