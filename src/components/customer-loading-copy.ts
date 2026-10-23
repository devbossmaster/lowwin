export type CustomerLoadingCopy = {en:string;am:string};

export function customerLoadingCopy(pathname:string):CustomerLoadingCopy {
 if(pathname==='/profile')return {en:'Loading your profile…',am:'መገለጫዎን በመጫን ላይ…'};
 if(pathname.startsWith('/profile/alerts')||pathname==='/profile/section')return {en:'Loading notifications…',am:'ማሳወቂያዎችን በመጫን ላይ…'};
 if(pathname.startsWith('/profile/favorites'))return {en:'Loading saved auctions…',am:'ተወዳጅ ጨረታዎችን በመጫን ላይ…'};
 if(pathname==='/my-bids')return {en:'Loading your bids…',am:'ጨረታዎችዎን በመጫን ላይ…'};
 if(pathname==='/winning-bids'||pathname==='/profile/wins')return {en:'Loading your wins…',am:'ያሸነፉባቸውን ጨረታዎች በመጫን ላይ…'};
 if(pathname==='/wallet')return {en:'Loading your wallet…',am:'የገንዘብ ቦርሳዎን በመጫን ላይ…'};
 if(pathname==='/draws'||pathname==='/winners'||pathname.startsWith('/winners/'))return {en:'Loading draws…',am:'የጨረታ ውጤቶችን በመጫን ላይ…'};
 if(pathname==='/auctions'||pathname==='/auctions/all'||pathname.startsWith('/categories/'))return {en:'Loading auctions…',am:'ጨረታዎችን በመጫን ላይ…'};
 if(pathname.startsWith('/auctions/'))return {en:'Loading auction details…',am:'የጨረታ ዝርዝሮችን በመጫን ላይ…'};
 if(pathname==='/')return {en:'Loading Lowin…',am:'Lowinን በመጫን ላይ…'};
 return {en:'Loading…',am:'በመጫን ላይ…'};
}
