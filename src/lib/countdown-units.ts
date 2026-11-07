/** Whole seconds are a visual projection; acceptance uses server deadlines. */
export function countdownUnits(remainingMs:number):readonly string[]{
 const total=Math.max(0,Math.floor(Number.isFinite(remainingMs)?remainingMs/1000:0));
 return [Math.floor(total/86400),Math.floor(total%86400/3600),Math.floor(total%3600/60),total%60].map(value=>String(value).padStart(2,'0'));
}
