import Image from 'next/image';

export function LaunchSplash({complete=false}:{complete?:boolean}){
  return <main id="main" className={`telegram-entry launch-loader${complete?' is-complete':''}`} aria-busy={!complete}>
    <div className="launch-mark">
      <Image src="/logo.png" alt="Lowwin" width={160} height={160} sizes="(max-width: 430px) 38vw, 160px" quality={75} preload/>
      <p lang="am">በዝቅተኛ ዋጋ ተጫረቱ፣ ያሸንፉ!</p>
    </div>
    <div className="launch-content">
      <div className="loader" role="status" aria-label={complete?'Opening Lowwin':'Verifying Telegram and contact'}/>
      <span className="sr-only" role="status">{complete?'Opening Lowwin…':'Checking your Telegram launch and contact…'}</span>
    </div>
  </main>;
}
