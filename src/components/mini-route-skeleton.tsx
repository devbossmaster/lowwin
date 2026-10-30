'use client';
import {usePathname} from 'next/navigation';
import {useMiniLocale} from './mini-locale';
import styles from './mini-route-skeleton.module.css';

export type MiniSkeletonVariant='home'|'catalog'|'category'|'auction'|'winners'|'winner'|'bids'|'payments'|'profile'|'wallet'|'alerts'|'favorites'|'support'|'faq'|'legal';

/** Match the destination's content geometry; never replace a retained query snapshot. */
export function miniSkeletonVariant(path:string):MiniSkeletonVariant{
 const route=path.split(/[?#]/,1)[0].replace(/\/$/,'')||'/';
 if(route==='/')return 'home';
 if(route==='/profile/favorites')return 'catalog';
 if(route==='/profile/alerts')return 'home';
 if(route.startsWith('/categories/'))return 'category';
 if(route==='/auctions'||route==='/auctions/all')return 'catalog';
 if(route.startsWith('/auctions/'))return 'auction';
 if(route==='/draws'||route==='/winners'||route==='/winners/all')return 'winners';
 if(route.startsWith('/winners/'))return 'winner';
 if(route==='/my-bids'||route==='/winning-bids'||route==='/profile/wins')return 'bids';
 if(route==='/payments')return 'payments';
 if(route.startsWith('/wallet'))return 'wallet';
 if(route==='/profile/support')return 'support';
 if(route==='/faq')return 'faq';
 if(route==='/terms'||route==='/privacy')return 'legal';
 return 'profile';
}

function Bone({className=''}:{className?:string}){return <span className={`${styles.bone} ${className}`}/>}
function Heading(){return <div className={styles.heading}><Bone className={styles.title}/><Bone className={styles.subtitle}/></div>}
function Chips(){return <div className={styles.chips}><Bone/><Bone/><Bone/><Bone/></div>}
function Search(){return <Bone className={styles.search}/>}
function AuctionCard(){return <div className={styles.auctionCard} data-skeleton-part="auction-card"><Bone className={styles.productImage}/><div className={styles.auctionBody}><Bone className={styles.productTitle}/><div className={styles.facts}><Bone/><Bone/></div><Bone className={styles.button}/><Bone className={styles.caption}/></div></div>}
function Catalog({category=false}:{category?:boolean}){return <div className={styles.stack}>{category&&<Heading/>}<Search/><Chips/><div className={styles.catalogTools}><Bone/><Bone/></div><AuctionCard/><AuctionCard/></div>}
function Home(){return <div className={styles.home}><div className={styles.hero} data-skeleton-part="hero"><Bone className={styles.heroTitle}/><Bone className={styles.heroCopy}/><div className={styles.heroActions}><Bone/><Bone/></div></div><div className={styles.stack}><Chips/><Bone className={styles.sectionTitle}/><Chips/><AuctionCard/></div></div>}
function Auction(){return <div className={styles.stack} data-skeleton-part="auction-detail"><Bone className={styles.gallery}/><div className={styles.thumbnails}><Bone/><Bone/><Bone/></div><Bone className={styles.title}/><div className={styles.facts}><Bone/><Bone/></div><Bone className={styles.button}/><div className={styles.prose}><Bone/><Bone/><Bone/></div><div className={styles.facts}><Bone/><Bone/></div></div>}
function ResultCard(){return <div className={styles.resultCard}><Bone className={styles.resultImage}/><div className={styles.resultBody}><Bone className={styles.productTitle}/><Bone className={styles.resultPerson}/><div className={styles.facts}><Bone/><Bone/></div><Bone className={styles.caption}/></div></div>}
function Winners(){return <div className={styles.stack}><Bone className={styles.subtitle}/><ResultCard/><ResultCard/></div>}
function Winner(){return <div className={styles.stack}><Bone className={styles.gallery}/><Bone className={styles.title}/><div className={styles.resultIdentity}><Bone className={styles.avatar}/><div className={styles.rowText}><Bone/><Bone/></div></div><div className={styles.summary}><Bone/><Bone/><Bone/></div><div className={styles.prose}><Bone/><Bone/><Bone/></div></div>}
function Rows({kind='payment',count=4}:{kind?:'payment'|'bid'|'alert';count?:number}){return <div className={styles.rows} data-skeleton-part={`${kind}-rows`}>{Array.from({length:count},(_,index)=><div className={styles.row} key={index}><Bone className={kind==='bid'?styles.bidNumber:styles.rowIcon}/><div className={styles.rowText}><Bone/><Bone/><Bone/></div><Bone className={styles.rowStatus}/></div>)}</div>}
function Bids(){return <div className={styles.stack}><div className={styles.summary}><Bone/><Bone/><Bone/></div><Chips/><Rows kind="bid"/><Bone className={styles.pagination}/></div>}
function Payments(){return <div className={styles.stack}><div className={styles.transactionHead}><Bone className={styles.subtitle}/><Bone className={styles.refresh}/></div><Rows/><Bone className={styles.pagination}/></div>}
function Profile({wallet=false}:{wallet?:boolean}){return <div className={styles.stack}><div className={styles.identity} data-skeleton-part="profile-identity"><Bone className={styles.avatar}/><div className={styles.rowText}><Bone/><Bone/><Bone/></div></div><div className={styles.balance} data-skeleton-part="wallet"><Bone className={styles.balanceLabel}/><Bone className={styles.balanceAmount}/><div className={styles.facts}><Bone/><Bone/></div></div>{!wallet&&<><div className={styles.panel}><Bone className={styles.sectionTitle}/><Bone className={styles.subtitle}/><Bone className={styles.button}/></div><div className={styles.panel}><Bone className={styles.sectionTitle}/><div className={styles.summary}><Bone/><Bone/><Bone/></div><Bone className={styles.subtitle}/></div></>}<Rows count={wallet?4:2}/></div>}
function Support(){return <div className={styles.stack}><Heading/><div className={styles.prose}><Bone/><Bone/><Bone/></div><Bone className={styles.button}/><div className={styles.supportRows}><Bone/><Bone/><Bone/></div></div>}
function Faq(){return <div className={styles.stack}><Heading/><Search/><div className={styles.accordions}>{Array.from({length:5},(_,i)=><div key={i}><Bone/><Bone/></div>)}</div></div>}
function Legal(){return <div className={styles.stack}><Heading/>{Array.from({length:3},(_,index)=><div className={styles.legalSection} key={index}><Bone className={styles.sectionTitle}/><div className={styles.prose}><Bone/><Bone/><Bone/><Bone/></div></div>)}</div>}
function Body({variant}:{variant:MiniSkeletonVariant}){
 switch(variant){
  case 'home':return <Home/>;
  case 'catalog':case 'favorites':return <Catalog/>;
  case 'category':return <Catalog category/>;
  case 'auction':return <Auction/>;
  case 'winners':return <Winners/>;
  case 'winner':return <Winner/>;
  case 'bids':return <Bids/>;
  case 'payments':return <Payments/>;
  case 'profile':return <Profile/>;
  case 'wallet':return <Profile wallet/>;
  case 'alerts':return <Rows kind="alert"/>;
  case 'support':return <Support/>;
  case 'faq':return <Faq/>;
  case 'legal':return <Legal/>;
 }
}

/** Neutral layout placeholders contain no invented balances, bidders or results. */
export function MiniRouteSkeleton({path,variant,compact=false}:{path?:string;variant?:MiniSkeletonVariant;compact?:boolean}={}){
 const pathname=usePathname(),{language}=useMiniLocale(),selected=variant??miniSkeletonVariant(path??pathname??'/');
 return <div className={`${styles.root}${compact?' '+styles.compact:''}`} data-route-skeleton={selected} role="status" aria-busy="true">
  <span className="sr-only">{language==='am'?'ገጹን በመጫን ላይ…':'Loading page…'}</span>
  <div aria-hidden="true"><Body variant={selected}/></div>
 </div>;
}
export function CatalogSkeleton(){return <MiniRouteSkeleton variant="catalog" compact/>}
export function MiniInlineSkeleton(){return <MiniRouteSkeleton compact/>}
/** The bids page already keeps its summary and filters mounted while reading. */
export function MiniBidRowsSkeleton(){const {language}=useMiniLocale();return <div className={`${styles.root} ${styles.compact}`} data-route-skeleton="bids" role="status" aria-busy="true"><span className="sr-only">{language==='am'?'ጨረታዎችዎን በመጫን ላይ…':'Loading your bids…'}</span><div aria-hidden="true"><Rows kind="bid"/></div></div>}
/** Modal sections retain a compact spinner rather than a full route skeleton. */
export function BidPanelSkeleton(){const {language}=useMiniLocale();return <div className="customer-loading customer-loading-compact" role="status" aria-busy="true"><span className="loading-spinner" aria-hidden="true"><span className="loading-spinner-ring"/></span><p>{language==='am'?'የጨረታ ዝርዝሮችን በመጫን ላይ…':'Loading bid details…'}</p></div>}
