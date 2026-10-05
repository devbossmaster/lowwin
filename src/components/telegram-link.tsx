'use client';
import type {AnchorHTMLAttributes} from 'react';
import {TELEGRAM_SUPPORT_URL} from '@/lib/telegram-community';
export function TelegramLink({href=TELEGRAM_SUPPORT_URL,onClick,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){
 return <a {...props} href={href} target="_blank" rel="noopener noreferrer" onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  try{if(window.Telegram?.WebApp?.openTelegramLink){window.Telegram.WebApp.openTelegramLink(href);event.preventDefault()}}catch{/* The HTTPS link remains usable. */}
 }}/>;
}
