import {setTimeout as delay} from 'node:timers/promises';
import type {NotificationSettings} from './settings';
import type {TelegramSendPriority} from './telegram-rate';

export const REMINDER_SCAN_INTERVAL_MS=5_000;
type LaneTasks={schedule:()=>Promise<unknown>;cleanupContacts:()=>Promise<unknown>;expand:()=>Promise<number>;verify:()=>Promise<boolean>;settleReferrals?:()=>Promise<boolean>;send:(priority:TelegramSendPriority|undefined)=>Promise<number>};
type Lane='schedule'|'contact-cleanup'|'expansion'|'verification'|'referral-rewards'|'personal-delivery'|'delivery';

/** A bounded set of independent loops, not one serial schedule→verify→send
 * chain. One lane remains available for personal messages during a broadcast.
 */
export async function runNotificationLanes(tasks:LaneTasks,settings:NotificationSettings,signal:AbortSignal,onError:(lane:Lane)=>void=()=>{}){
 const sleep=async(ms:number)=>{if(signal.aborted)return;try{await delay(ms,undefined,{signal})}catch(error){if(!signal.aborted)throw error}};
 const lane=async(name:Lane,job:()=>Promise<unknown>,idleMs:number,activeMs:number)=>{
  let failures=0;
  while(!signal.aborted){
   try{const worked=await job();failures=0;await sleep(worked?activeMs:idleMs)}
   catch{if(signal.aborted)break;onError(name);failures++;await sleep(Math.min(30000,1000*2**Math.min(failures,4))+Math.floor(Math.random()*250))}
  }
 };
 // Contact retention keeps its own cadence and cannot delay reminder scans.
 const loops=[
  lane('schedule',tasks.schedule,REMINDER_SCAN_INTERVAL_MS,REMINDER_SCAN_INTERVAL_MS),
  lane('contact-cleanup',tasks.cleanupContacts,60_000,60_000),
  lane('expansion',tasks.expand,750,25),
  lane('verification',tasks.verify,1000,50),
  lane('personal-delivery',()=>tasks.send('high'),200,0),
 ];
 if(tasks.settleReferrals)loops.push(lane('referral-rewards',tasks.settleReferrals,1500,100));
 // One mixed lane can help personal delivery. Other lanes claim directly
 // from the bulk queue instead of scanning it for absent personal work.
 loops.push(lane('delivery',()=>tasks.send(undefined),200,0));
 for(let index=2;index<settings.NOTIFICATION_SEND_CONCURRENCY;index++)loops.push(lane('delivery',()=>tasks.send('bulk'),200,0));
 await Promise.all(loops);
}
