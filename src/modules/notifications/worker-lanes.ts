import {setTimeout as delay} from 'node:timers/promises';
import type {NotificationSettings} from './settings';

type LaneTasks={schedule:()=>Promise<unknown>;expand:()=>Promise<number>;verify:()=>Promise<boolean>;send:(priority:'high'|undefined)=>Promise<number>};
type Lane='schedule'|'expansion'|'verification'|'personal-delivery'|'delivery';

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
 // This array is bounded by validated configuration (at most eleven loops).
 const loops=[lane('schedule',tasks.schedule,60000,60000),lane('expansion',tasks.expand,750,25),lane('verification',tasks.verify,1000,50),lane('personal-delivery',()=>tasks.send('high'),200,0)];
 for(let index=1;index<settings.NOTIFICATION_SEND_CONCURRENCY;index++)loops.push(lane('delivery',()=>tasks.send(undefined),200,0));
 await Promise.all(loops);
}
