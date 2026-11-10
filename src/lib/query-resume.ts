/** Browsers commonly emit visibility, focus and online together on resume.
 * Coalesce that burst only; explicit refreshes and mutation invalidation bypass it. */
export function createResumeGate(intervalMs=1000){
 let last=-Infinity;
 return (now=Date.now())=>{if(now-last<intervalMs)return false;last=now;return true};
}
