'use client';
import type {RefObject} from 'react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import {TutorialContent,type TutorialProps} from './tutorial-content';
import {LOWWIN_BANNER_SRC} from '@/lib/brand';
export default function LearnMoreSheet({onClose,videoId,media,intro,returnFocusRef}:TutorialProps&{onClose:()=>void;videoId?:string|null;returnFocusRef?:RefObject<HTMLElement|null>}){
 const video=media??(videoId?{kind:'youtube' as const,id:videoId,poster:LOWWIN_BANNER_SRC.am}:null);
 return <AccountSheet title={<MiniPhrase en="How Lowwin works" am="Lowwin እንዴት ይሠራል"/>} onClose={onClose} returnFocusRef={returnFocusRef}><TutorialContent media={video} intro={intro}/></AccountSheet>;
}
