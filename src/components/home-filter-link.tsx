'use client';
import type {ComponentProps} from 'react';

/** Home filters change the URL and auction query, without a route transition. */
export function HomeFilterLink({href,onClick,...props}:ComponentProps<'a'>&{href:string}){
 return <a {...props} href={href} onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||props.target==='_blank'||props.download)return;
  event.preventDefault();
  if(location.pathname+location.search!==href)window.history.pushState(null,'',href);
 }}/>;
}
