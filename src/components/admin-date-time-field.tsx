'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {formatAddisDateTimeLocal,parseAddisDateTimeLocal} from '@/lib/addis-time';
import styles from './admin-auction-schedule-preview.module.css';

const minutePattern='(?:0?[1-9]|1[0-2]):[0-5][0-9]';
const secondPattern=minutePattern+'(?::[0-5][0-9])?';
const validMinutes=new RegExp(`^${minutePattern}$`);
const validSeconds=new RegExp(`^${secondPattern}$`);
type ClockFields={date:string;time:string;period:'AM'|'PM'};
const empty:ClockFields={date:'',time:'',period:'AM'};

function displayFields(value:string):ClockFields{
 const [date,clock='']=value.split('T');
 const hour=Number(clock.split(':')[0]);
 if(!clock||!Number.isInteger(hour)||hour<0||hour>23)return {...empty,date};
 return {date,time:String(hour%12||12).padStart(2,'0')+clock.slice(2),period:hour>=12?'PM':'AM'};
}

function canonicalValue({date,time,period}:ClockFields,includeSeconds:boolean){
 if(!date||!(includeSeconds?validSeconds:validMinutes).test(time))return '';
 const [hour,...rest]=time.split(':');
 const hour24=Number(hour)%12+(period==='PM'?12:0);
 return `${date}T${[String(hour24).padStart(2,'0'),...rest].join(':')}`;
}

type Props={label:string;name:string;value:string;onChange:(value:string)=>void;after?:string;required?:boolean;includeSeconds?:boolean;clearLabel?:string};

/** Keep the visible wall clock separate from the canonical Addis form value. */
export function AdminDateTimeField({label,name,value,onChange,after,required=true,includeSeconds=false,clearLabel}:Props){
 const titleId=useId(),clock=useRef<HTMLInputElement>(null);
 const [draft,setDraft]=useState(()=>({value,fields:displayFields(value)}));
 const fields=draft.value===value?draft.fields:displayFields(value);
 // Duration presets and fresh server values replace local field edits.
 if(draft.value!==value)setDraft({value,fields});
 const canonical=canonicalValue(fields,includeSeconds);
 const instant=canonical?parseAddisDateTimeLocal(canonical):null;
 const minimum=after?parseAddisDateTimeLocal(after):null;
 const error=instant&&(!Number.isFinite(instant.getTime())||formatAddisDateTimeLocal(instant)!==canonical.slice(0,16))
  ?'Enter a valid date.'
  :instant&&minimum&&instant<=minimum?'The end time must be after the start time.':'';
 useEffect(()=>{clock.current?.setCustomValidity(error)},[error]);
 const hasEntry=!!(fields.date||fields.time),requireEntry=required||hasEntry;

 function update(next:ClockFields){
  const value=canonicalValue(next,includeSeconds);
  setDraft({value,fields:next});
  onChange(value);
 }

 return <div role="group" aria-labelledby={titleId} className={styles.scheduleField}>
  <span id={titleId}>{label}</span>
  <div className={styles.scheduleControls}>
   <label className={styles.scheduleDate}>Date<input type="date" value={fields.date} min={minimum?after?.split('T')[0]:undefined} onChange={event=>update({...fields,date:event.target.value})} required={requireEntry}/></label>
   <label>Time (12-hour)<input ref={clock} type="text" value={fields.time} pattern={includeSeconds?secondPattern:minutePattern} placeholder={includeSeconds?'HH:mm:ss':'HH:mm'} maxLength={includeSeconds?8:5} onChange={event=>update({...fields,time:event.target.value})} required={requireEntry}/></label>
   <label>AM/PM<select value={fields.period} onChange={event=>update({...fields,period:event.target.value==='PM'?'PM':'AM'})}><option>AM</option><option>PM</option></select></label>
  </div>
  <input type="hidden" name={name} value={canonical}/>
  {clearLabel&&hasEntry&&<button type="button" className={`admin-text-button ${styles.clearTime}`} onClick={()=>update(empty)}>{clearLabel}</button>}
 </div>;
}
