'use client';
import type {ComponentProps} from 'react';
import {openBotFromMiniApp} from '@/lib/telegram-recovery';

export function TelegramBotLink({href,onClick,onHandoff,...props}:ComponentProps<'a'>&{href:string;onHandoff?:()=>void}) {
  return <a {...props} href={href} onClick={event=>{
    onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(openBotFromMiniApp(href,window.Telegram?.WebApp)){
      event.preventDefault();
      onHandoff?.();
    }
  }}/>;
}
