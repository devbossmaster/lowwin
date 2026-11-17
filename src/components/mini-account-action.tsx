'use client';
import {LoaderCircle,Phone,RotateCcw} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {TelegramBotLink} from './telegram-bot-link';

/** Mini App account recovery stays native. Website OIDC is a separate surface. */
export function MiniAccountAction({className}:{className?:string}){
 const {environment,status,needsReopen,botUrl,openRegistration,retry}=useTelegram();
 if(environment!=='mini'||status==='authenticated')return null;
 if(status==='loading')return <span className={className} role="status"><LoaderCircle size={16} aria-hidden="true"/><MiniPhrase en="Connecting…" am="በማገናኘት ላይ…"/></span>;
 if(needsReopen&&botUrl)return <TelegramBotLink className={className} href={botUrl}><MiniPhrase en="Reopen in Telegram" am="በTelegram እንደገና ይክፈቱ"/></TelegramBotLink>;
 const contact=status==='contact-required';
 return <button type="button" className={className} onClick={contact?openRegistration:retry}>{contact?<Phone size={16} aria-hidden="true"/>:<RotateCcw size={16} aria-hidden="true"/>}<MiniPhrase en={contact?'Share contact':'Try again'} am={contact?'ስልክ ቁጥር ያጋሩ':'እንደገና ይሞክሩ'}/></button>;
}
