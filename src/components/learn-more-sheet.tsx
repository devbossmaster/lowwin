'use client';
import type {RefObject} from 'react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import {TutorialContent,type TutorialProps} from './tutorial-content';
export default function LearnMoreSheet({onClose,videoId,media,intro,returnFocusRef}:TutorialProps&{onClose:()=>void;videoId?:string|null;returnFocusRef?:RefObject<HTMLElement|null>}){
 const video=media??(videoId?{kind:'youtube' as const,id:videoId,poster:'/images/lowin-family-hero.webp'}:null);
 return <AccountSheet title={<MiniPhrase en="How Lowwin works" am="Lowwin እንዴት ይሠራል"/>} onClose={onClose} returnFocusRef={returnFocusRef}><TutorialContent media={video} intro={intro}/></AccountSheet>;
}
