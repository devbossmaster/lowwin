export type LearnMoreMedia={kind:'youtube';id:string;poster:string}|{kind:'local';src:string;poster:string};
export function resolveLearnMoreMedia(input:{youtube?:string;local?:string;poster?:string}):LearnMoreMedia|null{
 const poster=input.poster&&/^\/(?:images\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)|api\/media\/[a-f0-9-]{36})$/.test(input.poster)?input.poster:'/images/lowin-family-hero.webp';
 if(input.local&&/^\/videos\/[A-Za-z0-9/_-]+\.(?:mp4|webm)$/.test(input.local))return {kind:'local',src:input.local,poster};
 if(!input.youtube)return null;
 try{const url=new URL(input.youtube);if(url.protocol!=='https:'||url.username||url.password)return null;const id=url.hostname==='youtu.be'?url.pathname.slice(1):['youtube.com','www.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)?url.searchParams.get('v')??url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})$/)?.[1]:null;return id&&/^[A-Za-z0-9_-]{11}$/.test(id)?{kind:'youtube',id,poster}:null}catch{return null}
}
