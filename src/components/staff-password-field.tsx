'use client';
import {useId,useRef,useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import styles from './staff-password-field.module.css';

export function StaffPasswordField({autoComplete}:{autoComplete:'current-password'|'new-password'}){
 const id=useId(),input=useRef<HTMLInputElement>(null),[visible,setVisible]=useState(false);
 return <span className={styles.field}><input ref={input} id={id} name="password" aria-label="Password" type={visible?'text':'password'} minLength={12} maxLength={128} autoComplete={autoComplete} required/><button type="button" className={styles.toggle} aria-controls={id} aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onMouseDown={event=>event.preventDefault()} onClick={()=>{setVisible(value=>!value);input.current?.focus({preventScroll:true})}}>{visible?<EyeOff size={19} aria-hidden="true"/>:<Eye size={19} aria-hidden="true"/>}</button></span>;
}
